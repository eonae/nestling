/**
 * Контекстные переменные: типизированные ключи накопленного `input`.
 *
 * Отдельного хранилища у переменных нет: переменная называет поле, которое
 * пайплайн и так накапливает, поэтому значение из `Ctx` всегда совпадает с
 * контекстом. Записывает переменную только юнит `Var.provide` — формой
 * `provide(compute)` или `provide(deps, compute)`: добавку строит сама
 * переменная, и объявление совпадает с записью.
 */

import type { DeferredPreUnitFn } from '../deferred.js';
import { deferUnit } from '../deferred.js';
import type { ExtendableContext } from '../types/context.js';
import type { PreUnitFn } from '../types/unit.js';

import { currentCell } from './store.js';

import type {
  InjectionToken,
  UnwrapInjectionTokens,
} from '@nestlingjs/container';
import { getAutoSentinelFamily, isToken } from '@nestlingjs/container';
import type { AnyInput, EmptyInput } from '@nestlingjs/operations';

/**
 * Ключ, зарезервированный под встроенную переменную `Signal`.
 *
 * Сигнал хранится не в `input`, а в ячейке запроса, поэтому
 * пользовательская переменная с этим ключом запрещена.
 */
export const SIGNAL_KEY = 'signal';

/**
 * Переменная только для чтения: `provide` у неё нет ни в типе, ни в
 * рантайме (см. {@link Signal}).
 *
 * @template T - Тип значения переменной
 * @template K - Ключ поля в накопленном `input`, литералом
 */
export interface ReadonlyContextVar<T, K extends string = string> {
  /** Имя поля в накопленном `input` */
  readonly key: K;

  /** @internal Существует только в типах: несёт тип значения */
  readonly $type?: T;
}

/** Опции объявления переменной */
export interface ContextVarOptions {
  /**
   * Провозить ли переменную через порт в реализацию операции.
   *
   * Флаг стоит на объявлении, а не в месте вызова: решение о провозе видно
   * там же, где объявлена переменная. Переменная без флага не провозится
   * никогда; остальной контекст вызывающего в реализацию не попадает.
   */
  propagate?: boolean;
}

/**
 * Контекстная переменная: ключ, тип значения и единственный способ записи
 * (`provide`). Сравнивается по ссылке.
 *
 * @template T - Тип значения переменной
 * @template K - Ключ поля в накопленном `input`, литералом
 */
export interface ContextVar<T, K extends string = string>
  extends ReadonlyContextVar<T, K> {
  /** Провозится ли переменная через границу порта */
  readonly propagate?: boolean;
  /**
   * Создаёт обычный `.pre`-юнит, который кладёт значение переменной в
   * `input`. Типизация, проверка требований и конфликтов — те же, что у
   * любого `.pre`-юнита.
   *
   * @param compute - Вычисляет значение переменной по контексту юнита
   * @returns `.pre`-юнит, добавляющий в `input` поле `key`
   *
   * @example
   * ```typescript
   * const withRequestId = () => RequestId.provide(() => crypto.randomUUID());
   *
   * // Читающий накопленный контекст объявляет свои требования явно:
   * const withTenant = () =>
   *   TenantId.provide<{ identity: Identity }>((ctx) => ctx.input.identity.tenant);
   * ```
   */
  provide<TReq extends AnyInput = EmptyInput>(
    compute: (ctx: ExtendableContext<TReq>) => T | Promise<T>,
  ): PreUnitFn<TReq, Record<K, T>>;

  /**
   * Вторая форма: писатель с зависимостями из контейнера.
   *
   * Значения DI-токенов резолвятся один раз на `bind()` пайплайна тем же
   * резолвером, что и классы-юниты, и приходят в `compute` следом за
   * контекстом. Класса-моста, который кладёт значение из контейнера в
   * `ctx.input`, не требуется.
   *
   * Требования к накопленному контексту объявляются аннотацией параметра
   * `ctx`: список DI-токенов выводится из первого аргумента, а частичного
   * вывода тип-аргументов в TypeScript нет.
   *
   * `Family.auto` в списке отвергается: у писателя нет класса-потребителя,
   * по имени которого выбирается член семейства.
   *
   * @param deps - DI-токены, значения которых получает `compute`
   * @param compute - Вычисляет значение по контексту и зависимостям
   * @returns `.pre`-юнит с непустым `TNeeds`: исполним после `bind()`
   *
   * @example
   * ```typescript
   * const transactional = makePipeline().pre(
   *   Tx.provide([Database], (_ctx, db) => db.begin()),
   * );
   *
   * // Требования к контексту — аннотацией `ctx`
   * Tx.provide(
   *   [Database],
   *   (ctx: ExtendableContext<{ identity: Identity }>, db) =>
   *     db.begin(ctx.input.identity.tenant),
   * );
   * ```
   */
  provide<
    const D extends readonly InjectionToken[],
    TReq extends AnyInput = EmptyInput,
  >(
    deps: D,
    compute: (
      ctx: ExtendableContext<TReq>,
      ...deps: UnwrapInjectionTokens<[...D]>
    ) => T | Promise<T>,
  ): DeferredPreUnitFn<TReq, Record<K, T>, D[number]>;
}

