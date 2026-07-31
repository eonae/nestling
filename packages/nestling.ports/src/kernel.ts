/**
 * Kernel-модуль портов: рецепты вызывателей, шина и держатель исполнителей.
 *
 * Корень регистрирует его **всегда** — как kernel-модули конфига и
 * ambient-контекста: иначе в `assemble({ … })` пришлось бы писать про
 * порты, которых в приложении может и не быть. «Всегда» ничего не стоит:
 * вызыватели и держатель — члены семейств, поэтому без единого
 * `deps: [C.port]` в графе не появляется ни одного узла, а шина
 * регистрируется только когда в приложении есть хоть одна реализация
 * контракта.
 */

import type { IMessageBus, InProcessBusOptions } from './bus.js';
import { InProcessBus, MessageBus$ } from './bus.js';
import type { DispatchPolicy, PortsConfig } from './config.js';
import { NestlingPortsConfig } from './config.js';
import type { AnyContract } from './contract.js';
import type { Emitter, Port } from './families.js';
import { EmitterFamily, PortFamily } from './families.js';
import type { InvokerContext } from './invoker.js';
import {
  makeLocalEmitter,
  makeLocalPort,
  makeRemoteEmitter,
  makeRemotePort,
} from './invoker.js';
import { lookupContract } from './registry.js';
import type { PortFailureInfo } from './runtime.js';
import { PortRuntime } from './runtime.js';
import type { ContractTopology } from './topology.js';
import { BusTransport$ } from './transport.js';

import type {
  BuiltContainer,
  InjectionToken,
  Module,
  ModuleProvider,
  TokenString,
} from '@nestling/container';
import {
  factoryProvider,
  familyProvider,
  lookupFamilyMember,
  makeToken,
  makeTokenFamily,
} from '@nestling/container';
import type { TransportRef } from '@nestling/pipeline';
import type { Dispatch, ITransport } from '@nestling/transport';

/**
 * Семейство держателя исполнителей — с единственным членом.
 *
 * Семейство, а не обычный провайдер, ровно ради цены «всегда»: узел
 * появляется только тогда, когда его упомянул рецепт материализованного
 * вызывателя.
 *
 * @internal
 */
const PortRuntimeFamily = makeTokenFamily<PortRuntime, [id: string]>(
  'PortRuntime',
);

/** Токен держателя исполнителей: наполняется фазой WIRE */
const PortRuntimeToken: TokenString<PortRuntime> = PortRuntimeFamily('kernel');

/**
 * Токен якоря запрошенных вызывателей.
 *
 * Члены семейств материализуются по `deps` **провайдеров**, а декларация
 * провайдером не является: её зависимости гасит фаза WIRE, когда граф уже
 * построен. Якорь и есть тот провайдер, который делает потребность
 * декларации видимой сборке — без него `deps: [C.port]` у ручки давал бы
 * «no provider» в WIRE вместо вызывателя.
 *
 * @internal
 */
const PortAnchorToken: TokenString<Record<never, never>> =
  makeToken('kernel:PortAnchor');

/** Опции kernel-модуля портов */
export interface PortsKernelOptions {
  /** Топология реализаций, вычисленная дискавери */
  implementations?: ContractTopology;

  /**
   * Токены зависимостей обнаруженных деклараций.
   *
   * Из них берутся члены семейств вызывателей: контракт, запрошенный
   * только ручкой, обязан материализоваться наравне с запрошенным
   * провайдером.
   */
  requested?: readonly InjectionToken[];

  /** Опции in-proc шины */
  bus?: InProcessBusOptions;

  /** Диагностический хук вызывателей */
  onPortFailure?: (info: PortFailureInfo) => void;
}

/** Контракт по имени члена семейства или внятная ошибка */
function requireContract(name: string): AnyContract {
  const contract = lookupContract(name);

  if (!contract) {
    throw new Error(
      `Contract '${name}' is injected but not declared. Declare it with ` +
        `makeContract({ name: '${name}', … }) and make sure the module that ` +
        `declares it is imported.`,
    );
  }

  return contract;
}

/** Паттерны co-located реализаций контракта в этой сборке */
function patternsOf(topology: ContractTopology, name: string): string[] {
  return (topology.get(name)?.implementations ?? []).map(
    (implementation) => implementation.pattern,
  );
}

/**
 * Fail-fast недостижимого контракта.
 *
 * Вызов, который заведомо некому обслужить, — ошибка **компоновки**, а не
 * рантайма: в V1 remote-биндинга не существует (единственная шина
 * in-proc), поэтому отсутствие co-located реализации у `request`/`command`
 * означает, что фича собрана без своего соседа.
 */
function assertReachable(
  contract: AnyContract,
  patterns: readonly string[],
  invoker: 'port' | 'emitter',
): void {
  if (patterns.length > 0 || contract.kind === 'event') {
    return;
  }

  throw new Error(
    `Contract '${contract.name}' (kind '${contract.kind}') is injected as ` +
      `'.${invoker}', but no selected module implements it: there is nothing ` +
      `to call. Declare the implementation with ` +
      `implement(${contract.name}, { … }) in 'endpoints:' of a module, or ` +
      `check that the feature owning it is part of 'select'.`,
  );
}

