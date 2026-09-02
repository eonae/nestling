/**
 * Kernel-модуль портов: рецепты вызывателей, шина и держатель исполнителей.
 *
 * Корень регистрирует его **всегда** — как kernel-модули конфига и
 * ambient-контекста: иначе в `assemble({ … })` пришлось бы писать про
 * порты, которых в приложении может и не быть. «Всегда» ничего не стоит:
 * вызыватели и держатель — члены семейств, поэтому без единого
 * `deps: [C.caller]` в графе не появляется ни одного узла, а шина
 * регистрируется только когда в приложении есть хоть одна реализация
 * операции.
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
import type { OperationTopology } from './topology.js';
import type { BusBindingBearer } from './transport.js';
import { busBindingOf, BusTransport$ } from './transport.js';

import type {
  BuiltContainer,
  InjectionToken,
  Module,
  ModuleProvider,
  Token,
} from '@nestling/container';
import {
  factoryProvider,
  familyOf,
  familyProvider,
  makeToken,
  makeTokenFamily,
} from '@nestling/container';
import type { AnyOperation, Emitter, Port } from '@nestling/operations';
import {
  EmitterFamily,
  lookupOperation,
  PortFamily,
} from '@nestling/operations';
import type { TransportRef } from '@nestling/pipeline';
import type { Dispatch, ITransport } from '@nestling/transport';

/**
 * Семейство токенов держателя исполнителей с единственным членом.
 *
 * Семейство, а не обычный провайдер, нужно ради цены «всегда»: узел
 * держателя появляется в графе только тогда, когда на него в `deps`
 * сослался рецепт вызывателя, который сам стал узлом графа.
 *
 * @internal
 */
const PortRuntimeFamily = makeTokenFamily<PortRuntime, [id: string]>(
  'PortRuntime',
);

/** Токен держателя исполнителей: наполняется фазой WIRE */
const PortRuntimeToken: Token<PortRuntime> = PortRuntimeFamily('kernel');

/**
 * Токен якоря запрошенных вызывателей.
 *
 * Члены семейств становятся узлами графа по `deps` **провайдеров**, а
 * декларация не провайдер: фаза WIRE резолвит её зависимости, когда граф
 * уже собран. Якорь — провайдер, который делает потребность декларации
 * видимой сборке. Без якоря `deps: [C.caller]` у endpoint'а давал бы «no
 * provider» в WIRE вместо вызывателя.
 *
 * @internal
 */
const PortAnchorToken: Token<Record<never, never>> =
  makeToken('kernel:PortAnchor');

/** Опции kernel-модуля портов */
export interface PortsKernelOptions {
  /** Топология реализаций, вычисленная discovery */
  implementations?: OperationTopology;

