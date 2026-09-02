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

import type { InjectionToken } from '@nestling/container';
import type {
  AnyOperation,
  Operation,
  OperationKind,
} from '@nestling/contracts';
import type {
  AnyEndpointDefinition,
  AnyFailDefinition,
  AnyInput,
  AnyOutput,
  AnyPayload,
  EndpointDefinition,
  FailsOf,
  HandlerClass,
  HandlerFactory,
  HandlerFn,
  Pipeline,
} from '@nestling/pipeline';
import { makeEndpoint } from '@nestling/pipeline';

/**
 * Словарь реализации: только исполнение.
 *
 * `input`, `output` и `errors` объявлены как `never`, потому что интерфейс
 * операции принадлежит операции: попытка переобъявить их — ошибка
 * компиляции в точке декларации, а не расхождение, найденное в проде.
 */
export interface ImplementDictionary<
  P extends AnyInput = AnyInput,
  PN = never,
> {
  /**
   * Pipeline этой реализации. Классы-юниты допустимы: они попадают в
   * `TNeeds` декларации и гасятся вместе с `deps`.
   */
  pipeline?: Pipeline<AnyInput, P, PN>;

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
function assertOperation(contract: unknown): asserts contract is AnyOperation {
  const kind = (contract as { kind?: unknown } | undefined)?.kind;
  const name = (contract as { name?: unknown } | undefined)?.name;

  if (typeof name !== 'string' || typeof kind !== 'string') {
    throw new TypeError(
      `implement(contract, { … }): the first argument must be a contract ` +
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
  contract: AnyOperation,
): void {
  for (const field of INTERFACE_FIELDS) {
    if (declaration[field] !== undefined) {
      throw new TypeError(
        `implement(${contract.name}, { … }): '${field}' belongs to the ` +
          `contract and cannot be redeclared by its implementation.`,
      );
    }
  }
}

/**
 * Fail-fast имени подписчика: обязательно ровно там, где подписчиков много.
 *
 * @returns Паттерн декларации: адрес endpoint'а внутри процесса
 */
function patternOf(contract: AnyOperation, subscriber: unknown): string {
  const kind = contract.kind as OperationKind;

  if (kind === 'event') {
    if (typeof subscriber !== 'string' || subscriber.trim().length === 0) {
      throw new Error(
        `implement(${contract.name}, { … }): a '${kind}' contract has 0..N ` +
          `subscribers, so every implementation must name itself with ` +
          `'subscriber: <name>' — it is the subscription address (and, with ` +
          `a broker, the queue-group and durable name).`,
      );
    }

    return `${contract.name}@${subscriber}`;
  }

  if (subscriber !== undefined) {
    throw new Error(
      `implement(${contract.name}, { … }): a '${kind}' contract has exactly ` +
        `one owner, so it has no subscribers — drop 'subscriber'.`,
    );
  }

  return contract.name;
}

/**
 * Строит реализацию операции.
 *
 * @param contract - Операция, объявленный `makeRequest`
 * @param declaration - Словарь исполнения: `deps`, `pipeline`, `handle`
 * @returns Декларация-значение для `endpoints:` модуля
 * @throws {Error} Отсутствующий или лишний `subscriber`, переобъявление
 * интерфейса операции
 *
 * @example
 * ```typescript
 * export const ChargeCardImpl = implement(ChargeCard, {
 *   deps: [Ledger],
 *   pipeline: basePipeline,
 *   handle: (ledger) => async (input) => Ok.of(await ledger.charge(input)),
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
>(
  contract: Operation<I, O, E, K>,
  declaration: ImplementDictionary<P, PN> &
    SubscriberSlot<K> & {
      deps?: undefined;
      handle: HandlerFn<I, O, P, FailsOf<E>>;
    },
): EndpointDefinition<I, O, P, PN>;
export function implement<
  I extends AnyPayload,
  O extends AnyOutput,
  E extends readonly AnyFailDefinition[],
  K extends OperationKind,
  P extends AnyInput = AnyInput,
  PN = never,
  D extends InjectionToken[] = InjectionToken[],
>(
  contract: Operation<I, O, E, K>,
  declaration: ImplementDictionary<P, PN> &
    SubscriberSlot<K> & {
      deps: [...D];
      handle: HandlerFactory<D, I, O, P, FailsOf<E>>;
    },
): EndpointDefinition<I, O, P, PN | D[number]>;
export function implement<
  I extends AnyPayload,
  O extends AnyOutput,
  E extends readonly AnyFailDefinition[],
  K extends OperationKind,
  P extends AnyInput = AnyInput,
  PN = never,
  C extends HandlerClass<I, O, P, FailsOf<E>> = HandlerClass<
    I,
    O,
    P,
    FailsOf<E>
  >,
>(
  contract: Operation<I, O, E, K>,
  declaration: ImplementDictionary<P, PN> &
    SubscriberSlot<K> & {
      deps?: undefined;
      handle: C;
    },
): EndpointDefinition<I, O, P, PN | C>;
export function implement(
  contract: AnyOperation,
  declaration: ImplementDictionary<any, unknown> & {
    subscriber?: string;
    deps?: InjectionToken[];
    handle: unknown;
  },
): AnyEndpointDefinition {
  assertOperation(contract);
  assertNoInterfaceOverride(
    declaration as unknown as Record<string, unknown>,
    contract,
  );

  const { subscriber, ...rest } = declaration;
  const pattern = patternOf(contract, subscriber);

  return (makeEndpoint as (options: unknown) => AnyEndpointDefinition)({
    ...rest,
    transport: BusTransport$,
    pattern,
    input: contract.input,
    output: contract.output,
    errors: contract.errors,
    binding: makeBusBinding({
      subject: contract.name,
      kind: contract.kind,
      ...(typeof subscriber === 'string' ? { subscriber } : {}),
      // Долговечность берётся из операции и только из него: у реализации
      // нет способа её объявить, потому что издатель в другом процессе о
      // такой декларации не узнал бы и опубликовал бы мимо потока
      ...(contract.durable === undefined ? {} : { durable: contract.durable }),
    }),
  });
}