/** Строит вызыватель `request`-контракта по топологии и политике */
function buildPort(
  name: string,
  topology: ContractTopology,
  runtime: PortRuntime,
  policy: DispatchPolicy,
): Port<any> {
  const contract = requireContract(name);

  if (contract.kind !== 'request') {
    throw new Error(
      `Contract '${name}' is a '${contract.kind}' contract: it has no ` +
        `'.port', use '.emitter' instead.`,
    );
  }

  const patterns = patternsOf(topology, name);
  assertReachable(contract, patterns, 'port');

  const context: InvokerContext = { contract, runtime, patterns };

  // Решение принимается один раз — здесь, при инстанцировании узла — и
  // замыкается в константу: на вызове выбора уже не происходит
  return policy === 'always-remote'
    ? makeRemotePort(context)
    : makeLocalPort(context);
}

/** Строит эмиттер `command`/`event`-контракта по топологии и политике */
function buildEmitter(
  name: string,
  topology: ContractTopology,
  runtime: PortRuntime,
  policy: DispatchPolicy,
): Emitter<any> {
  const contract = requireContract(name);

  if (contract.kind === 'request') {
    throw new Error(
      `Contract '${name}' is a 'request' contract: it has no '.emitter', ` +
        `use '.port' instead.`,
    );
  }

  const patterns = patternsOf(topology, name);
  assertReachable(contract, patterns, 'emitter');

  const context: InvokerContext = { contract, runtime, patterns };

  return policy === 'always-remote'
    ? makeRemoteEmitter(context)
    : makeLocalEmitter(context);
}

/**
 * Собирает kernel-модуль портов.
 *
 * @param options - Топология реализаций и опции шины
 *
 * @example
 * ```typescript
 * builder.register(portsKernel({ implementations }));
 * ```
 */
export const portsKernel = (options: PortsKernelOptions = {}): Module => {
  const topology: ContractTopology = options.implementations ?? new Map();

  const providers: ModuleProvider[] = [
    factoryProvider(
      PortRuntimeToken,
      () => new PortRuntime(options.onPortFailure),
      [],
    ),
    familyProvider(PortFamily, (name) => ({
      provide: PortFamily(name),
      useFactory: (runtime: PortRuntime, config: PortsConfig) =>
        buildPort(name, topology, runtime, config.dispatch),
      deps: [PortRuntimeToken, NestlingPortsConfig],
    })),
    familyProvider(EmitterFamily, (name) => ({
      provide: EmitterFamily(name),
      useFactory: (runtime: PortRuntime, config: PortsConfig) =>
        buildEmitter(name, topology, runtime, config.dispatch),
      deps: [PortRuntimeToken, NestlingPortsConfig],
    })),
  ];

  // Вызыватели, запрошенные декларациями: их потребность иначе не видна
  // сборке (см. `PortAnchorToken`)
  const anchored = (options.requested ?? []).filter((token) => {
    const member = lookupFamilyMember(String(token));

    return (
      member?.familyName === PortFamily.familyName ||
      member?.familyName === EmitterFamily.familyName
    );
  });

  if (anchored.length > 0) {
    providers.push(factoryProvider(PortAnchorToken, () => ({}), anchored));
  }

  // Шина заводится только там, где есть что обслуживать: приложение без
  // реализаций контрактов не платит за порты ни одним узлом графа
  if (topology.size > 0) {
    providers.push(
      factoryProvider(MessageBus$, () => new InProcessBus(options.bus), []),
      factoryProvider(
        BusTransport$,
        (bus: IMessageBus) => bus as unknown as ITransport,
        [MessageBus$],
      ),
    );
  }

  return {
    name: 'kernel:ports',
    providers,
    exports: [PortFamily, EmitterFamily, MessageBus$, BusTransport$],
  };
};

/**
 * Шина, умеющая подписать свои маршруты до выхода в эфир.
 *
 * Структурная проверка, а не `instanceof`: сторонняя реализация
 * `IMessageBus` вправе не иметь inbound-стороны вовсе (её маршруты придут
 * от брокера), и тогда шаг просто пропускается.
 */
interface RoutableBus {
  attach(dispatch: Dispatch): void;
}

const isRoutable = (bus: unknown): bus is RoutableBus =>
  typeof (bus as RoutableBus | null)?.attach === 'function';

/**
 * Связывает вызыватели с исполнителями — шаг фазы WIRE.
 *
 * Зовётся корнем после `makeDispatch` и до START. Делает две вещи:
 * наполняет держатель исполнителей и подписывает шину на subject'ы её
 * маршрутов. Второе — здесь, а не в `serve`, потому что `@OnStart` уже
 * вправе звать порт, а go-live транспортов идёт после `@OnStart`.
 *
 * Приложение без единого вызывателя проходит шаг вхолостую: держателя в
 * графе просто нет.
 *
 * @param container - Собранный контейнер приложения
 * @param dispatches - Диспетчеры транспортов, рождённые в WIRE
 */
export function bindPorts(
  container: BuiltContainer,
  dispatches: ReadonlyMap<TransportRef, Dispatch>,
): void {
  const runtime = container.get(PortRuntimeToken);

  if (!runtime) {
    return;
  }

  const bus = container.get(MessageBus$);
  const dispatch = dispatches.get(BusTransport$ as TransportRef);

  if (dispatch && isRoutable(bus)) {
    bus.attach(dispatch);
  }

  runtime.bind({
    ...(dispatch === undefined ? {} : { dispatch }),
    ...(bus === null ? {} : { bus }),
  });
}
