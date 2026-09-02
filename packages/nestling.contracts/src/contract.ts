/**
 * Объявление операции: `makeRequest`, `makeCommand`, `makeEvent`.
 *
 * Операция — значение, общее для реализации (`implement`) и для вызывающей
 * стороны (`.caller` / `.emitter`). Она ничего не регистрирует ни в
 * модуле, ни в приложении. Единственный побочный эффект конструктора —
 * запись имени в реестр пакета (`registry.ts`), чтобы две операции не
 * заняли один адрес.
 *
 * Конструкторов три, а не один с полем вида: правила видов расходятся, и
 * расхождение лучше проверять типом в точке объявления, чем условием при
 * создании значения. У события нет `output` и `errors`, у запроса нет
 * `durable`.
 */

import type { HttpBinding } from './http/binding.js';
import { assertHttpPath, computeHttpBinding } from './http/binding.js';
import type { OperationHttp } from './http/section.js';
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
import { registerOperation } from './registry.js';

/**
 * Вид операции. Определяет, как доставляется вызов.
 *
 * - `request` — запрос-ответ; может вернуть `Fail`; ровно один владелец;
 * - `command` — без ответа; ровно один обработчик (его реплики делят
 *   нагрузку группой доставки);
 * - `event` — факт, который уже случился; 0..N подписчиков.
 */
export type OperationKind = 'request' | 'command' | 'event';

/** Допустимые виды; этот же список печатает текст ошибки */
const OPERATION_KINDS: readonly OperationKind[] = [
  'request',
  'command',
  'event',
];

/**
 * Операция: интерфейс операции и её адрес.
 *
 * Из одного операции строятся и реализация (`implement`), и вызывающая
 * сторона (`.port` / `.emitter`). Адрес на шине — `name`; адрес по HTTP,
 * если он есть, — поле `http`.
 *
 * @param I - форма io входа
 * @param O - форма io выхода
 * @param E - объявленные отказы (`errors:`)
 * @param K - вид операции
 */
export interface Operation<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
  K extends OperationKind = OperationKind,
> {
  /**
   * Имя операции. Служит адресом: subject шины и ключ discovery.
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
   * Принадлежит операции наравне с `input`, `output` и `errors`: две
   * реализации одного операции описывают его одинаково, а внешний
   * потребитель получает описание из того же импорта, что и схемы.
   */
  readonly doc?: DeclarationDoc;

  /**
   * Долговечная доставка: сообщение не теряется, пока подписчик недоступен.
   *
   * Объявляется на операции, потому что нужно обеим сторонам: издатель
   * ждёт подтверждения записи, подписчик читает долговечно, а работают они
   * в разных процессах.
   *
   * Допустимо только у `command` и `event`. У `request` вызывающий ждёт
   * ответа в реальном времени, поэтому долговечность не имеет смысла.
   */
  readonly durable?: boolean;

  /**
   * HTTP-адрес операции в виде готовой bind-карты.
   *
   * В спецификации поле `http` записывается строкой (`'POST /users/:id'`)
   * или объектом; на значении хранится уже вычисленная карта размещения
   * полей. Её читают клиент (сборка запроса), транспорт (разбор запроса) и
   * генератор документации (параметры операции).
   *
   * Если поля нет, операция недоступен внешнему HTTP-клиенту; на шине он
   * по-прежнему адресуется по `name`.
   */
  readonly http?: HttpBinding;
}

/** Операция вида `request`: у неё есть `.caller` и нет `.emitter` */
export interface RequestOperation<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
> extends Operation<I, O, E, 'request'> {
  /**
   * Токен вызывающей стороны: член семейства `PortFamily` с именем
   * операции в параметре.
   */
  readonly caller: PortToken<RequestOperation<I, O, E>>;
}

/** Операция вида `command`/`event`: у него есть `.emitter` и нет `.port` */
export interface EmittingOperation<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
  K extends 'command' | 'event' = 'command' | 'event',
