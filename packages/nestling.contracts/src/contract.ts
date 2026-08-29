/**
 * `makeContract`: объявление контракта и типы контрактов.
 *
 * Контракт — значение, общее для реализации (`implement`) и для вызывающей
 * стороны (`.port` / `.emitter`). Он ничего не регистрирует ни в модуле,
 * ни в приложении. Единственный побочный эффект `makeContract` — запись
 * имени в реестр пакета (`registry.ts`), чтобы два контракта не заняли
 * один адрес.
 */

import type { HttpBinding } from './http/binding.js';
import { assertHttpPath, computeHttpBinding } from './http/binding.js';
import type { ContractHttp } from './http/section.js';
import { parseHttpSection } from './http/section.js';
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
import type { DeclarationDoc } from './doc.js';
import { assertDoc } from './doc.js';
import type { EmitterToken, PortToken } from './families.js';
import { EmitterFamily, PortFamily } from './families.js';
import { registerContract } from './registry.js';

/**
 * Вид контракта. Определяет, как доставляется вызов.
 *
 * - `request` — запрос-ответ; может вернуть `Fail`; ровно один владелец;
 * - `command` — без ответа; ровно один обработчик (его реплики делят
 *   нагрузку группой доставки);
 * - `event` — факт, который уже случился; 0..N подписчиков.
 */
export type ContractKind = 'request' | 'command' | 'event';

/** Допустимые виды; этот же список печатает текст ошибки */
const CONTRACT_KINDS: readonly ContractKind[] = ['request', 'command', 'event'];

/**
 * Контракт: интерфейс операции и её адрес.
 *
 * Из одного контракта строятся и реализация (`implement`), и вызывающая
 * сторона (`.port` / `.emitter`). Адрес на шине — `name`; адрес по HTTP,
 * если он есть, — поле `http`.
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
   * Имя контракта. Служит адресом: subject шины и ключ discovery.
   * Версия входит в имя (`user.create.v2`); отдельного поля версии нет.
   */
  readonly name: string;

  readonly kind: K;

  /** Форма io входа: схема или обёртка `stream`/`events`/`multipart` */
  readonly input?: I;

  /** Форма io выхода; у `command` и `event` ответ не доставляется */
  readonly output?: O;

  /** Объявленные отказы: список определений `defineFail` */
  readonly errors?: E;

  /**
   * Документация операции.
   *
   * Принадлежит контракту наравне с `input`, `output` и `errors`: две
   * реализации одного контракта описывают его одинаково, а внешний
   * потребитель получает описание из того же импорта, что и схемы.
   */
  readonly doc?: DeclarationDoc;

  /**
   * Долговечная доставка: сообщение не теряется, пока подписчик недоступен.
   *
   * Объявляется на контракте, потому что нужно обеим сторонам: издатель
   * ждёт подтверждения записи, подписчик читает долговечно, а работают они
   * в разных процессах.
   *
   * Допустимо только у `command` и `event`. У `request` вызывающий ждёт
   * ответа в реальном времени, поэтому долговечность не имеет смысла.
   */
  readonly durable?: boolean;

  /**
   * HTTP-адрес контракта в виде готовой bind-карты.
   *
   * В спецификации поле `http` записывается строкой (`'POST /users/:id'`)
   * или объектом; на значении хранится уже вычисленная карта размещения
   * полей. Её читают клиент (сборка запроса), транспорт (разбор запроса) и
   * генератор документации (параметры операции).
   *
   * Если поля нет, контракт недоступен внешнему HTTP-клиенту; на шине он
   * по-прежнему адресуется по `name`.
   */
  readonly http?: HttpBinding;
}

/** Контракт вида `request`: у него есть `.port` и нет `.emitter` */
export interface RequestContract<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
> extends Contract<I, O, E, 'request'> {
  /** Токен порта: член семейства `PortFamily` с именем контракта в параметре */
  readonly port: PortToken<RequestContract<I, O, E>>;
}

/** Контракт вида `command`/`event`: у него есть `.emitter` и нет `.port` */
export interface EmittingContract<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
  K extends 'command' | 'event' = 'command' | 'event',
