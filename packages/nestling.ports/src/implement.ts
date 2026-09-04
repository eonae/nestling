/**
 * `implement` — реализация операции как обычная декларация-значение.
 *
 * Inbound-сторона порта уже существовала: «я обрабатываю операция» это
 * буквально endpoint. Поэтому конструктор тонкий: тот же примитив ядра
 * `makeEndpoint`, что у `httpEndpoint`/`cliEndpoint`, плюс транспорт шины
 * и транспорт-специфичный биндинг. Всё остальное (discovery, `dispatch`,
 * pipeline, проверка на границе, `policies`, `app.call`) достаётся без
 * дополнительного кода.
 */

import { BusTransport$, makeBusBinding } from './transport.js';

import type {
  AnyOperation,
  Operation,
  OperationKind,
  ValidateOperationFails,
} from '@nestling/operations';
import type {
  AnyEndpointDefinition,
  AnyFail,
  AnyFailDefinition,
  AnyInput,
  AnyOutput,
  AnyPayload,
  EndpointDefinition,
  FailsOf,
  HandlerClass,
  HandlerFn,
  Pipeline,
} from '@nestling/pipeline';
import { assertLayerFailsDeclared, makeEndpoint } from '@nestling/pipeline';

/**
 * Словарь реализации: только исполнение.
 *
 * `input`, `output` и `errors` объявлены как `never`, потому что интерфейс
 * операции принадлежит операции: попытка переобъявить их — ошибка
 * компиляции в точке декларации, а не расхождение, найденное в проде.
 */
export interface ImplementDictionary<
  C extends AnyOperation = AnyOperation,
  P extends AnyInput = AnyInput,
  PN = never,
  PF extends AnyFail = never,
> {
  /**
   * Pipeline этой реализации. Классы-юниты допустимы: они попадают в
   * `TNeeds` декларации и получают инстансы вместе с классом-хендлером.
   *
   * Отказы, объявленные слоями пайплайна, обязаны входить в `errors:`
   * операции: контракт импортирует вызывающая сторона, и пайплайна
   * реализации она не видит. У события `errors:` нет, поэтому слой с
   * доменным отказом там не компилируется.
   */
  pipeline?: Pipeline<AnyInput, P, PN, PF> & ValidateOperationFails<C, PF>;

  /** Причина вывода реализации из-под инвариантов сборки */
  detached?: string;

  /** @internal интерфейс операции принадлежит операции */
  input?: never;

  /** @internal интерфейс операции принадлежит операции */
  output?: never;

  /** @internal интерфейс операции принадлежит операции */
  errors?: never;
}

/**
 * Слот имени подписчика: обязателен у события и невыразим у остальных.
 *
 * Правило вида проверяет тип, а не только рантайм: у события 0..N
 * подписчиков, и каждый называет себя сам — в мире с NATS это имя
 * queue-group и durable-подписки, поэтому выводить его из имени модуля
 * значило бы привязать сетевой адрес к внутренней структуре кода. У
 * запроса и команды владелец ровно один, и подписчиков у них нет.
 */
export type SubscriberSlot<K extends OperationKind> = K extends 'event'
  ? {
      /** Имя подписчика — адрес подписки на событие */
      subscriber: string;
    }
  : {
      /** @internal у операции с одним владельцем подписчиков нет */
      subscriber?: never;
    };

/** Поля словаря, которые операция объявляет сама */
const INTERFACE_FIELDS = ['input', 'output', 'errors'] as const;

/** Fail-fast для JS-потребителей: операция — значение `makeRequest` */
function assertOperation(
  operation: unknown,
): asserts operation is AnyOperation {
  const kind = (operation as { kind?: unknown } | undefined)?.kind;
  const name = (operation as { name?: unknown } | undefined)?.name;

  if (typeof name !== 'string' || typeof kind !== 'string') {
    throw new TypeError(
      `implement(operation, { … }): the first argument must be a operation ` +
        `value created by makeRequest / makeCommand / makeEvent.`,
    );
  }
}

/**
 * Fail-fast переобъявления интерфейса — для JS-потребителей.
 *
 * Типы делают `input:` в словаре невыразимым, но без рантайм-проверки
 * тихо проигнорированное поле выглядело бы как «схема есть, а не
 * применяется».
 */
function assertNoInterfaceOverride(
  declaration: Record<string, unknown>,
  operation: AnyOperation,
): void {
  for (const field of INTERFACE_FIELDS) {
    if (declaration[field] !== undefined) {
      throw new TypeError(
        `implement(${operation.name}, { … }): '${field}' belongs to the ` +
          `operation and cannot be redeclared by its implementation.`,
      );
    }
  }
}