> extends Operation<I, O, E, K> {
  /** Токен эмиттера: член `EmitterFamily` с именем операции в параметре */
  readonly emitter: EmitterToken<EmittingOperation<I, O, E, K>>;
}

/** Операция вида `command` */
export type CommandOperation<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
> = EmittingOperation<I, O, E, 'command'>;

/** Операция вида `event` */
export type EventOperation<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
> = EmittingOperation<I, O, E, 'event'>;

/** Операция любого вида; для мест, где вид не важен */
export type AnyOperation = Operation<any, any, any, OperationKind>;

/** Форма io входа операции; реализация получает её как `input` */
export type InputFormOf<C extends AnyOperation> =
  C extends Operation<infer I, any, any, any> ? I : never;

/** Форма io выхода операции; реализация получает её как `output` */
export type OutputFormOf<C extends AnyOperation> =
  C extends Operation<any, infer O, any, any> ? O : never;

/** Тип payload вызова, выведенный из формы `input` операции */
export type InputOf<C extends AnyOperation> =
  C extends Operation<infer I, any, any, any> ? InferInput<I> : never;

/** Тип значения успешного ответа, выведенный из формы `output` операции */
export type OutputOf<C extends AnyOperation> =
  C extends Operation<any, infer O, any, any> ? InferOutput<O> : never;

/**
 * Объединение объявленных отказов операции: множество `E` на стороне
 * вызывающего.
 *
 * Для операции без `errors` даёт `never`: незадекларированный отказ
 * приходит потребителю только как `UnknownError`.
 *
 * Отличается от `FailsOf<E>` только аргументом: тот считает множество от
 * списка определений, этот — от операции.
 */
export type OperationFailsOf<C extends AnyOperation> =
  C extends Operation<any, any, infer E, any>
    ? E extends readonly AnyFailDefinition[]
      ? FailsOfDefinitions<E>
      : never
    : never;

/** Полная спецификация операции: общий вход трёх конструкторов */
export interface OperationSpec<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
  K extends OperationKind = OperationKind,
  Path extends string = string,
> {
  /** Имя операции; служит адресом: subject шины и ключ discovery */
  name: string;

  kind: K;

  /** Форма io входа */
  input?: I;

  /**
   * Форма io выхода. `ValidateOutputForm` проверяет её так же, как в
   * декларации endpoint'а: `multipart` и шаг цепочки, меняющий тип
   * элемента, — ошибка компиляции в точке объявления операции.
   */
  output?: O & ValidateOutputForm<O>;

  /**
   * Объявленные отказы: список определений `defineFail`. Проверяется при
   * создании операции: элемент не из `defineFail` или повторяющийся код
   * дают ошибку объявления, а не сборки приложения.
   */
  errors?: E;

  /**
   * Документация операции: `summary`, `description`, `tags`, `deprecated`,
   * статус успешного ответа и `hidden: '<причина>'`.
   *
   * Проверяется при создании операции теми же правилами, что и в
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
   * Превращается в bind-карту при создании операции тем же кодом, что и
   * HTTP-декларация endpoint'а. Карта вычисляется здесь, а не при
   * регистрации endpoint'а, потому что клиенту она нужна из одного импорта,
   * без серверного кода.
   */
  http?: OperationHttp<Path, I, O>;
}

/** Проверяет имя: пустая строка не может быть адресом */
function assertName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new TypeError(
      `makeRequest/makeCommand/makeEvent({ … }): 'name' must be a ` +
        `non-empty string — it is the address of the operation (the bus ` +
        `subject and the discovery key).`,
    );
  }
}

