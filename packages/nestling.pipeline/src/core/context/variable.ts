/**
 * Ambient-переменная — типизированный ключ **накопленного `input`**.
 *
 * Второго хранилища здесь нет: переменная объявляет имя поля, которое
 * пайплайн и так накапливает, поэтому проекция и не может разойтись с
 * контекстом. Запись — единственной формы `Var.provide(compute)`: добавку
 * строит сама переменная, значит «объявлено» и «положено» — одно действие.
 */

import type { AnyInput, EmptyInput } from '../io/io.js';
import type { ExtendableContext } from '../types/context.js';
import type { PreUnitFn } from '../types/unit.js';

/**
 * Ключ, зарезервированный под well-known `Signal`.
 *
 * Сигнал живёт не в `input`, а в контексте запроса, поэтому объявить его
 * переменной пользовательского кода нечем: ключ занят.
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

  /** @internal фантомный носитель типа значения (в рантайме отсутствует) */
  readonly $type?: T;
}

/**
 * Ambient-переменная: ключ, рантайм-идентичность, тип значения и
 * единственный канонический писатель.
 *
 * @template T - Тип значения переменной
 * @template K - Ключ поля в накопленном `input`, литералом
 */
export interface ContextVar<T, K extends string = string>
  extends ReadonlyContextVar<T, K> {
  /**
   * Строит **pre-юнит** обычной формы: накопительная типизация, проверка
   * требований и конфликтов — прежняя машинерия пайплайна.
   *
   * @param compute - Значение переменной по контексту pre-юнита
   * @returns Pre-юнит, добавляющий в input поле `key`
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
}

/** Переменная с любым ключом: форма аргумента `Ctx` и предиката `hasVar` */
export type AnyContextVar<T = unknown> = ReadonlyContextVar<T, string>;

/**
 * Пометка юнита переменной, которую он кладёт.
 *
 * Неперечислимая и symbol'ьная: значение юнита остаётся обычной функцией —
 * ни спред, ни `Object.keys`, ни сериализация её не видят.
 */
const DECLARED_VAR = Symbol('nestling:contextVar');

/**
 * Переменная, объявленная юнитом, — или `undefined` у юнита любой другой
 * формы (включая функцию, кладущую то же поле «вручную»).
 *
 * @internal основание множества объявленных переменных пайплайна, на
 * котором стоит предикат `hasVar`
 */
export const declaredVarOf = (unit: unknown): AnyContextVar | undefined =>
  typeof unit === 'function'
    ? (unit as { [DECLARED_VAR]?: AnyContextVar })[DECLARED_VAR]
    : undefined;

/** Значение — объявленная ambient-переменная (а не строка-ключ) */
export const isContextVar = (value: unknown): value is AnyContextVar =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as AnyContextVar).key === 'string';

/** Fail-fast ключа: правила проверяются в момент объявления */
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

/** Общий конструктор значения-переменной; `provide` подмешивается отдельно */
function makeVar<T, K extends string>(
  key: K,
  provide: ContextVar<T, K>['provide'] | (() => never),
): ContextVar<T, K> {
  const variable = { key, provide } as ContextVar<T, K>;

  return Object.freeze(variable);
}

/**
 * Объявляет ambient-переменную.
 *
 * Вызов **двойной**: `contextVar<T>()` фиксирует тип значения, а второй
 * вызов — ключ. Пара скобок здесь не украшение: TypeScript не умеет
 * частичного вывода тип-аргументов, а ключ обязан остаться литералом —
 * иначе `provide` не смог бы объявить добавку `{ [key]: T }`, и
 * накопительная типизация пайплайна выродилась бы в индексную сигнатуру.
 *
 * @template T - Тип значения переменной
 * @returns Объявитель, принимающий ключ поля накопленного `input`
 *
 * @example
 * ```typescript
 * export const RequestId = contextVar<string>()('requestId');
 *
 * const observability = makePipeline()
 *   .pre(RequestId.provide(() => crypto.randomUUID()));
 * ```
 */
export function contextVar<T>(
  ...misuse: []
): <const K extends string>(key: K) => ContextVar<T, K> {
  if (misuse.length > 0) {
    throw new TypeError(
      `contextVar<T>() takes no arguments: declare a variable as ` +
        `contextVar<string>()('requestId'). The second call is what keeps the ` +
        `key a literal — TypeScript has no partial type-argument inference.`,
    );
  }

  return <const K extends string>(key: K): ContextVar<T, K> => {
    assertKey(key);

    const variable: ContextVar<T, K> = makeVar<T, K>(key, ((
      compute: (ctx: ExtendableContext<AnyInput>) => unknown,
    ) => {
      const unit = async (
        ctx: ExtendableContext<AnyInput>,
      ): Promise<Record<string, unknown>> => ({ [key]: await compute(ctx) });

      // Пометка — на значении юнита: декларация переменной и факт её
      // добавления рождаются одним действием и разойтись не могут
      Object.defineProperty(unit, DECLARED_VAR, {
        value: variable,
        enumerable: false,
      });

      return unit;
    }) as ContextVar<T, K>['provide']);

    return variable;
  };
}

/**
 * Объявляет переменную **только для чтения**: значение ей поставляет
 * рантайм запроса, а не pre-юнит.
 *
 * @internal единственный потребитель — well-known `Signal`
 */
export function readonlyContextVar<T, K extends string>(
  key: K,
): ReadonlyContextVar<T, K> {
  const variable = makeVar<T, K>(key, () => {
    throw new TypeError(
      `Context variable '${key}' is read-only: its value comes from the ` +
        `request runtime, not from the accumulated input, so there is nothing ` +
        `for a pre-unit to provide.`,
    );
  });

  return variable as ReadonlyContextVar<T, K>;
}