> extends Contract<I, O, E, K> {
  /** Токен эмиттера: член `EmitterFamily` с именем контракта в параметре */
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

/** Контракт любого вида; для мест, где вид не важен */
export type AnyContract = Contract<any, any, any, ContractKind>;

/** Форма io входа контракта; реализация получает её как `input` */
export type InputFormOf<C extends AnyContract> =
  C extends Contract<infer I, any, any, any> ? I : never;

/** Форма io выхода контракта; реализация получает её как `output` */
export type OutputFormOf<C extends AnyContract> =
  C extends Contract<any, infer O, any, any> ? O : never;

/** Тип payload вызова, выведенный из формы `input` контракта */
export type InputOf<C extends AnyContract> =
  C extends Contract<infer I, any, any, any> ? InferInput<I> : never;

/** Тип значения успешного ответа, выведенный из формы `output` контракта */
export type OutputOf<C extends AnyContract> =
  C extends Contract<any, infer O, any, any> ? InferOutput<O> : never;

/**
 * Объединение объявленных отказов контракта: множество `E` на стороне
 * вызывающего.
 *
 * Для контракта без `errors` даёт `never`: незадекларированный отказ
 * приходит потребителю только как `UnknownError`.
 *
 * Отличается от `FailsOf<E>` только аргументом: тот считает множество от
 * списка определений, этот — от контракта.
 */
export type ContractFailsOf<C extends AnyContract> =
  C extends Contract<any, any, infer E, any>
    ? E extends readonly AnyFailDefinition[]
      ? FailsOfDefinitions<E>
      : never
    : never;

/** Спецификация контракта: аргумент `makeContract` */
export interface ContractSpec<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
  K extends ContractKind = ContractKind,
  Path extends string = string,
> {
  /** Имя контракта; служит адресом: subject шины и ключ discovery */
  name: string;

  kind: K;

  /** Форма io входа */
  input?: I;

  /**
   * Форма io выхода. `ValidateOutputForm` проверяет её так же, как в
   * декларации endpoint'а: `multipart` и шаг цепочки, меняющий тип
   * элемента, — ошибка компиляции в точке объявления контракта.
   */
  output?: O & ValidateOutputForm<O>;

  /**
   * Объявленные отказы: список определений `defineFail`. Проверяется при
   * создании контракта: элемент не из `defineFail` или повторяющийся код
   * дают ошибку объявления, а не сборки приложения.
   */
  errors?: E;

  /**
   * Документация операции: `summary`, `description`, `tags`, `deprecated`,
   * статус успешного ответа и `hidden: '<причина>'`.
   *
   * Проверяется при создании контракта теми же правилами, что и в
   * декларации endpoint'а (`assertDoc`).
   */
  doc?: DeclarationDoc;

  /**
   * Долговечность доставки. Допустима только у `command` и `event`; у
   * `request` отвергается при создании.
   */
  durable?: K extends 'request' ? never : boolean;

  /**
   * HTTP-адрес: строка `'POST /users/:id'` или объект
   * `{ method, path, bind?, rawBody?, sse? }`.
   *
   * Превращается в bind-карту при создании контракта тем же кодом, что и
   * HTTP-декларация endpoint'а. Карта вычисляется здесь, а не при
   * регистрации endpoint'а, потому что клиенту она нужна из одного импорта,
   * без серверного кода.
   */
  http?: ContractHttp<Path, I, O>;
}

/** Проверяет имя: пустая строка не может быть адресом */
function assertName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new TypeError(
      `makeContract({ … }): 'name' must be a non-empty string — it is the ` +
        `address of the contract (the bus subject and the discovery key).`,
    );
  }
}

/** Проверяет вид: допустимы только значения из `CONTRACT_KINDS` */
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
 * Проверяет список `errors`: каждый элемент создан `defineFail`, коды не
 * повторяются. Те же проверки делает декларация endpoint'а.
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
 * Проверяет флаг `durable`: он должен быть булевым и не допускается у
 * `request`.
 *
 * Ошибка выбрасывается при объявлении, а не при сборке приложения:
 * долговечный запрос-ответ — дефект самого контракта, а не конкретного
 * развёртывания.
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
 * Превращает секцию `http` в bind-карту.
 *
 * Проверки те же, что у конструктора HTTP-декларации
 * (`computeHttpBinding`). Отличается только текст ошибки: он называет
 * контракт, потому что чинить секцию будет его владелец.
 */
function httpBindingFor(
  name: string,
  http: unknown,
  input: unknown,
  output: unknown,
): HttpBinding {
  const where = `Contract '${name}'`;
  const section = parseHttpSection(http, where);

  assertHttpPath(section.path, where);

  return computeHttpBinding({
    method: section.method,
    path: section.path,
    bind: section.bind as ComputeHttpBindingBind,
    rawBody: section.rawBody,
    input,
    output,
    sse: section.sse,
    // Имя контракта хранится на карте: реализация получает ту же карту, и
    // по ней интроспекция HTTP-декларации узнаёт контракт
    contract: name,
    where,
  });
}

/** Тип поля `bind` в аргументе `computeHttpBinding`; пометки проверяет рантайм */
type ComputeHttpBindingBind = Parameters<typeof computeHttpBinding>[0]['bind'];

/**
 * Добавляет контракту свойство его вызывающей стороны (`.port` или
 * `.emitter`) и геттер, который бросает ошибку при обращении к чужому.
 *
 * Типы не позволяют обратиться к чужому свойству, но из JS это возможно:
 * без геттера `OrderPlaced.port` вернул бы `undefined`, и ошибка возникла
 * бы позже, без упоминания вида контракта.
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
 * @param spec - Спецификация: имя, вид, формы io, отказы, документация
 * @returns Неизменяемый контракт со свойством `.port` или `.emitter`
 * @throws {Error} Пустое имя, недопустимый вид, некорректный `errors`,
 * `durable` у `request` или уже занятое имя
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
  Path extends string = string,
>(spec: ContractSpec<I, O, E, 'request', Path>): RequestContract<I, O, E>;
export function makeContract<
  I extends AnyPayload = undefined,
  O extends AnyOutput = undefined,
  E extends readonly AnyFailDefinition[] = [],
  Path extends string = string,
>(spec: ContractSpec<I, O, E, 'command', Path>): CommandContract<I, O, E>;
export function makeContract<
  I extends AnyPayload = undefined,
  O extends AnyOutput = undefined,
  E extends readonly AnyFailDefinition[] = [],
  Path extends string = string,
>(spec: ContractSpec<I, O, E, 'event', Path>): EventContract<I, O, E>;
export function makeContract(
  spec: ContractSpec<any, any, readonly AnyFailDefinition[], ContractKind>,
): AnyContract {
  const { name, kind, input, output, errors, doc, durable, http } = spec;

  assertName(name);
  assertKind(kind, name);
  assertFailDefinitions(errors, name);
  assertDoc(doc, `Contract '${name}'`);
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
  if (doc !== undefined) {
    value.doc = doc;
  }
  if (durable !== undefined) {
    value.durable = durable;
  }
  if (http !== undefined) {
    value.http = httpBindingFor(name, http, input, output);
  }

  defineInvokers(value, kind);

  const contract = Object.freeze(value) as unknown as AnyContract;
  registerContract(contract);

  return contract;
}
