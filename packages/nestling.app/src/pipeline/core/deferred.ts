/**
 * Отложенный шаг: функция, которой до `bind()` не хватает значений из
 * контейнера.
 *
 * Механизм у пайплайна общий: шаг несёт список DI-токенов и фабрику,
 * `bind()` резолвит список один раз и подставляет готовую функцию. Наружу
 * в V1 торчит одна дверь — `Var.provide(deps, compute)`. У остальных фаз
 * класс-форма читается не хуже функции, а писатель переменной —
 * единственное место, где класс существовал бы только ради переезда
 * значения через `ctx.input`.
 */

import type { AnyAddition, PreStepFn } from './types/step.js';

import type { Optional } from '@nestlingjs/common.misc';
import type { InjectionToken } from '@nestlingjs/container';
import type { AnyInput, EmptyInput } from '@nestlingjs/operations';

/**
 * Symbol-ключ брэнда `TNeeds`: DI-токены, которые шаг добавляет в
 * `TNeeds` пайплайна.
 *
 * В рантайме под ключом лежит список DI-токенов шага; в типах — тот же
 * список, по которому пайплайн пополняет `TNeeds`.
 */
export const STEP_NEEDS: unique symbol = Symbol('nestling:stepNeeds');

/**
 * Pre-шаг с зависимостями из контейнера.
 *
 * Обычный {@link PreStepFn} плюс брэнд `TNeeds`: пайплайн с таким шагом
 * не исполним до `bind()`, как и пайплайн с классом-шагом.
 *
 * @template TInput - Требования шага к накопленному `input`
 * @template TAddition - Добавка шага к накопленному `input`
 * @template TNeeds - DI-токены, которые шаг добавляет в `TNeeds`
 */
export type DeferredPreStepFn<
  TInput extends AnyInput = EmptyInput,
  TAddition extends Optional<AnyAddition> = undefined,
  TNeeds = never,
> = PreStepFn<TInput, TAddition> & {
  readonly [STEP_NEEDS]: readonly TNeeds[];
};

/** Symbol-метка отложенного шага: то, что нужно `bind()` */
const DEFERRED = Symbol('nestling:deferredStep');

/**
 * Описание отложенного шага.
 *
 * @internal Читает только `bind()` пайплайна
 */
export interface DeferredStep {
  /** Имя шага для текстов ошибок */
  readonly name: string;
  /** DI-токены, значения которых получает фабрика, по порядку списка */
  readonly deps: readonly InjectionToken[];
  /** Собирает функцию шага из значений зависимостей */
  readonly make: (values: readonly unknown[]) => (...args: never[]) => unknown;
}

/**
 * Создаёт отложенный шаг.
 *
 * Возвращаемая функция — заглушка: вызов до `bind()` бросает ошибку с
 * починкой. Метки неперечислимые, поэтому шаг остаётся обычной функцией.
 *
 * @internal Единственный вызывающий — `Var.provide(deps, compute)`
 */
export function deferStep(
  deferred: DeferredStep,
): (...args: never[]) => unknown {
  const step = (): never => {
    throw new Error(
      `Pipeline step ${deferred.name} needs dependencies from the container; ` +
        `call bind() or run under App before executing the pipeline.`,
    );
  };

  Object.defineProperty(step, 'name', { value: deferred.name });
  Object.defineProperty(step, DEFERRED, { value: deferred, enumerable: false });
  Object.defineProperty(step, STEP_NEEDS, {
    value: deferred.deps,
    enumerable: false,
  });

  return step;
}

/**
 * Возвращает описание отложенного шага или `undefined` для любого другого
 * значения.
 *
 * @internal По нему `bind()` отличает отложенный шаг от готовой функции
 */
export const deferredOf = (step: unknown): DeferredStep | undefined =>
  typeof step === 'function'
    ? (step as { [DEFERRED]?: DeferredStep })[DEFERRED]
    : undefined;