/** Проверяет вид: допустимы только значения из `OPERATION_KINDS` */
function assertKind(
  kind: unknown,
  name: string,
): asserts kind is OperationKind {
  if (!OPERATION_KINDS.includes(kind as OperationKind)) {
    throw new TypeError(
      `Operation '${name}': 'kind' must be one of ` +
        `${OPERATION_KINDS.map((k) => `'${k}'`).join(', ')}, got ` +
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

  const where = `Operation '${name}'`;

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
 * долговечный запрос-ответ — дефект самого операции, а не конкретного
 * развёртывания.
 */
function assertDurable(
  durable: unknown,
  name: string,
  kind: OperationKind,
): asserts durable is boolean | undefined {
  if (durable === undefined) {
    return;
  }

  if (typeof durable !== 'boolean') {
    throw new TypeError(
      `Operation '${name}': 'durable' must be a boolean, got ` +
        `${JSON.stringify(durable)}.`,
    );
  }

  if (kind === 'request') {
    throw new Error(
      `Operation '${name}' (kind 'request'): 'durable' applies only to ` +
        `commands and events — a request-reply has a live caller waiting for ` +
        `the answer, so there is nothing to outlive. Drop the flag, or ` +
        `declare the operation with makeCommand.`,
    );
  }
}

/**
 * Превращает секцию `http` в bind-карту.
 *
 * Проверки те же, что у конструктора HTTP-декларации
 * (`computeHttpBinding`). Отличается только текст ошибки: он называет
 * операция, потому что чинить секцию будет его владелец.
 */
function httpBindingFor(
  name: string,
  http: unknown,
  input: unknown,
  output: unknown,
): HttpBinding {
  const where = `Operation '${name}'`;
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
    // Имя операции хранится на карте: реализация получает ту же карту, и
    // по ней интроспекция HTTP-декларации узнаёт операцию
    contract: name,
    where,
  });
}

/** Тип поля `bind` в аргументе `computeHttpBinding`; пометки проверяет рантайм */
type ComputeHttpBindingBind = Parameters<typeof computeHttpBinding>[0]['bind'];

/**
 * Добавляет операции свойство её вызывающей стороны (`.caller` или
 * `.emitter`) и геттер, который бросает ошибку при обращении к чужому.
 *
 * Типы не позволяют обратиться к чужому свойству, но из JS это возможно:
 * без геттера `OrderPlaced.caller` вернул бы `undefined`, и ошибка возникла
 * бы позже, без упоминания вида операции.
 */
function defineInvokers(
  value: Record<string, unknown>,
  kind: OperationKind,
): void {
  const name = value.name as string;

  const wrongProperty = (property: 'caller' | 'emitter'): (() => never) => {
    const right = property === 'caller' ? 'emitter' : 'caller';

    return () => {
      throw new Error(
        `Operation '${name}' is a '${kind}': it has no '.${property}', ` +
          `use '.${right}' instead.`,
      );
    };
  };

  if (kind === 'request') {
    Object.defineProperty(value, 'caller', {
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
  Object.defineProperty(value, 'caller', {
    get: wrongProperty('caller'),
    enumerable: false,
  });
}

/** Общая часть словаря всех трёх конструкторов */
type CommonSpec<
  I extends AnyPayload,
  O extends AnyOutput,
  E extends readonly AnyFailDefinition[],
  K extends OperationKind,
  Path extends string,
> = Omit<OperationSpec<I, O, E, K, Path>, 'kind'>;

/** Словарь `makeRequest`: `durable` невыразим */
export type RequestSpec<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
  Path extends string = string,
> = CommonSpec<I, O, E, 'request', Path> & {
  /** @internal у запроса вызывающий ждёт ответа: переживать нечего */
  durable?: never;
};

/** Словарь `makeCommand` */
export type CommandSpec<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  E extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
  Path extends string = string,
> = CommonSpec<I, O, E, 'command', Path>;

/** Словарь `makeEvent`: `output` и `errors` невыразимы */
export type EventSpec<
  I extends AnyPayload = AnyPayload,
  Path extends string = string,
> = Omit<CommonSpec<I, undefined, [], 'event', Path>, 'output' | 'errors'> & {
  /** @internal у события нет ответа, который можно было бы объявить */
  output?: never;
  /** @internal отказ доставляется вызывающему, а у события его нет */
  errors?: never;
};

/** Общая часть трёх конструкторов: проверки и сборка значения */
function declare(
  spec: OperationSpec<any, any, readonly AnyFailDefinition[], OperationKind>,
): AnyOperation {
  const { name, kind, input, output, errors, doc, durable, http } = spec;

  assertName(name);
  assertKind(kind, name);
  assertFailDefinitions(errors, name);
  assertDoc(doc, `Operation '${name}'`);
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

  const contract = Object.freeze(value) as unknown as AnyOperation;
  registerOperation(contract);

  return contract;
}

/**
 * Объявляет операцию вида `request`: запрос-ответ с одним владельцем.
 *
 * Вызывающая сторона получает `.caller` и ждёт ответа, поэтому `durable`
 * у запроса невыразим: переживать недоступность подписчика нечему.
 *
 * @param spec - Имя, формы io, отказы, документация, HTTP-адрес
 * @returns Неизменяемую операцию со свойством `.caller`
 * @throws {Error} Пустое имя, некорректный `errors` или занятое имя
 *
 * @example
 * ```typescript
 * export const ChargeCard = makeRequest({
 *   name: 'billing.charge',
 *   input: z.object({ orderId: z.string(), amount: z.number() }),
 *   output: z.object({ chargeId: z.string() }),
 *   errors: [CardDeclined],
 * });
 * ```
 */
export function makeRequest<
  I extends AnyPayload = undefined,
  O extends AnyOutput = undefined,
  E extends readonly AnyFailDefinition[] = [],
  Path extends string = string,
>(spec: RequestSpec<I, O, E, Path>): RequestOperation<I, O, E> {
  return declare({ ...spec, kind: 'request' }) as RequestOperation<I, O, E>;
}

/**
 * Объявляет операцию вида `command`: указание без ответа с одним
 * обработчиком.
 *
 * Реплики обработчика делят нагрузку группой доставки. `durable: true`
 * означает, что указание не теряется, пока обработчик недоступен.
 *
 * @param spec - Имя, формы io, отказы, документация, `durable`
 * @returns Неизменяемую операцию со свойством `.emitter`
 *
 * @example
 * ```typescript
 * export const SendReceipt = makeCommand({
 *   name: 'billing.send-receipt',
 *   input: z.object({ orderId: z.string() }),
 *   durable: true,
 * });
 * ```
 */
export function makeCommand<
  I extends AnyPayload = undefined,
  O extends AnyOutput = undefined,
  E extends readonly AnyFailDefinition[] = [],
  Path extends string = string,
>(spec: CommandSpec<I, O, E, Path>): CommandOperation<I, O, E> {
  return declare({ ...spec, kind: 'command' }) as CommandOperation<I, O, E>;
}

/**
 * Объявляет операцию вида `event`: факт, который уже случился.
 *
 * Подписчиков у события ноль или больше, поэтому ответа нет и объявить
 * его нечем: `output` и `errors` в словаре невыразимы. Каждая реализация
 * называет себя `subscriber`.
 *
 * @param spec - Имя, форма io входа, документация, `durable`
 * @returns Неизменяемую операцию со свойством `.emitter`
 *
 * @example
 * ```typescript
 * export const OrderPlaced = makeEvent({
 *   name: 'orders.placed',
 *   input: z.object({ orderId: z.string() }),
 * });
 * ```
 */
export function makeEvent<
  I extends AnyPayload = undefined,
  Path extends string = string,
>(spec: EventSpec<I, Path>): EventOperation<I, undefined, []> {
  return declare({ ...spec, kind: 'event' } as OperationSpec<
    any,
    any,
    readonly AnyFailDefinition[],
    OperationKind
  >) as EventOperation<I, undefined, []>;
}
