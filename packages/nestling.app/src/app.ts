/* eslint-disable no-console */
/**
 * `assemble` — единственный composition root и фазовый рантайм приложения.
 *
 * Фазы: `0 BOOTSTRAP → 1 ASSEMBLE → 2 INIT → 3 WIRE → 4 START → 5 RUN`
 * и `6 SHUTDOWN` строгим реверсом. Фаза 0 живёт вне `assemble` (выбор
 * считается в корне); фазы 0 и 1 fail-fast — ошибка сборки предшествует
 * захвату любых ресурсов.
 */

import type { EndpointDiscovery } from './discovery';
import { discoverEndpoints } from './discovery';
import type { Feature, FeatureSelection } from './feature';
import { modulesOf, resolveSelection } from './feature';

import type { ConfigBinding } from '@nestling/config';
import { configKernel } from '@nestling/config';
import type {
  BuiltContainer,
  InjectionToken,
  Module,
  Provider,
} from '@nestling/container';
import { ContainerBuilder } from '@nestling/container';
import type { AnyEndpointDefinition, TransportRef } from '@nestling/pipeline';
import { assertFormsSupported, transportNameOf } from '@nestling/pipeline';
import type {
  Dispatch,
  ExecutableDeclaration,
  ITransport,
} from '@nestling/transport';
import { makeDispatch } from '@nestling/transport';

/**
 * Словарь сборки приложения.
 *
 * Каждое поле опционально: приложение уровня L0 (модули + транспорт) не
 * упоминает ни фичу, ни `select`, ни конфиг.
 */
export interface AssemblySpec {
  /** Модули корня — они регистрируются наравне с модулями выбранных фич */
  modules?: readonly Module[];

  /** Провайдеры корня (когда заводить модуль незачем) */
  providers?: readonly Provider[];

  /** Фичи приложения; подмножество выбирается полем `select` */
  features?: readonly Feature[];

  /**
   * Выбор фич: `'all'`, `'orders,billing'` или `['orders','billing']`.
   * Отсутствует при заданных `features` — выбраны все.
   */
  select?: FeatureSelection;

  /**
   * Транспорты корня — **провайдеры** (`http()`, `cli()`), а не инстансы.
   * Сахар регистрации: тот же провайдер легально объявить в `providers:`
   * модуля, в том числе infra-модуля фичи.
   */
  transports?: readonly Provider<ITransport>[];

  /**
   * Привязки источников конфигурации: `[источник, таргет | таргет[]]`.
   *
   * Порядок задаёт приоритет; `process.env` — неявный пол и в списке не
   * упоминается. Приложению, которому хватает env, поле не нужно вовсе:
   * kernel-модуль конфига регистрируется всегда.
   */
  config?: readonly ConfigBinding[];
}

/**
 * Нормализованный план сборки.
 *
 * Тип **не экспортируется** из пакета: так `new App({ … })` невыразим по
 * типам, и единственной публичной точкой сборки остаётся `assemble`.
 *
 * @internal
 */
interface AssemblyPlan {
  readonly modules: readonly Module[];
  readonly providers: readonly Provider[];
  readonly transports: readonly Provider<ITransport>[];
  readonly transportTokens: readonly TransportRef[];
  readonly config: readonly ConfigBinding[];
  readonly features: readonly Feature[];
}

/** Токен, под которым провайдер регистрируется в контейнере */
function tokenOf(provider: Provider<ITransport>): TransportRef {
  const token =
    typeof provider === 'function'
      ? provider
      : (provider.provide as InjectionToken<ITransport>);

  return (typeof token === 'string' ? token : token.name) as TransportRef;
}

/**
 * Собирает приложение.
 *
 * Единственный публичный composition root: `modules` и `features`
 * совмещаются, транспорты приезжают провайдерами, привязки конфига —
 * полем `config`.
 *
 * @param spec - Словарь сборки; каждое поле опционально
 * @returns Приложение с методами `run()` и `close()`
 *
 * @example L0 — модули и транспорт
 * ```typescript
 * await assemble({
 *   modules: [OrdersModule],
 *   transports: [http({ port: 3000 })],
 * }).run();
 * ```
 *
 * @example L2 — фичи и выбор подмножества
 * ```typescript
 * await assemble({
 *   features: [OrdersFeature, BillingFeature],
 *   select: load(RootConfig).features,
 *   transports: [http()],
 * }).run();
 * ```
 */
export function assemble(spec: AssemblySpec = {}): App {
  // Фаза 1 начинается здесь: резолв выбора идёт до построения контейнера,
  // поэтому опечатка в имени фичи падает раньше любого `@OnInit`
  const features = resolveSelection(spec.features, spec.select);

  return new App({
    modules: [...(spec.modules ?? []), ...modulesOf(features)],
    providers: [...(spec.providers ?? [])],
    transports: [...(spec.transports ?? [])],
    transportTokens: (spec.transports ?? []).map((provider) =>
      tokenOf(provider),
    ),
    config: [...(spec.config ?? [])],
    features,
  });
}