  /**
   * Токены зависимостей обнаруженных деклараций.
   *
   * Из них берутся члены семейств вызывателей: операция, запрошенный
   * только endpoint'ом, становится узлом графа наравне с операцией,
   * запрошенным провайдером.
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

/** Операция по имени члена семейства или понятная ошибка */
function requireOperation(name: string): AnyOperation {
  const operation = lookupOperation(name);

  if (!operation) {
    throw new Error(
      `Operation '${name}' is injected but not declared. Declare it with ` +
        `makeRequest({ name: '${name}', … }) and make sure the module that ` +
        `declares it is imported.`,
    );
  }

  return operation;
}

/** Паттерны co-located реализаций операции в этой сборке */
function patternsOf(topology: OperationTopology, name: string): string[] {
  return (topology.get(name)?.implementations ?? []).map(
    (implementation) => implementation.pattern,
  );
}

/**
 * Fail-fast недостижимой операции.
 *
 * Вызов, который заведомо некому обслужить, — ошибка компоновки, а не
 * рантайма. «Заведомо» здесь означает два условия сразу: co-located
 * реализации нет, и шина не доставляет за пределы процесса.
 *
 * При remote-шине отсутствие локального владельца не означает, что
 * владельца нет вовсе: он может жить в другом процессе. Тогда его
 * недоступность в рантайме — обычный отказ доставки, а не ошибка сборки.
 * Состав кластера на сборке не проверяется: это работа service discovery.
 */
function assertReachable(
  operation: AnyOperation,
  patterns: readonly string[],
  invoker: 'caller' | 'emitter',
  remote: boolean,
): void {
  if (patterns.length > 0 || operation.kind === 'event' || remote) {
    return;
  }

  throw new Error(
    `Operation '${operation.name}' (kind '${operation.kind}') is injected as ` +
      `'.${invoker}', but no selected feature implements it and this ` +
      `assembly has no intercom, so the call has nowhere to go. Either add ` +
      `the feature that implements it to 'select' (or close the selection ` +
      `over calls with 'select: { features, includeDeps: true }'), or ` +
      `assign the intercom role to a bus transport ('transports: ` +
      `[nats({ name: "events" })]' with 'intercom: "events"') when the owner ` +
      `lives in another process.`,
  );
}

/**
 * Топология, природа шины и политика — три входа биндинга. Вместе они
 * отвечают на один вопрос: уходит вызов через шину или через `dispatch`.
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
 * 3. **Иначе решает политика** — то же правило, что действовало до
 *    появления второго процесса: `always-remote` на in-proc шине ведёт
 *    себя так же, как при split-развёртывании с сетевой шиной.
 */
function bindsRemote(
  operation: AnyOperation,
  patterns: readonly string[],
  policy: DispatchPolicy,
  remote: boolean,
): boolean {
  if (remote && (operation.kind === 'event' || patterns.length === 0)) {
    return true;
  }

  return policy === 'always-remote';
}

/** Природа шины как вход биндинга: её нет — значит и remote-доставки нет */
const isRemote = (bus?: IMessageBus): boolean => bus?.remote === true;

/** Строит вызыватель `request`-операции по топологии, шине и политике */
function buildPort(
  name: string,
  topology: OperationTopology,
  runtime: PortRuntime,
  policy: DispatchPolicy,
  remote: boolean,
): Port<any> {
  const operation = requireOperation(name);

  if (operation.kind !== 'request') {
    throw new Error(
      `Operation '${name}' is a '${operation.kind}' operation: it has no ` +
        `'.caller', use '.emitter' instead.`,
    );
  }

  const patterns = patternsOf(topology, name);
  assertReachable(operation, patterns, 'caller', remote);

  const context: InvokerContext = { operation, runtime, patterns };

  // Решение принимается один раз, при создании узла, и замыкается в
  // константу. При вызове выбор уже не повторяется
  return bindsRemote(operation, patterns, policy, remote)
    ? makeRemotePort(context)
    : makeLocalPort(context);
}

/** Строит эмиттер `command`/`event`-операции по топологии, шине и политике */
function buildEmitter(
  name: string,
  topology: OperationTopology,
  runtime: PortRuntime,
  policy: DispatchPolicy,
  remote: boolean,
): Emitter<any> {
  const operation = requireOperation(name);

  if (operation.kind === 'request') {
    throw new Error(
      `Operation '${name}' is a 'request' operation: it has no '.emitter', ` +
        `use '.caller' instead.`,
    );
  }

  const patterns = patternsOf(topology, name);
  assertReachable(operation, patterns, 'emitter', remote);

  const context: InvokerContext = { operation, runtime, patterns };

  return bindsRemote(operation, patterns, policy, remote)
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
  const topology: OperationTopology = options.implementations ?? new Map();

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
   * и биндинг ведёт себя так же, как до появления удалённой стороны.
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
    const family = familyOf(token);

    return family === PortFamily || family === EmitterFamily;
  });

  if (anchored.length > 0) {
    providers.push(factoryProvider(PortAnchorToken, () => ({}), anchored));
  }

  if (busInGraph) {
    // Транспорт шины — первичный узел. `MessageBus$` — алиас его инстанса.
    // Направление такое, потому что поставщик не обязательно один: корень
    // может зарегистрировать под этим токеном брокера, и тогда in-proc
    // реализации в графе нет вовсе. Шина в приложении одна, и оба токена
    // дают один и тот же инстанс независимо от того, кто его поставил
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
  };
};

/**
 * Шина, умеющая подписать свои маршруты до фазы START.
 *
 * Структурная проверка, а не `instanceof`: сторонняя реализация
 * `IMessageBus` может не иметь inbound-стороны вовсе (её маршруты придут
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
 * может звать порт, а старт приёма запросов транспортами идёт после
 * `@OnStart`.
 *
 * Приложение без единого вызывателя проходит шаг вхолостую: держателя в
 * графе просто нет.
 *
 * @param container - Собранный контейнер приложения
 * @param dispatches - Диспетчеры транспортов, созданные в WIRE
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
 * Операции, которые эта сборка обслуживает **недолговечно**.
 *
 * Долговечность объявлена операцией, а способность — шиной. Их
 * расхождение не роняет сборку (иначе локальный запуск `--features=all`
 * без брокера был бы невозможен), но обязано быть видимым. Возврат —
 * значение, а не печать: тест читает состав, а не парсит stdout — тот же
 * приём, что у отчёта `check()`.
 *
 * Пустой список означает одно из трёх: долговечных операций нет, шина
 * долговечность умеет, или шины в графе нет вовсе.
 *
 * @param container - Собранный контейнер приложения
 * @param declarations - Обнаруженные декларации (носители биндинга)
 * @returns Имена операций по алфавиту, без повторов
 */
export function undurableOperations(
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
