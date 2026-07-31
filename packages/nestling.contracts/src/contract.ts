/**
 * `makeContract` — контракт как направление-нейтральное значение.
 *
 * Контракт ничего не регистрирует ни в модуле, ни в приложении: на
 * приложение он влияет только через `implement(...)` (реализация) и через
 * инжект вызывателя (потребление). Единственный побочный эффект — запись
 * имени в приватный реестр пакета, потому что имя есть идентичность.
 */

import type {
  AnyOutput,
  AnyPayload,
  InferInput,
  InferOutput,
  ValidateOutputForm,
} from './io/index.js';
import type {
  AnyFailDefinition,
  FailsOf as FailsOfDefinitions,
} from './define-fail.js';
import { isFailDefinition } from './define-fail.js';
import type { EmitterToken, PortToken } from './families.js';
import { EmitterFamily, PortFamily } from './families.js';
import { registerContract } from './registry.js';

/**
 * Вид контракта: он же семантика доставки.
 *
 * - `request` — request-reply, Fail-able, ровно один владелец;
 * - `command` — fire-and-forget, ровно один обработчик (реплики делят
 *   нагрузку группой доставки);
 * - `event` — broadcast-факт, 0..N подписчиков.
 */
export type ContractKind = 'request' | 'command' | 'event';

/** Допустимые виды — тем же значением их перечисляет текст ошибки */
const CONTRACT_KINDS: readonly ContractKind[] = ['request', 'command', 'event'];

/**
 * Контракт как значение: интерфейс операции плюс её адрес.
 *
 * Направление-нейтрален: из него строится и реализация (`implement`), и
 * вызыватель (`.port`/`.emitter`). Транспорт в нём не упомянут — `name`
 * это адрес шины, а HTTP-адресация приезжает отдельным change'ем.
 *
 * @param I - форма io входа
 * @param O - форма io выхода
 * @param E - объявленные отказы (`errors:`)
 * @param K - вид контракта
 */
export interface Contract<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
  K extends ContractKind = ContractKind,
> {
  /**
   * Имя контракта — **адрес**: оно же subject шины, оно же ключ дискавери.
   * Версия выражается частью имени (`user.create.v2`); отдельного поля
   * версии не существует.
   */
  readonly name: string;

  readonly kind: K;

  /** Форма io входа: значение-схема или обёртка формы */
  readonly input?: I;

  /** Форма io выхода (у `command`/`event` не участвует в доставке) */
  readonly output?: O;

  /** Объявленные отказы — список определений `defineFail` */
  readonly errors?: E;

  /**
   * Долговечная доставка: факт не должен потеряться, пока подписчик лежит.
   *
   * Свойство **операции**, а не подписки и не развёртывания: издатель обязан
   * дождаться подтверждения записи, подписчик — читать долговечно, а живут
   * они в разных процессах. Единственное значение, доступное обоим, — сам
   * контракт, поэтому объявляется он здесь и больше нигде.
   *
   * Допустим только у `command`/`event`: у `request` ответа ждёт живой
   * вызывающий, и переживать нечего.
   */
  readonly durable?: boolean;
}

/** Контракт вида `request`: у него есть `.port` и нет `.emitter` */
export interface RequestContract<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
> extends Contract<I, O, E, 'request'> {
  /** Токен вызывателя: член семейства, параметризованный именем контракта */
  readonly port: PortToken<RequestContract<I, O, E>>;
}

/** Контракт вида `command`/`event`: у него есть `.emitter` и нет `.port` */
export interface EmittingContract<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
  K extends 'command' | 'event' = 'command' | 'event',
> extends Contract<I, O, E, K> {
  /** Токен эмиттера: член семейства, параметризованный именем контракта */
  readonly emitter: EmitterToken<EmittingContract<I, O, E, K>>;
}

/** Контракт вида `command` */
export type CommandContract<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
> = EmittingContract<I, O, E, 'command'>;

/** Контракт вида `event` */
export type EventContract<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
> = EmittingContract<I, O, E, 'event'>;

/** Контракт любого вида — для мест, где вид несуществен */
export type AnyContract = Contract<any, any, any, ContractKind>;

/** Форма io входа контракта — то, что реализация кладёт в `input:` */
export type InputFormOf<C extends AnyContract> =
  C extends Contract<infer I, any, any, any> ? I : never;