/**
 * Приложение: результат `assemble`.
 *
 * Публичная поверхность — `run()` и `close()`; конструктор принимает
 * внутренний план сборки, тип которого пакет не экспортирует.
 */
export class App {
  readonly #plan: AssemblyPlan;

  #container?: BuiltContainer;

  /** Транспорты в порядке go-live: shutdown идёт этим списком в реверсе */
  #serving: { token: TransportRef; transport: ITransport }[] = [];

  /** Канал остановки, переданный транспортам в `serve` */
  #shutdown?: AbortController;

  #started = false;
  #closed = false;

  /** Снятие обработчиков сигналов процесса: закрытое приложение молчит */
  #detachSignals?: () => void;

  /** @internal конструируется только `assemble` */
  constructor(plan: AssemblyPlan) {
    this.#plan = plan;
  }

  /**
   * Проводит приложение по фазам 0–5 и остаётся в RUN.
   *
   * Ставит обработчики `SIGTERM`/`SIGINT`, переводящие приложение в
   * SHUTDOWN. Идемпотентен: повторный вызов ничего не пересобирает.
   */
  async run(): Promise<void> {
    if (this.#started) {
      return;
    }
    this.#started = true;

    // 1 ASSEMBLE — граф, дискавери и все fail-fast'ы до захвата ресурсов
    const { container, discovery } = await this.#assemble();

    // 2 INIT
    await container.init();

    // 3 WIRE — гашение зависимостей деклараций и `dispatch` на транспорт
    const dispatches = this.#wire(container, discovery);

    // 4 START — сначала хуки графа, затем go-live транспортов
    await container.start();

    this.#shutdown = new AbortController();
    for (const [token, dispatch] of dispatches) {
      const transport = container.getOrThrow<ITransport>(
        token as InjectionToken<ITransport>,
      );

      await transport.serve(dispatch, this.#shutdown.signal);
      this.#serving.push({ token, transport });
    }

    this.#announce();
    this.#attachSignals();
  }

  /**
   * Выполняет фазу SHUTDOWN строгим реверсом START.
   *
   * Порядок: взвод сигнала → `close()` транспортов в обратном порядке →
   * `container.destroy()`. Идемпотентен.
   */
  async close(): Promise<void> {
    if (this.#closed || !this.#started) {
      this.#closed = true;
      return;
    }
    this.#closed = true;

    // 1. Новые запросы не принимаем, in-flight отменяем кооперативно
    this.#shutdown?.abort();
    this.#shutdown = undefined;

    // 2. Дренаж соединений — в порядке, обратном порядку `serve`
    for (const { transport } of [...this.#serving].reverse()) {
      await transport.close?.();
    }
    this.#serving = [];

    // 3. И только теперь — `@OnDestroy` в реверсе топосорта
    await this.#container?.destroy();
    this.#container = undefined;

    this.#detachSignals?.();
    this.#detachSignals = undefined;
  }

  /**
   * Фаза 1: дерево модулей → дискавери → граф → сверка транспортов и форм.
   *
   * Всё, что может не сойтись, сходится здесь: до `@OnInit` не доходит ни
   * одна неудовлетворённая потребность.
   */
  async #assemble(): Promise<{
    container: BuiltContainer;
    discovery: EndpointDiscovery;
  }> {
    const builder = new ContainerBuilder();

    // Kernel-модуль конфига регистрируется всегда: иначе «только env → в
    // корне про конфиг не пишешь ничего» не работало бы. Без привязок
    // читалка тривиальна, а рецепты семейств не материализуют ничего,
    // пока никто не инжектит секцию.
    builder.register(configKernel([...this.#plan.config]));

    if (this.#plan.modules.length > 0) {
      builder.register(...this.#plan.modules);
    }

    if (this.#plan.providers.length > 0) {
      builder.register(...this.#plan.providers);
    }

    if (this.#plan.transports.length > 0) {
      builder.register(...(this.#plan.transports as Provider[]));
    }

    // Дискавери — по дереву модулей, отобранных `select`: невыбранные
    // фичи в нём не участвуют вовсе
    const discovery = discoverEndpoints(this.#plan.modules);

    const container = await builder.build();
    this.#container = container;

    this.#assertRequiredTransports(container, discovery);
    this.#assertFormsSupported(container, discovery);

    return { container, discovery };
  }

  /**
   * Фаза 3: гасит зависимости деклараций контейнером и строит `dispatch`
   * на каждый транспорт.
   *
   * Один `dispatch` — один транспорт: транспорт получает только свои ручки.
   */
  #wire(
    container: BuiltContainer,
    discovery: EndpointDiscovery,
  ): Map<TransportRef, Dispatch> {
    const executable = new Map<TransportRef, ExecutableDeclaration[]>();

    // Транспорт без единой обнаруженной ручки легален: у него пустой
    // `dispatch`, и он всё равно выходит в эфир
    for (const token of this.#transportOrder(discovery)) {
      executable.set(token, []);
    }

    for (const { endpoint, moduleName } of discovery.endpoints) {
      const resolved = endpoint.resolve((token) =>
        this.#requireDependency(container, token, endpoint.pattern, moduleName),
      );

      executable.get(endpoint.transport)?.push(resolved);
    }

    return new Map(
      [...executable].map(([token, endpoints]) => [
        token,
        makeDispatch(endpoints),
      ]),
    );
  }

  /**
   * Порядок транспортов: сперва перечисленные в `transports:` корня, затем
   * появившиеся в дискавери.
   *
   * Детерминированный, но не топологический: транспорта, зависящего от
   * другого транспорта, в V1 нет (см. Open Questions design'а).
   */
  #transportOrder(discovery: EndpointDiscovery): TransportRef[] {
    const order: TransportRef[] = [];
    const seen = new Set<TransportRef>();

    for (const token of [
      ...this.#plan.transportTokens,
      ...discovery.transports.keys(),
    ]) {
      if (seen.has(token)) {
        continue;
      }
      seen.add(token);
      order.push(token);
    }

    return order;
  }

  /**
   * Достаёт зависимость декларации из контейнера, называя в ошибке ручку,
   * модуль-объявитель и способ починки.
   *
   * Одинаково обслуживает все три источника: токен из `deps`,
   * класс-хендлер и класс-юнит пайплайна — для автора это одна и та же
   * незарегистрированная зависимость.
   */
  #requireDependency(
    container: BuiltContainer,
    token: InjectionToken,
    pattern: string,
    moduleName: string,
  ): unknown {
    const instance = container.get(token);

    if (!instance) {
      const name = typeof token === 'string' ? token : token.name;

      throw new Error(
        `Dependency '${name}' required by endpoint '${pattern}' ` +
          `declared in module '${moduleName}' is not available in the DI ` +
          `container. Register it in 'providers:' of a module ` +
          `(classes — with @Injectable).`,
      );
    }

    return instance;
  }

  /**
   * Сверяет транспортные токены деклараций с собранным графом.
   *
   * Отдельной «capability negotiation» нет: транспорт, которого нет в
   * графе, — та же незарегистрированная зависимость, что и любая другая.
   */
  #assertRequiredTransports(
    container: BuiltContainer,
    discovery: EndpointDiscovery,
  ): void {
    for (const [token, endpoints] of discovery.transports) {
      if (container.get(token as InjectionToken<ITransport>)) {
        continue;
      }

      const [{ endpoint, moduleName }] = endpoints;
      const name = transportNameOf(token);

      throw new Error(
        `Transport '${name}' is required by endpoint '${endpoint.pattern}' ` +
          `declared in module '${moduleName}', but is not registered in the ` +
          `container. Add it to 'transports:' of assemble({ … }) or to ` +
          `'providers:' of a module (for example ${name}()).`,
      );
    }
  }

  /**
   * Сверяет формы io деклараций со способностями инстансов транспортов.
   *
   * Точка проверки для `App` — фаза ASSEMBLE: здесь известны и декларации,
   * и инстансы из графа. Реализация и текст ошибки те же, что на
   * standalone-пути (`serve`).
   */
  #assertFormsSupported(
    container: BuiltContainer,
    discovery: EndpointDiscovery,
  ): void {
    for (const { endpoint, moduleName } of discovery.endpoints) {
      const transport = container.getOrThrow<ITransport>(
        endpoint.transport as InjectionToken<ITransport>,
      );

      assertFormsSupported(
        endpoint as AnyEndpointDefinition,
        transport.capabilities,
        `declared in module '${moduleName}'`,
      );
    }
  }

  /** Состав сборки одной строкой: что выбрано и что вышло в эфир */
  #announce(): void {
    const features = this.#plan.features.map((feature) => feature.name);
    const transports = this.#serving.map(({ token }) => transportNameOf(token));

    console.log(
      `[nestling] features: ${features.join(', ') || '(none)'}; ` +
        `transports: ${transports.join(', ') || '(none)'}`,
    );
  }

  /** Graceful shutdown по сигналам процесса; снимается в `close()` */
  #attachSignals(): void {
    const handlers: [NodeJS.Signals, () => void][] = (
      ['SIGTERM', 'SIGINT'] as NodeJS.Signals[]
    ).map((signal) => [
      signal,
      () => {
        console.log(`${signal} received, shutting down...`);
        void this.close();
      },
    ]);

    for (const [signal, handler] of handlers) {
      process.on(signal, handler);
    }

    this.#detachSignals = () => {
      for (const [signal, handler] of handlers) {
        process.off(signal, handler);
      }
    };
  }
}
