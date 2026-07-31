/**
 * `implement` — реализация контракта как обычная декларация-значение.
 *
 * Inbound-сторона порта уже существовала: «я обрабатываю контракт» это
 * буквально endpoint. Поэтому конструктор тонкий — тот же kernel-примитив
 * `makeEndpoint`, что у `httpEndpoint`/`cliEndpoint`, транспорт шины и
 * транспорт-специфичный биндинг. Всё остальное (дискавери, `dispatch`,
 * pipeline, страж границы, `policies`, `app.call`) достаётся даром.
 */

import type { AnyContract, Contract, ContractKind } from './contract.js';
import { BusTransport$, makeBusBinding } from './transport.js';

import type { InjectionToken } from '@nestling/container';
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
 * операции принадлежит контракту: попытка переобъявить их — ошибка
 * компиляции в точке декларации, а не расхождение, найденное в проде.
 */
export interface ImplementDictionary<
  P extends AnyInput = AnyInput,
  PN = never,
> {
  /**
   * Имя подписчика — адрес подписки на событие.
   *
   * Обязательно для `event` и запрещено для `request`/`command`. Автором
   * задаётся явно: в мире с NATS это имя queue-group и durable-подписки,
   * поэтому выводить его из имени модуля значило бы привязать сетевой
   * адрес к внутренней структуре кода.
   */
  subscriber?: string;

  /**
   * Pipeline этой реализации. Классы-юниты допустимы: они попадают в
   * `TNeeds` декларации и гасятся вместе с `deps`.
   */
  pipeline?: Pipeline<AnyInput, P, PN>;

  /** Причина вывода реализации из-под инвариантов сборки */
  detached?: string;

  /** @internal интерфейс операции принадлежит контракту */
  input?: never;

  /** @internal интерфейс операции принадлежит контракту */
  output?: never;

  /** @internal интерфейс операции принадлежит контракту */
  errors?: never;
}

/** Поля словаря, которые контракт объявляет сам */
const INTERFACE_FIELDS = ['input', 'output', 'errors'] as const;

/** Fail-fast для JS-потребителей: контракт — значение `makeContract` */
function assertContract(contract: unknown): asserts contract is AnyContract {
  const kind = (contract as { kind?: unknown } | undefined)?.kind;
  const name = (contract as { name?: unknown } | undefined)?.name;

  if (typeof name !== 'string' || typeof kind !== 'string') {
    throw new TypeError(
      `implement(contract, { … }): the first argument must be a contract ` +
        `value created by makeContract().`,
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
  contract: AnyContract,
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
 * @returns Паттерн декларации: адрес ручки внутри процесса
 */
function patternOf(contract: AnyContract, subscriber: unknown): string {
  const kind = contract.kind as ContractKind;

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
 * Строит реализацию контракта.
 *
 * @param contract - Контракт, объявленный `makeContract`
 * @param declaration - Словарь исполнения: `deps`, `pipeline`, `handle`
 * @returns Декларация-значение для `endpoints:` модуля
 * @throws {Error} Отсутствующий или лишний `subscriber`, переобъявление
 * интерфейса контракта
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
  K extends ContractKind,
  P extends AnyInput = AnyInput,
  PN = never,
>(
  contract: Contract<I, O, E, K>,
  declaration: ImplementDictionary<P, PN> & {
    deps?: undefined;
    handle: HandlerFn<I, O, P, FailsOf<E>>;
  },
): EndpointDefinition<I, O, P, PN>;
export function implement<
  I extends AnyPayload,
  O extends AnyOutput,
  E extends readonly AnyFailDefinition[],
  K extends ContractKind,
  P extends AnyInput = AnyInput,
  PN = never,
  D extends InjectionToken[] = InjectionToken[],
>(
  contract: Contract<I, O, E, K>,
  declaration: ImplementDictionary<P, PN> & {
    deps: [...D];
    handle: HandlerFactory<D, I, O, P, FailsOf<E>>;
  },
): EndpointDefinition<I, O, P, PN | D[number]>;
export function implement<
  I extends AnyPayload,
  O extends AnyOutput,
  E extends readonly AnyFailDefinition[],
  K extends ContractKind,
  P extends AnyInput = AnyInput,
  PN = never,
  C extends HandlerClass<I, O, P, FailsOf<E>> = HandlerClass<
    I,
    O,
    P,
    FailsOf<E>
  >,
>(
  contract: Contract<I, O, E, K>,
  declaration: ImplementDictionary<P, PN> & {
    deps?: undefined;
    handle: C;
  },
): EndpointDefinition<I, O, P, PN | C>;
export function implement(
  contract: AnyContract,
  declaration: ImplementDictionary<any, unknown> & {
    deps?: InjectionToken[];
    handle: unknown;
  },
): AnyEndpointDefinition {
  assertContract(contract);
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
    }),
  });
}
