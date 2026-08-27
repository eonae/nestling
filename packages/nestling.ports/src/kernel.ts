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
import type { InvokerContext } from './invoker.js';
import {
  makeLocalEmitter,
  makeLocalPort,
  makeRemoteEmitter,
  makeRemotePort,
} from './invoker.js';
import type { PortFailureInfo } from './runtime.js';
import { PortRuntime } from './runtime.js';
import type { ContractTopology } from './topology.js';
import type { BusBindingBearer } from './transport.js';
import { busBindingOf, BusTransport$ } from './transport.js';

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
import type { AnyContract, Emitter, Port } from '@nestling/contracts';
import { EmitterFamily, lookupContract, PortFamily } from '@nestling/contracts';
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

  /**
   * Корень поставил транспорт шины сам (`nats()` в `transports:`).
   *
   * Тогда kernel-модуль свою реализацию **не** регистрирует: шина в
   * приложении ровно одна, и брокер не «добавляется» к in-proc шине, а
   * является ею. Признак выводится корнем из состава `transports:` — сам
   * kernel-модуль о словаре сборки не знает.
   */
  rootSuppliesBus?: boolean;

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
 * рантайма. «Заведомо» держится на двух условиях сразу: co-located
 * реализации нет **и** шина не доставляет за пределы процесса. При
 * remote-шине «владельца не выбрали здесь» перестаёт означать «владельца
 * нет»: он живёт в другом процессе, и его недоступность в рантайме —
 * обычный отказ доставки, а не ошибка сборки. Проверять состав кластера на
 * сборке модель не станет: это service discovery, которого она избегает.
 */
function assertReachable(
  contract: AnyContract,
  patterns: readonly string[],
  invoker: 'port' | 'emitter',
  remote: boolean,
): void {
  if (patterns.length > 0 || contract.kind === 'event' || remote) {
    return;
  }

  throw new Error(
    `Contract '${contract.name}' (kind '${contract.kind}') is injected as ` +
      `'.${invoker}', but no selected module implements it and the bus of ` +
      `this application does not deliver outside the process: there is ` +
      `nothing to call. Either declare the implementation with ` +
      `implement(${contract.name}, { … }) in 'endpoints:' of a module (check ` +
      `that the feature owning it is part of 'select'), or register a remote ` +
      `bus transport (for example nats()) if the owner lives in another ` +
      `process.`,
  );
}

/**
 * Три входа биндинга — топология, природа шины и политика — сведённые в
 * один вопрос: уходит вызов через шину или через `dispatch`.
 *
 * Порядок условий и есть правило:
 *
 * 1. **`event` при remote-шине — всегда через шину.** Множество подписчиков
 *    события открыто, часть их живёт в других процессах, и локальный
 *    dispatch доставил бы только своим, молча потеряв остальных. Co-located
 *    подписчик при этом не остаётся без сообщения и не получает двух: он
 *    подписан на свой же subject у брокера, и публикация возвращается ему
 *    обычной доставкой, ровно одной копией на группу.
 * 2. **Нет co-located реализации при remote-шине — через шину.** До сюда
 *    доходят только те, кого пропустил `assertReachable`.
 * 3. **Иначе решает политика** — ровно как до появления второй стороны
 *    провода: `always-remote` на in-proc шине остаётся репетицией split'а.
 */
function bindsRemote(
  contract: AnyContract,
  patterns: readonly string[],
  policy: DispatchPolicy,
  remote: boolean,
): boolean {
  if (remote && (contract.kind === 'event' || patterns.length === 0)) {
    return true;
  }

  return policy === 'always-remote';
}

/** Природа шины как вход биндинга: её нет — значит и remote-доставки нет */
const isRemote = (bus?: IMessageBus): boolean => bus?.remote === true;

/** Строит вызыватель `request`-контракта по топологии, шине и политике */
function buildPort(
  name: string,
  topology: ContractTopology,
  runtime: PortRuntime,
  policy: DispatchPolicy,
  remote: boolean,
): Port<any> {
  const contract = requireContract(name);

  if (contract.kind !== 'request') {
    throw new Error(
      `Contract '${name}' is a '${contract.kind}' contract: it has no ` +
        `'.port', use '.emitter' instead.`,
    );
  }

  const patterns = patternsOf(topology, name);
  assertReachable(contract, patterns, 'port', remote);

  const context: InvokerContext = { contract, runtime, patterns };

  // Решение принимается один раз — здесь, при инстанцировании узла — и
  // замыкается в константу: на вызове выбора уже не происходит
  return bindsRemote(contract, patterns, policy, remote)
    ? makeRemotePort(context)
    : makeLocalPort(context);
}