/**
 * Провозимая переменная: обычная переменная плюс второй способ записи,
 * `propagated()`. Его тоже строит сама переменная, поэтому на приёмной
 * стороне объявление и запись по-прежнему совпадают.
 */
export interface PropagatedContextVar<T, K extends string = string>
  extends ContextVar<T, K> {
  readonly propagate: true;

  /**
   * Создаёт `.pre`-юнит, который кладёт в `input` значение, полученное от
   * вызывающего (`ctx.raw.attributes[key]`), вместо вычисленного.
   *
   * Значение не валидируется: схемы у переменной нет. Провоз пересекает
   * границу доверия, и за провезённое отвечает приложение.
   *
   * @example
   * ```typescript
   * const scoped = makePipeline().pre(TenantId.propagated());
   * ```
   */
  propagated(): PreUnitFn<EmptyInput, Record<K, T>>;
}

/** Переменная с любым ключом: форма аргумента `Ctx` и предиката `hasVar` */
export type AnyContextVar<T = unknown> = ReadonlyContextVar<T, string>;

/**
 * Symbol-метка на юните: какую переменную он кладёт.
 *
 * Неперечислимая: юнит остаётся обычной функцией, и ни спред, ни
 * `Object.keys`, ни сериализация метку не видят.
 */
const DECLARED_VAR = Symbol('nestling:contextVar');

/**
 * Возвращает переменную, которую объявляет юнит, или `undefined` для
 * любого другого юнита (включая функцию, кладущую то же поле вручную).
 *
 * @internal По этой функции пайплайн собирает множество объявленных
 * переменных для политики `hasVar`
 */
export const declaredVarOf = (unit: unknown): AnyContextVar | undefined =>
  typeof unit === 'function'
    ? (unit as { [DECLARED_VAR]?: AnyContextVar })[DECLARED_VAR]
    : undefined;

/** Проверяет, что значение — контекстная переменная, а не строка-ключ */
export const isContextVar = (value: unknown): value is AnyContextVar =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as AnyContextVar).key === 'string';

/** Проверяет ключ при объявлении переменной */
function assertKey(key: string): void {
  if (typeof key !== 'string') {
    throw new TypeError(
      `contextVar<T>()(key): key must be a string naming a field of the ` +
        `accumulated input, got ${typeof key}.`,
    );
  }

  if (key.trim().length === 0) {
    throw new TypeError(
      `contextVar<T>()(key): key must be a non-empty field name of the ` +
        `accumulated input.`,
    );
  }

  if (key === SIGNAL_KEY) {
    throw new TypeError(
      `contextVar<T>()('${SIGNAL_KEY}'): the key '${SIGNAL_KEY}' is reserved. ` +
        `The abort signal is not part of the accumulated input — import the ` +
        `ready-made variable Signal and inject Ctx(Signal).`,
    );
  }
}

/**
 * Проверяет аргументы формы `provide(deps, compute)`.
 *
 * Список принимает только DI-токены: объектные и классы. `Family.auto`
 * отвергается отдельно, с починкой: у писателя нет класса-потребителя, по
 * имени которого семейство выбрало бы члена.
 */