/** Форма io выхода контракта — то, что реализация кладёт в `output:` */
export type OutputFormOf<C extends AnyContract> =
  C extends Contract<any, infer O, any, any> ? O : never;

/** Тип payload вызова, выведенный из формы `input` контракта */
export type InputOf<C extends AnyContract> =
  C extends Contract<infer I, any, any, any> ? InferInput<I> : never;

/** Тип значения успешного ответа, выведенный из формы `output` контракта */
export type OutputOf<C extends AnyContract> =
  C extends Contract<any, infer O, any, any> ? InferOutput<O> : never;

/**
 * Юнион объявленных отказов контракта — множество `E` его call-site.
 *
 * Для контракта без `errors:` даёт `never`: незадекларированный отказ
 * доезжает до потребителя только `UnknownError`'ом.
 *
 * Имя с приставкой, потому что в одном пакете живут обе проекции множества
 * отказов: `FailsOf<E>` считает его от **списка определений** (его берёт
 * словарь декларации), а эта — от **контракта**. Раньше они не встречались,
 * потому что жили в разных пакетах.
 */
export type ContractFailsOf<C extends AnyContract> =
  C extends Contract<any, any, infer E, any>
    ? E extends readonly AnyFailDefinition[]
      ? FailsOfDefinitions<E>
      : never
    : never;

/** Словарь объявления контракта */
export interface ContractSpec<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
  K extends ContractKind = ContractKind,
> {
  /** Имя-адрес: subject шины и ключ дискавери */
  name: string;

  kind: K;

  /** Форма io входа */
  input?: I;

  /**
   * Форма io выхода. `ValidateOutputForm` закрывает слот так же, как в
   * декларации: `multipart` и тип-меняющий шаг цепочки — ошибка компиляции
   * в точке объявления контракта.
   */
  output?: O & ValidateOutputForm<O>;

  /**
   * Объявленные отказы: список определений `defineFail`. Проверяется в
   * точке создания — не-определение и повторяющийся код валят объявление,
   * а не сборку приложения.
   */
  errors?: E;

  /**
   * Долговечность доставки. Допустима только у `command`/`event`; у
   * `request` отвергается в момент создания.
   */
  durable?: K extends 'request' ? never : boolean;
}

/** Fail-fast имени: пустое имя не адресует ничего */
function assertName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new TypeError(
      `makeContract({ … }): 'name' must be a non-empty string — it is the ` +
        `address of the contract (the bus subject and the discovery key).`,
    );
  }
}

/** Fail-fast вида: словарь закрыт тремя значениями */
function assertKind(kind: unknown, name: string): asserts kind is ContractKind {
  if (!CONTRACT_KINDS.includes(kind as ContractKind)) {
    throw new TypeError(
      `Contract '${name}': 'kind' must be one of ` +
        `${CONTRACT_KINDS.map((k) => `'${k}'`).join(', ')}, got ` +
        `${JSON.stringify(kind)}.`,
    );
  }
}

/**
 * Fail-fast списка `errors:` — те же проверки, что в словаре декларации:
 * элемент, не созданный `defineFail`, и повторяющийся код.
 */
function assertFailDefinitions(
  errors: unknown,
  name: string,
): asserts errors is readonly AnyFailDefinition[] | undefined {
  if (errors === undefined) {
    return;
  }

  const where = `Contract '${name}'`;

  if (!Array.isArray(errors)) {
    throw new TypeError(
      `${where}: 'errors' must be an array of defineFail() definitions.`,
    );
  }

  const seen = new Set<string>();
  for (const [index, definition] of errors.entries()) {
    if (!isFailDefinition(definition)) {
      throw new TypeError(
        `${where}: errors[${index}] is not a fail definition — ` +
          `expected a value created by defineFail().`,
      );
    }

    if (seen.has(definition.code)) {
      throw new Error(
        `${where}: duplicate error code '${definition.code}' in 'errors'.`,
      );
    }
    seen.add(definition.code);
  }
}

/**
 * Fail-fast долговечности: у `request` её не бывает.
 *
 * Отвергается в момент объявления, а не на сборке: контракт видят обе
 * стороны провода, и «долговечный req-reply» — дефект самой декларации, а
 * не конкретного развёртывания.
 */