/**
 * Fail-fast имени подписчика: обязательно ровно там, где подписчиков много.
 *
 * @returns Паттерн декларации: адрес endpoint'а внутри процесса
 */
function patternOf(operation: AnyOperation, subscriber: unknown): string {
  const kind = operation.kind as OperationKind;

  if (kind === 'event') {
    if (typeof subscriber !== 'string' || subscriber.trim().length === 0) {
      throw new Error(
        `implement(${operation.name}, { … }): a '${kind}' operation has 0..N ` +
          `subscribers, so every implementation must name itself with ` +
          `'subscriber: <name>' — it is the subscription address (and, with ` +
          `a broker, the queue-group and durable name).`,
      );
    }

    return `${operation.name}@${subscriber}`;
  }

  if (subscriber !== undefined) {
    throw new Error(
      `implement(${operation.name}, { … }): a '${kind}' operation has exactly ` +
        `one owner, so it has no subscribers — drop 'subscriber'.`,
    );
  }

  return operation.name;
}

/**
 * Строит реализацию операции.
 *
 * @param operation - Операция, объявленный `makeRequest`
 * @param declaration - Словарь исполнения: `pipeline`, `handler`, `subscriber`
 * @returns Декларация-значение для `endpoints:` модуля
 * @throws {Error} Отсутствующий или лишний `subscriber`, переобъявление
 * интерфейса операции
 *
 * @example
 * ```typescript
 * \@Injectable([Ledger])
 * class ChargeCardHandler {
 *   constructor(private readonly ledger: Ledger) {}
 *
 *   async handle(input: ChargeInput) {
 *     return new Ok(await this.ledger.charge(input));
 *   }
 * }
 *
 * export const ChargeCardImpl = implement(ChargeCard, {
 *   pipeline: basePipeline,
 *   handler: ChargeCardHandler,
 * });
 * ```
 */
export function implement<
  I extends AnyPayload,
  O extends AnyOutput,
  E extends readonly AnyFailDefinition[],
  K extends OperationKind,
  P extends AnyInput = AnyInput,
  PN = never,
  PF extends AnyFail = never,
>(
  operation: Operation<I, O, E, K>,
  declaration: ImplementDictionary<Operation<I, O, E, K>, P, PN, PF> &
    SubscriberSlot<K> & {
      handler: HandlerFn<I, O, P, FailsOf<E>>;
    },
): EndpointDefinition<I, O, P, PN>;
export function implement<
  I extends AnyPayload,
  O extends AnyOutput,
  E extends readonly AnyFailDefinition[],
  K extends OperationKind,
  P extends AnyInput = AnyInput,
  PN = never,
  PF extends AnyFail = never,
  C extends HandlerClass<I, O, P, FailsOf<E>> = HandlerClass<
    I,
    O,
    P,
    FailsOf<E>
  >,
>(
  operation: Operation<I, O, E, K>,
  declaration: ImplementDictionary<Operation<I, O, E, K>, P, PN, PF> &
    SubscriberSlot<K> & {
      handler: C;
    },
): EndpointDefinition<I, O, P, PN | C>;
export function implement(
  operation: AnyOperation,
  declaration: ImplementDictionary<AnyOperation, any, unknown, AnyFail> & {
    subscriber?: string;
    handler: unknown;
  },
): AnyEndpointDefinition {
  assertOperation(operation);
  assertNoInterfaceOverride(
    declaration as unknown as Record<string, unknown>,
    operation,
  );
  assertLayerFailsDeclared(
    declaration.pipeline,
    operation.errors,
    `implement(${operation.name}, { … })`,
  );

  const { subscriber, ...rest } = declaration;
  const pattern = patternOf(operation, subscriber);

  return (makeEndpoint as (options: unknown) => AnyEndpointDefinition)({
    ...rest,
    transport: BusTransport$,
    pattern,
    input: operation.input,
    output: operation.output,
    errors: operation.errors,
    binding: makeBusBinding({
      subject: operation.name,
      kind: operation.kind,
      ...(typeof subscriber === 'string' ? { subscriber } : {}),
      // Долговечность берётся из операции и только из него: у реализации
      // нет способа её объявить, потому что издатель в другом процессе о
      // такой декларации не узнал бы и опубликовал бы мимо потока
      ...(operation.durable === undefined
        ? {}
        : { durable: operation.durable }),
    }),
  });
}