/** Строит эмиттер `command`/`event`-контракта по топологии, шине и политике */
function buildEmitter(
  name: string,
  topology: ContractTopology,
  runtime: PortRuntime,
  policy: DispatchPolicy,
  remote: boolean,
): Emitter<any> {
  const contract = requireContract(name);

  if (contract.kind === 'request') {
    throw new Error(
      `Contract '${name}' is a 'request' contract: it has no '.emitter', ` +
        `use '.port' instead.`,
    );
  }

  const patterns = patternsOf(topology, name);
  assertReachable(contract, patterns, 'emitter', remote);

  const context: InvokerContext = { contract, runtime, patterns };

  return bindsRemote(contract, patterns, policy, remote)
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

  // Шина в графе есть, если её поставил корень **или** если есть что
  // обслуживать. Приложение без реализаций и без корневой шины не платит за
  // порты ни одним узлом графа — как и прежде
  const rootSuppliesBus = options.rootSuppliesBus === true;
  const busInGraph = rootSuppliesBus || topology.size > 0;

  /**
   * Зависимости рецепта вызывателя.
   *
   * Шина в них появляется только когда она в графе есть: природа шины —
   * третий вход биндинга, и читать его нужно значением
   * (`IMessageBus.remote`), а не проверкой класса. Шины нет — читать нечего,
   * и биндинг остаётся тем же, каким был до второй стороны провода.
   */
  const invokerDeps = busInGraph
    ? [PortRuntimeToken, NestlingPortsConfig, MessageBus$]
    : [PortRuntimeToken, NestlingPortsConfig];

  const providers: ModuleProvider[] = [
    factoryProvider(
      PortRuntimeToken,
      () => new PortRuntime(options.onPortFailure),
      [],
    ),
    familyProvider(PortFamily, (name) => ({
      provide: PortFamily(name),
      useFactory: (
        runtime: PortRuntime,
        config: PortsConfig,
        bus?: IMessageBus,
      ) => buildPort(name, topology, runtime, config.dispatch, isRemote(bus)),
      deps: invokerDeps,
    })),
    familyProvider(EmitterFamily, (name) => ({
      provide: EmitterFamily(name),
      useFactory: (
        runtime: PortRuntime,
        config: PortsConfig,
        bus?: IMessageBus,
      ) =>
        buildEmitter(name, topology, runtime, config.dispatch, isRemote(bus)),
      deps: invokerDeps,
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

  if (busInGraph) {
    // Транспорт шины — первичный узел, `MessageBus$` — алиас его инстанса.
    // Направление именно такое, потому что поставщик может быть не один:
    // корень вправе зарегистрировать под этим токеном брокера, и тогда
    // in-proc реализации в графе нет вовсе. Шина в приложении одна, и оба
    // токена дают один и тот же инстанс независимо от того, кто его поставил
    if (!rootSuppliesBus) {
      providers.push(
        factoryProvider(BusTransport$, () => new InProcessBus(options.bus), []),
      );
    }

    providers.push(
      factoryProvider(
        MessageBus$,
        (transport: ITransport) => transport as unknown as IMessageBus,
        [BusTransport$],
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

/**
 * Контракты, которые эта сборка обслуживает **недолговечно**.
 *
 * Долговечность объявлена контрактом, а способность — шиной; их расхождение
 * не роняет сборку (иначе локальный запуск `--features=all` без брокера был
 * бы невозможен), но обязано быть видимым. Возврат — значение, а не печать:
 * тест читает состав, а не парсит stdout, — тот же приём, что у отчёта
 * `check()`.
 *
 * Пустой список означает одно из трёх: долговечных контрактов нет, шина
 * долговечность умеет, или шины в графе нет вовсе.
 *
 * @param container - Собранный контейнер приложения
 * @param declarations - Обнаруженные декларации (носители биндинга)
 * @returns Имена контрактов по алфавиту, без повторов
 */
export function undurableContracts(
  container: BuiltContainer,
  declarations: readonly BusBindingBearer[],
): readonly string[] {
  const bus = container.get(MessageBus$);

  if (!bus || bus.durable) {
    return [];
  }

  const subjects = new Set<string>();

  for (const declaration of declarations) {
    const binding = busBindingOf(declaration);

    if (binding?.durable) {
      subjects.add(binding.subject);
    }
  }

  return [...subjects].sort();
}
