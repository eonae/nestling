/**
 * Kernel-модуль портов: рецепты вызывателей, шина и держатель исполнителей.
 *
 * Корень регистрирует его **всегда** — как kernel-модули конфига и
 * ambient-контекста: иначе в `build({ … })` пришлось бы писать про
 * порты, которых в приложении может и не быть. «Всегда» ничего не стоит:
 * вызыватели и держатель — токены семейств, поэтому без единого
 * `deps: [C.caller]` в графе не появляется ни одного узла, а шина
 * регистрируется только когда в приложении есть хоть одна реализация
 * операции.
 */

import { Logger$ } from '../logger/tokens.js';
import type { KernelMetricsWriter } from '../metrics/index.js';
import { KernelMetrics } from '../metrics/index.js';
import type { TransportRef } from '../pipeline/index.js';
import type { Dispatch, ITransport } from '../transport/index.js';

import type { IMessageBus, InProcessBusOptions } from './bus.js';
import { InProcessBus, MessageBus$ } from './bus.js';
import type { DispatchPolicy } from './config.js';
import type { InvokerContext } from './invoker.js';
import {
  makeLocalEmitter,
  makeLocalPort,
  makeRemoteEmitter,
  makeRemotePort,
} from './invoker.js';
import { observeEmitter, observePort } from './observe.js';
import { PortRuntime } from './runtime.js';
import type { OperationTopology } from './topology.js';
import type { BusBindingBearer } from './transport.js';
import { busBindingOf, BusTransport$ } from './transport.js';

import type {
  BuiltContainer,
  Module,
  ModuleProvider,
  Token,
} from '@nestlingjs/container';
import {
  factoryProvider,
  familyProvider,
  makeTokenFamily,
} from '@nestlingjs/container';
import type { Logger } from '@nestlingjs/logging';
import type { AnyOperation, Emitter, Port } from '@nestlingjs/operations';
import {
  EmitterFamily,
  lookupOperation,
  PortFamily,
} from '@nestlingjs/operations';

/**
 * Семейство DI-токенов держателя исполнителей с единственным DI-токеном.
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

/** DI-токен держателя исполнителей: наполняется фазой WIRE */
const PortRuntimeToken: Token<PortRuntime> = PortRuntimeFamily('kernel');

/** Опции kernel-модуля портов */
export interface PortsKernelOptions {
  /** Топология реализаций, вычисленная discovery */
  implementations?: OperationTopology;

  /** Опции in-proc шины; логгер шина получает от kernel-модуля */
  bus?: Pick<InProcessBusOptions, 'buffer'>;

  /**
   * Корень поставил транспорт шины сам (`nats()` в `transports:`).
   *
   * Тогда kernel-модуль свою реализацию **не** регистрирует: шина в
   * приложении ровно одна, и брокер не «добавляется» к in-proc шине, а
   * является ею. Признак выводится корнем из состава `transports:` — сам
   * kernel-модуль о словаре сборки не знает.
   */
  rootSuppliesBus?: boolean;

  /**
   * Шина приложения доставляет за пределы процесса.
   *
   * Вопрос другой, чем у `rootSuppliesBus`: тот отвечает, **кто
   * регистрирует** шину, этот — **куда она доставляет**. Шина, объявленная
   * транспортом, но живущая в процессе, выразима: корень её поставил, а
   * наружу она не доставляет.
   *
   * Значение приходит из объявления интеркома (`BusDeclaration.remote`), а
   * не от экземпляра: читает его фаза BUILD, где экземпляров ещё нет.
   */
  remote?: boolean;

  /**
   * Политика диспатча — третий вход биндинга; без опции `local-first`.
   *
   * Приходит значением, а не DI-зависимостью, по той же причине, что
   * топология и природа шины: путь вызывателя выбирает рецепт семейства, а
   * рецепт узлов графа не резолвит. Значение у корня есть — секция
   * `nestlingPorts` лежит в снимке фазы 0.
   *
   * Способ настройки от этого не меняется: тот же ключ той же секции, те
   * же источники и `vars()`.
   */
  dispatch?: DispatchPolicy;
}

/** Операция по имени токена семейства или понятная ошибка */
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
      `build has no intercom, so the call has nowhere to go. Either add ` +
      `the feature that implements it to the build argument (or close ` +
      `the selection over calls with 'build({ features, includeDeps: ` +
      `true })'), or ` +
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
 *    доходят только те, кого пропустила проверка достижимости: она стоит
 *    в том же рецепте, строкой выше.
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

/**
 * План вызывателя: всё, что решено на сборке.
 *
 * Значения в нём нет — только операция, паттерны её co-located реализаций
 * и выбранный путь. Создать вызыватель по плану может и фабрика: ей
 * остаётся подставить держатель исполнителей и писателя метрик.
 */
interface InvokerPlan {
  readonly operation: AnyOperation;
  readonly patterns: readonly string[];
  readonly binding: 'local' | 'remote';
}