function assertWriterDeps(
  key: string,
  deps: readonly unknown[],
  compute: unknown,
): void {
  for (const [index, dep] of deps.entries()) {
    const family = getAutoSentinelFamily(dep as InjectionToken);

    if (family) {
      throw new Error(
        `Context variable '${key}': '${family.familyName}.auto' is not ` +
          `allowed in deps of provide(deps, compute) — a variable writer has ` +
          `no consumer class to name the member after. Use an explicit ` +
          `'${family.familyName}('<name>')' member DI token instead.`,
      );
    }

    if (!isToken(dep) && typeof dep !== 'function') {
      throw new TypeError(
        `Context variable '${key}': provide(deps, compute) takes a list of ` +
          `DI tokens, got ${typeof dep} at index ${index}.`,
      );
    }
  }

  if (typeof compute !== 'function') {
    throw new TypeError(
      `Context variable '${key}': provide(deps, compute) needs a function ` +
        `as the second argument, got ${typeof compute}.`,
    );
  }
}

/**
 * Реестр провозимых переменных: состояние модуля, как реестр операций в
 * `@nestlingjs/app`.
 *
 * Множество провозимого известно из объявлений, а не из конфигурации, и
 * вызывающему порту нужно знать его целиком без инжекта. Два объявления с
 * одним ключом — одно и то же поле `input`, поэтому `Map` по ключу.
 */
const propagatedVars = new Map<string, AnyContextVar>();

/** Ключи провозимых переменных */
export const propagatedKeys = (): readonly string[] => [
  ...propagatedVars.keys(),
];

/**
 * Собирает значения провозимых переменных из ячейки текущего запроса.
 *
 * Вызывается на стороне порта: только там известна ячейка вызывающего.
 * Вне запроса (`@OnStart`, фоновая задача) ячейки нет, и это нормально:
 * провозить нечего.
 *
 * @returns Объект «ключ: значение» или `undefined`, если провозить нечего
 *
 * @internal Единственный потребитель — порт из `@nestlingjs/app`
 */
export function collectPropagatedContext():
  | Record<string, unknown>
  | undefined {
  if (propagatedVars.size === 0) {
    return undefined;
  }

  const cell = currentCell();
  if (!cell) {
    return undefined;
  }

  const input = cell.input as Record<string, unknown>;
  let collected: Record<string, unknown> | undefined;

  for (const key of propagatedVars.keys()) {
    const value = input[key];

    // Переменная без значения не провозится: `undefined` в сообщении
    // неотличим от отсутствия поля
    if (value === undefined) {
      continue;
    }

    collected ??= {};
    collected[key] = value;
  }

  return collected;
}

/** Создаёт замороженное значение переменной */
function makeVar<T, K extends string>(
  key: K,
  provide: ContextVar<T, K>['provide'] | (() => never),
  extra: Record<string, unknown> = {},
): ContextVar<T, K> {
  const variable = { key, provide, ...extra } as ContextVar<T, K>;

  return Object.freeze(variable);
}

/**
 * Объявляет контекстную переменную.
 *
 * Вызов двойной: `contextVar<T>()` задаёт тип значения, второй вызов —
 * ключ. TypeScript не умеет выводить тип-аргументы частично, а ключ обязан
 * остаться литералом: иначе `provide` не смог бы объявить добавку
 * `{ [key]: T }`, и типизация `input` свелась бы к индексной сигнатуре.
 *
 * @template T - Тип значения переменной
 * @returns Функция, принимающая ключ поля накопленного `input`
 *
 * @example
 * ```typescript
 * export const RequestId = contextVar<string>()('requestId');
 *
 * const observability = makePipeline()
 *   .pre(RequestId.provide(() => crypto.randomUUID()));
 * ```
 */
