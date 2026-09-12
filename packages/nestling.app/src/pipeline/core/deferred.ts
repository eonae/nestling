/**
 * Отложенный юнит: функция, которой до `bind()` не хватает значений из
 * контейнера.
 *
 * Механизм у пайплайна общий: юнит несёт список DI-токенов и фабрику,
 * `bind()` резолвит список один раз и подставляет готовую функцию. Наружу
 * в V1 торчит одна дверь — `Var.provide(deps, compute)`. У остальных фаз
 * класс-форма читается не хуже функции, а писатель переменной —
 * единственное место, где класс существовал бы только ради переезда
 * значения через `ctx.input`.
 */

import type { AnyAddition, PreUnitFn } from './types/unit.js';

import type { Optional } from '@nestlingjs/common.misc';
import type { InjectionToken } from '@nestlingjs/container';
import type { AnyInput, EmptyInput } from '@nestlingjs/operations';

/**
 * Symbol-ключ брэнда `TNeeds`: DI-токены, которые юнит добавляет в
 * `TNeeds` пайплайна.
 *
 * В рантайме под ключом лежит список DI-токенов юнита; в типах — тот же
 * список, по которому пайплайн пополняет `TNeeds`.
 */
export const UNIT_NEEDS: unique symbol = Symbol('nestling:unitNeeds');

/**
 * Pre-юнит с зависимостями из контейнера.
 *
 * Обычный {@link PreUnitFn} плюс брэнд `TNeeds`: пайплайн с таким юнитом
 * не исполним до `bind()`, как и пайплайн с классом-юнитом.
 *
 * @template TInput - Требования юнита к накопленному `input`
 * @template TAddition - Добавка юнита к накопленному `input`
 * @template TNeeds - DI-токены, которые юнит добавляет в `TNeeds`
 */
export type DeferredPreUnitFn<
  TInput extends AnyInput = EmptyInput,
  TAddition extends Optional<AnyAddition> = undefined,
  TNeeds = never,
> = PreUnitFn<TInput, TAddition> & {
  readonly [UNIT_NEEDS]: readonly TNeeds[];
};

/** Symbol-метка отложенного юнита: то, что нужно `bind()` */
const DEFERRED = Symbol('nestling:deferredUnit');

/**
 * Описание отложенного юнита.
 *
 * @internal Читает только `bind()` пайплайна
 */
export interface DeferredUnit {
  /** Имя юнита для текстов ошибок */
  readonly name: string;
  /** DI-токены, значения которых получает фабрика, по порядку списка */
  readonly deps: readonly InjectionToken[];
  /** Собирает функцию юнита из значений зависимостей */
  readonly make: (values: readonly unknown[]) => (...args: never[]) => unknown;
}

/**
 * Создаёт отложенный юнит.
 *
 * Возвращаемая функция — заглушка: вызов до `bind()` бросает ошибку с
 * починкой. Метки неперечислимые, поэтому юнит остаётся обычной функцией.
 *
 * @internal Единственный вызывающий — `Var.provide(deps, compute)`
 */
export function deferUnit(
  deferred: DeferredUnit,
): (...args: never[]) => unknown {
  const unit = (): never => {
    throw new Error(
      `Pipeline unit ${deferred.name} needs dependencies from the container; ` +
        `call bind() or run under App before executing the pipeline.`,
    );
  };

  Object.defineProperty(unit, 'name', { value: deferred.name });
  Object.defineProperty(unit, DEFERRED, { value: deferred, enumerable: false });
  Object.defineProperty(unit, UNIT_NEEDS, {
    value: deferred.deps,
    enumerable: false,
  });

  return unit;
}

/**
 * Возвращает описание отложенного юнита или `undefined` для любого другого
 * значения.
 *
 * @internal По нему `bind()` отличает отложенный юнит от готовой функции
 */
export const deferredOf = (unit: unknown): DeferredUnit | undefined =>
  typeof unit === 'function'
    ? (unit as { [DEFERRED]?: DeferredUnit })[DEFERRED]
    : undefined;