function assertDurable(
  durable: unknown,
  name: string,
  kind: ContractKind,
): asserts durable is boolean | undefined {
  if (durable === undefined) {
    return;
  }

  if (typeof durable !== 'boolean') {
    throw new TypeError(
      `Contract '${name}': 'durable' must be a boolean, got ` +
        `${JSON.stringify(durable)}.`,
    );
  }

  if (kind === 'request') {
    throw new Error(
      `Contract '${name}' (kind 'request'): 'durable' applies only to ` +
        `'command' and 'event' contracts — a request-reply has a live caller ` +
        `waiting for the answer, so there is nothing to outlive. Drop the ` +
        `flag, or make the contract a 'command'.`,
    );
  }
}

/**
 * Ставит на контракт вызыватель его вида и запрещающий геттер — другого.
 *
 * Типы делают обращение к чужому свойству невыразимым, но JS-потребителей
 * типы не сдерживают: `OrderPlaced.port` вернул бы `undefined`, и вызов
 * упал бы где-то дальше, ничего не сказав про вид контракта.
 */
function defineInvokers(
  value: Record<string, unknown>,
  kind: ContractKind,
): void {
  const name = value.name as string;

  const wrongProperty = (property: 'port' | 'emitter'): (() => never) => {
    const right = property === 'port' ? 'emitter' : 'port';

    return () => {
      throw new Error(
        `Contract '${name}' is a '${kind}' contract: it has no '.${property}', ` +
          `use '.${right}' instead.`,
      );
    };
  };

  if (kind === 'request') {
    Object.defineProperty(value, 'port', {
      value: PortFamily(name),
      enumerable: true,
    });
    Object.defineProperty(value, 'emitter', {
      get: wrongProperty('emitter'),
      enumerable: false,
    });

    return;
  }

  Object.defineProperty(value, 'emitter', {
    value: EmitterFamily(name),
    enumerable: true,
  });
  Object.defineProperty(value, 'port', {
    get: wrongProperty('port'),
    enumerable: false,
  });
}

/**
 * Объявляет контракт.
 *
 * @param spec - Словарь контракта: имя-адрес, вид, формы io и отказы
 * @returns Неизменяемое значение-контракт с вызывателем своего вида
 * @throws {Error} Пустое имя, вид вне словаря, кривой `errors:` или уже
 * занятое имя
 *
 * @example Запрос
 * ```typescript
 * export const ChargeCard = makeContract({
 *   name: 'billing.charge',
 *   kind: 'request',
 *   input: z.object({ orderId: z.string(), amount: z.number() }),
 *   output: z.object({ chargeId: z.string() }),
 *   errors: [CardDeclined],
 * });
 * ```
 *
 * @example Событие
 * ```typescript
 * export const OrderPlaced = makeContract({
 *   name: 'orders.placed',
 *   kind: 'event',
 *   input: z.object({ orderId: z.string() }),
 * });
 * ```
 */
export function makeContract<
  I extends AnyPayload = undefined,
  O extends AnyOutput = undefined,
  E extends readonly AnyFailDefinition[] = [],
>(spec: ContractSpec<I, O, E, 'request'>): RequestContract<I, O, E>;
export function makeContract<
  I extends AnyPayload = undefined,
  O extends AnyOutput = undefined,
  E extends readonly AnyFailDefinition[] = [],
>(spec: ContractSpec<I, O, E, 'command'>): CommandContract<I, O, E>;
export function makeContract<
  I extends AnyPayload = undefined,
  O extends AnyOutput = undefined,
  E extends readonly AnyFailDefinition[] = [],
>(spec: ContractSpec<I, O, E, 'event'>): EventContract<I, O, E>;
export function makeContract(
  spec: ContractSpec<any, any, readonly AnyFailDefinition[], ContractKind>,
): AnyContract {
  const { name, kind, input, output, errors, durable } = spec;

  assertName(name);
  assertKind(kind, name);
  assertFailDefinitions(errors, name);
  assertDurable(durable, name, kind);

  const value: Record<string, unknown> = { name, kind };

  if (input !== undefined) {
    value.input = input;
  }
  if (output !== undefined) {
    value.output = output;
  }
  if (errors !== undefined) {
    value.errors = errors;
  }
  if (durable !== undefined) {
    value.durable = durable;
  }

  defineInvokers(value, kind);

  const contract = Object.freeze(value) as unknown as AnyContract;
  registerContract(contract);

  return contract;
}