export function contextVar<T>(...misuse: []): ContextVarDeclarator<T> {
  if (misuse.length > 0) {
    throw new TypeError(
      `contextVar<T>() takes no arguments: declare a variable as ` +
        `contextVar<string>()('requestId'). The second call is what keeps the ` +
        `key a literal — TypeScript has no partial type-argument inference.`,
    );
  }

  return (<const K extends string>(
    key: K,
    options: ContextVarOptions = {},
  ): ContextVar<T, K> => {
    assertKey(key);

    const propagate = options.propagate === true;

    /** Ставит на юнит метку переменной, которую он кладёт */
    const mark = <U extends (...args: never[]) => unknown>(
      unit: U,
      variable: ContextVar<T, K>,
    ): U => {
      // Метка одна и та же у `provide` и `propagated`, поэтому `hasVar`
      // засчитывает оба юнита: способ получить значение политике не важен
      Object.defineProperty(unit, DECLARED_VAR, {
        value: variable,
        enumerable: false,
      });

      return unit;
    };

    const provide = ((first: unknown, second?: unknown) => {
      if (!Array.isArray(first)) {
        const compute = first as (ctx: ExtendableContext<AnyInput>) => unknown;

        return mark(
          async (ctx: ExtendableContext<AnyInput>) => ({
            [key]: await compute(ctx),
          }),
          variable,
        );
      }

      const deps = first as readonly InjectionToken[];
      assertWriterDeps(key, deps, second);
      const compute = second as (
        ctx: ExtendableContext<AnyInput>,
        ...values: unknown[]
      ) => unknown;

      // Значения зависимостей подставит `bind()`; до него юнит — заглушка
      return mark(
        deferUnit({
          name: `${key}.provide`,
          deps,
          make: (values) => async (ctx: ExtendableContext<AnyInput>) => ({
            [key]: await compute(ctx, ...values),
          }),
        }),
        variable,
      );
    }) as ContextVar<T, K>['provide'];

    const propagated = (): unknown => {
      if (!propagate) {
        throw new TypeError(
          `Context variable '${key}' is not propagated: declare it as ` +
            `contextVar<T>()('${key}', { propagate: true }) to let port ` +
            `invokers carry it across the boundary. Without the flag nothing ` +
            `arrives on the wire, so there would be nothing for this writer ` +
            `to read.`,
        );
      }

      return mark(
        (ctx: ExtendableContext<AnyInput>) => ({
          // Значение не валидируется: схемы у переменной нет
          [key]: ctx.raw.attributes[key],
        }),
        variable,
      );
    };

    const variable: ContextVar<T, K> = makeVar<T, K>(key, provide, {
      propagated,
      ...(propagate ? { propagate: true } : {}),
    });

    if (propagate) {
      propagatedVars.set(key, variable as AnyContextVar);
    }

    return variable;
  }) as ContextVarDeclarator<T>;
}

/**
 * Второй вызов `contextVar<T>()`: две перегрузки, которые различаются
 * только флагом `propagate`.
 *
 * Отдельный тип нужен, чтобы у непровозимой переменной не было
 * `propagated()` в типе: вызов должен быть ошибкой компиляции, а не только
 * ошибкой в рантайме (та остаётся для JS-потребителей).
 */
export interface ContextVarDeclarator<T> {
  <const K extends string>(
    key: K,
    options: ContextVarOptions & { propagate: true },
  ): PropagatedContextVar<T, K>;

  <const K extends string>(
    key: K,
    options?: ContextVarOptions,
  ): ContextVar<T, K>;
}

/**
 * Объявляет переменную только для чтения: её значение даёт рантайм
 * запроса, а не `.pre`-юнит.
 *
 * @internal Единственный потребитель — встроенная переменная `Signal`
 */
export function readonlyContextVar<T, K extends string>(
  key: K,
): ReadonlyContextVar<T, K> {
  const readOnly = (): never => {
    throw new TypeError(
      `Context variable '${key}' is read-only: its value comes from the ` +
        `request runtime, not from the accumulated input, so there is nothing ` +
        `for a pre-unit to provide.`,
    );
  };

  // Провозить read-only переменную тоже нельзя: её значение даёт рантайм
  // запроса на стороне получателя
  const variable = makeVar<T, K>(key, readOnly, { propagated: readOnly });

  return variable as ReadonlyContextVar<T, K>;
}
