/**
 * Ambient-переменная — типизированный ключ **накопленного `input`**.
 *
 * Второго хранилища здесь нет: переменная объявляет имя поля, которое
 * пайплайн и так накапливает, поэтому проекция и не может разойтись с
 * контекстом. Запись — единственной формы `Var.provide(compute)`: добавку
 * строит сама переменная, значит «объявлено» и «положено» — одно действие.
 */

import type { ExtendableContext } from '../types/context.js';
import type { PreUnitFn } from '../types/unit.js';

import { currentCell } from './store.js';

import type { AnyInput, EmptyInput } from '@nestling/contracts';

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

/** Словарь опций объявления переменной */
export interface ContextVarOptions {
  /**
   * Переменная провозится через границу порта.
   *
   * Свойство **объявления**, а не точки подключения: провозится именно
   * переменная, и решение об этом обязано быть видно там же, где она
   * объявлена. Переменная без флага не провозится ни при каких
   * обстоятельствах — общей протечки ambient-контекста вызывающего в
   * реализацию не существует, `propagate` есть именованное исключение.
   */
  propagate?: boolean;
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
  /** Провозится ли переменная через границу порта */
  readonly propagate?: boolean;
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

/**
 * Провозимая переменная: та же переменная плюс **второй** штатный писатель.
 *
 * Писателя по-прежнему строит сама переменная, поэтому инвариант «объявлено
 * и положено — одно действие» держится и на приёмной стороне.
 */
export interface PropagatedContextVar<T, K extends string = string>
  extends ContextVar<T, K> {
  readonly propagate: true;

  /**
   * Строит pre-юнит, кладущий в накопленный `input` значение **с провода**
   * (`ctx.raw.attributes[key]`) вместо вычисленного.
   *
   * Значение не валидируется: схемы у ambient-переменной нет, и рантайм её
   * не изобретает — провоз пересекает границу доверия, и ответственность за
   * провезённое остаётся на приложении.
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

/**
 * Реестр провозимых переменных — модульное состояние пакета.
 *
 * Тот же приём, что реестр контрактов в `@nestling/ports`: множество
 * провозимого известно из объявлений, а не из конфигурации, и вызывателю
 * нужно знать его целиком, ничего не инжектя. Ключ, объявленный
 * провозимым дважды, — одна и та же ячейка `input`, поэтому Map по ключу.
 */
const propagatedVars = new Map<string, AnyContextVar>();

/** Ключи провозимых переменных — то, что вызыватель ищет в ячейке запроса */
export const propagatedKeys = (): readonly string[] => [
  ...propagatedVars.keys(),
];

/**
 * Значения провозимых переменных из ячейки **текущего** запроса.
 *
 * То, чем пользуется вызыватель порта: сбор идёт на его стороне, потому что
 * только там известна ячейка вызывающего. Вне запроса (`@OnStart`, фоновая
 * задача) ячейки нет — и это легальное состояние: провозить просто нечего.
 *
 * @returns Словарь «ключ → значение» или `undefined`, если провозить нечего
 *
 * @internal единственный потребитель — вызыватель `@nestling/ports`
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

    // Переменная, до которой pre-тракт не дошёл, не провозится: `undefined`
    // в конверте неотличим от «не было», и класть его незачем
    if (value === undefined) {
      continue;
    }

    collected ??= {};
    collected[key] = value;
  }

  return collected;
}

/** Общий конструктор значения-переменной; `provide` подмешивается отдельно */
function makeVar<T, K extends string>(
  key: K,
  provide: ContextVar<T, K>['provide'] | (() => never),
  extra: Record<string, unknown> = {},
): ContextVar<T, K> {
  const variable = { key, provide, ...extra } as ContextVar<T, K>;

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

    /** Ставит пометку переменной на юнит-писатель — любой из двух */
    const mark = (
      unit: (ctx: ExtendableContext<AnyInput>) => unknown,
      variable: ContextVar<T, K>,
    ): typeof unit => {
      // Пометка — на значении юнита: декларация переменной и факт её
      // добавления рождаются одним действием и разойтись не могут.
      // Одна и та же у `provide` и у `propagated`, поэтому `hasVar`
      // засчитывает обоих: способ получить значение политику не интересует
      Object.defineProperty(unit, DECLARED_VAR, {
        value: variable,
        enumerable: false,
      });

      return unit;
    };

    const provide = ((compute: (ctx: ExtendableContext<AnyInput>) => unknown) =>
      mark(
        async (ctx: ExtendableContext<AnyInput>) => ({
          [key]: await compute(ctx),
        }),
        variable,
      )) as ContextVar<T, K>['provide'];

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
          // Значение не валидируется: схемы у переменной нет, и рантайм её
          // не изобретает — см. capability `context-propagation`
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
 * Объявитель переменной: две перегрузки, различающиеся ровно флагом.
 *
 * Отдельный тип, потому что `propagated()` обязан отсутствовать **в типе**
 * непровозимой переменной: у неё этого писателя нет, и это должно быть
 * ошибкой компиляции, а не отказом в рантайме (рантайм-отказ остаётся для
 * JS-потребителей).
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
 * Объявляет переменную **только для чтения**: значение ей поставляет
 * рантайм запроса, а не pre-юнит.
 *
 * @internal единственный потребитель — well-known `Signal`
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

  // Провозимой read-only переменная быть не может по той же причине, по
  // которой у неё нет писателя: её значение поставляет рантайм запроса
  // получателя, и привезённое с провода ему не замена
  const variable = makeVar<T, K>(key, readOnly, { propagated: readOnly });

  return variable as ReadonlyContextVar<T, K>;
}