/**
 * Решает всё, что решается на сборке, — тело рецепта семейства.
 *
 * Три отказа идут цепочкой и именно в этом порядке: объявление операции
 * импортировано, вид операции подходит запрошенному вызывателю, операция
 * достижима. Неимпортированное объявление выглядит как операция без
 * реализации, и отказ достижимости увёл бы автора не туда.
 *
 * Путь выбирается здесь же и замыкается в план: при вызове выбор уже не
 * повторяется, а при создании значения — тем более.
 */
function planInvoker(
  name: string,
  invoker: 'caller' | 'emitter',
  options: Required<Pick<PortsKernelOptions, 'remote' | 'dispatch'>> & {
    topology: OperationTopology;
  },
): InvokerPlan {
  const operation = requireOperation(name);

  if (invoker === 'caller' && operation.kind !== 'request') {
    throw new Error(
      `Operation '${name}' is a '${operation.kind}' operation: it has no ` +
        `'.caller', use '.emitter' instead.`,
    );
  }

  if (invoker === 'emitter' && operation.kind === 'request') {
    throw new Error(
      `Operation '${name}' is a 'request' operation: it has no '.emitter', ` +
        `use '.caller' instead.`,
    );
  }

  const patterns = patternsOf(options.topology, name);
  assertReachable(operation, patterns, invoker, options.remote);

  return {
    operation,
    patterns,
    binding: bindsRemote(operation, patterns, options.dispatch, options.remote)
      ? 'remote'
      : 'local',
  };
}

/** Собирает вызыватель `request`-операции по готовому плану */
function makePort(
  plan: InvokerPlan,
  runtime: PortRuntime,
  metrics: KernelMetricsWriter,
): Port<any> {
  const context: InvokerContext = {
    operation: plan.operation,
    runtime,
    patterns: plan.patterns,
  };
  const port =
    plan.binding === 'remote'
      ? makeRemotePort(context)
      : makeLocalPort(context);

  // Обёртка ставится всегда: запись идёт в store ядра, который есть у
  // любого приложения, и условия «метрики настроены» больше нет
  return observePort(port, plan.operation, plan.binding, metrics);
}

/** Собирает эмиттер `command`/`event`-операции по готовому плану */
function makeEmitter(
  plan: InvokerPlan,
  runtime: PortRuntime,
  metrics: KernelMetricsWriter,
): Emitter<any> {
  const context: InvokerContext = {
    operation: plan.operation,
    runtime,
    patterns: plan.patterns,
  };
  const emitter =
    plan.binding === 'remote'
      ? makeRemoteEmitter(context)
      : makeLocalEmitter(context);

  return observeEmitter(emitter, plan.operation, plan.binding, metrics);
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

  // Три входа биндинга — одним значением на весь kernel-модуль: топология
  // от discovery, природа шины от объявления интеркома, политика из снимка
  // фазы 0. Ни одного из них нет в графе, поэтому решать можно в рецепте
  const inputs = {
    topology,
    remote: options.remote === true,
    dispatch: options.dispatch ?? 'local-first',
  } as const;

  /**
   * Зависимости рецепта вызывателя: только то, чего на сборке нет.
   *
   * Держатель исполнителей наполняется фазой WIRE, писатель метрик —
   * экземпляр. Ни шины, ни конфига здесь нет: путь вызывателя выбран
   * рецептом, и фабрике остаётся собрать значение по готовому плану.
   */
  const invokerDeps = [PortRuntimeToken, KernelMetrics];

  const providers: ModuleProvider[] = [
    factoryProvider(
      PortRuntimeToken,
      (logger: Logger) => new PortRuntime(logger),
      [Logger$('nestling:ports')],
    ),
    familyProvider(PortFamily, (name) => {
      // Тело рецепта — фаза BUILD: отсюда приходят все отказы вызывателя,
      // и сюда доходят входы, которые останавливаются до создания значений
      const plan = planInvoker(name, 'caller', inputs);

      return {
        provide: PortFamily(name),
        useFactory: (runtime: PortRuntime, metrics: KernelMetricsWriter) =>
          makePort(plan, runtime, metrics),
        deps: invokerDeps,
      };
    }),
    familyProvider(EmitterFamily, (name) => {
      const plan = planInvoker(name, 'emitter', inputs);

      return {
        provide: EmitterFamily(name),
        useFactory: (runtime: PortRuntime, metrics: KernelMetricsWriter) =>
          makeEmitter(plan, runtime, metrics),
        deps: invokerDeps,
      };
    }),
  ];

  if (busInGraph) {
    // Транспорт шины — первичный узел. `MessageBus$` — алиас его инстанса.
    // Направление такое, потому что поставщик не обязательно один: корень
    // может зарегистрировать под этим DI-токеном брокера, и тогда in-proc
    // реализации в графе нет вовсе. Шина в приложении одна, и оба DI-токена
    // дают один и тот же инстанс независимо от того, кто его поставил
    if (!rootSuppliesBus) {
      providers.push(
        factoryProvider(
          BusTransport$,
          (logger: Logger) => new InProcessBus({ ...options.bus, logger }),
          [Logger$('nestling:bus')],
        ),
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
