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
import type {
  AssemblyPlan,
  AssemblySpec,
  WiredApp,
  WiredEndpoint,
} from './plan';
import { makePlan, TEST_SEAM } from './plan';

import { configKernel } from '@nestling/config';
import type {
  BuiltContainer,
  InjectionToken,
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

export type { AssemblySpec } from './plan';

/** Ручка в отчёте `check()`: чем обслуживается и кем объявлена */
export interface CheckedEndpoint {
  /** Паттерн декларации — то же, что увидит транспорт */
  readonly pattern: string;

  /** Имя транспорта, обслуживающего ручку */
  readonly transport: string;

  /** Модуль, объявивший ручку в `endpoints:` */
  readonly module: string;
}

/**
 * Отчёт структурной проверки: из чего собралось приложение.
 *
 * Отчёт — не лог, а значение: тест матрицы топологий сравнивает состав,
 * а не парсит stdout.
 */
export interface CheckReport {
  /** Имена выбранных фич, включая приехавшие по `dependsOn` */
  readonly features: readonly string[];

  /** Обнаруженные дискавери ручки с их транспортами */
  readonly endpoints: readonly CheckedEndpoint[];

  /** Транспорты приложения: перечисленные в корне и требуемые ручками */
  readonly transports: readonly string[];
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
  // Подстановок здесь нет и не будет: `assemble` не принимает `overrides`
  // даже как соблазн — это ключ тестового корня
  return new App(makePlan(spec));
}

/**
 * Приложение: результат `assemble`.
 *
 * Публичная поверхность — `run()`, `check()` и `close()`; конструктор
 * принимает внутренний план сборки, тип которого пакет не экспортирует.
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
    this.#container = container;

    // 2 INIT
    await container.init();

    // 3 WIRE — гашение зависимостей деклараций и `dispatch` на транспорт
    const { dispatches } = this.#wire(container, discovery);

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
   * Структурный смок: фазы 0 BOOTSTRAP и 1 ASSEMBLE — и остановка.
   *
   * Выполняется: резолв `select`, регистрация модулей и провайдеров,
   * дискавери, построение графа (конструкторы отрабатывают), сверка
   * требуемых транспортов и проверка форм io против их способностей.
   *
   * Не выполняется: `@OnInit`, WIRE, `@OnStart`, `serve` и `@OnDestroy` —
   * значит, ресурсы не захватываются (при условии, что их не захватывают
   * конструкторы, что и так нарушение фазовой модели).
   *
   * Собственный граф `check()` не сохраняет: на последующий `run()` вызов
   * не влияет, и гонять его можно по матрице `select`-топологий.
   *
   * @returns Отчёт о составе: фичи, ручки с транспортами, транспорты
   * @throws {Error} Те же ошибки, что бросил бы `run()` на этих фазах
   *
   * @example
   * ```typescript
   * for (const select of ['all', 'users', 'logging'] as const) {
   *   await assemble({ features, select, transports: [http()] }).check();
   * }
   * ```
   */
  async check(): Promise<CheckReport> {
    const { discovery } = await this.#assemble();

    return {
      features: this.#plan.features.map((feature) => feature.name),
      endpoints: discovery.endpoints.map(({ endpoint, moduleName }) => ({
        pattern: endpoint.pattern,
        transport: transportNameOf(endpoint.transport),
        module: moduleName,
      })),
      transports: this.#transportOrder(discovery).map((token) =>
        transportNameOf(token),
      ),
    };
  }

  /**
   * Внутренний шов тестового корня: фазы 0–3 и остановка.
   *
   * Ключ — символ из непубличного модуля, поэтому назвать этот метод из
   * прод-кода нечем; единственный его вызыватель — `@nestling/app/testing`.
   *
   * @internal
   */
  async [TEST_SEAM](): Promise<WiredApp> {
    if (this.#started) {
      throw new Error('Application is already running');
    }
    this.#started = true;

    // 1 ASSEMBLE — те же fail-fast'ы, что и в бою
    const { container, discovery } = await this.#assemble();
    this.#container = container;

    // 2 INIT
    await container.init();

    // 3 WIRE — и остановка: START, `#announce()` и `#attachSignals()` не
    // выполняются, поэтому тест не выходит в эфир и не трогает процесс
    const { wired } = this.#wire(container, discovery);

    this.#shutdown = new AbortController();

    return {
      container,
      endpoints: wired,
      features: this.#plan.features,
      signal: this.#shutdown.signal,
      close: () => this.close(),
    };
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
   *
   * Общий метод для `run()`, `check()` и шва: собранный контейнер он
   * возвращает, но не запоминает — иначе `check()` оставлял бы за собой
   * граф, который никто не будет ни инициализировать, ни разрушать.
   */
  async #assemble(): Promise<{
    container: BuiltContainer;
    discovery: EndpointDiscovery;
  }> {
    const builder = new ContainerBuilder({
      overrides: this.#plan.overrides,
      familyOverrides: this.#plan.familyOverrides,
    });

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

    this.#assertRequiredTransports(container, discovery);
    this.#assertFormsSupported(container, discovery);

    return { container, discovery };
  }

  /**
   * Фаза 3: гасит зависимости деклараций контейнером и строит `dispatch`
   * на каждый транспорт.
   *
   * Один `dispatch` — один транспорт: транспорт получает только свои ручки.
   *
   * Попутно строится карта «исходная декларация → её исполнимая копия и
   * диспетчер её транспорта»: боевому прогону она не нужна, а тестовому
   * даёт адресацию ручки по идентичности значения.
   */
  #wire(
    container: BuiltContainer,
    discovery: EndpointDiscovery,
  ): {
    dispatches: Map<TransportRef, Dispatch>;
    wired: Map<AnyEndpointDefinition, WiredEndpoint>;
  } {
    const executable = new Map<TransportRef, ExecutableDeclaration[]>();
    const resolvedByDeclaration = new Map<
      AnyEndpointDefinition,
      {
        executable: ExecutableDeclaration;
        transport: TransportRef;
        moduleName: string;
      }
    >();

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
      resolvedByDeclaration.set(endpoint, {
        executable: resolved,
        transport: endpoint.transport,
        moduleName,
      });
    }

    const dispatches = new Map(
      [...executable].map(([token, endpoints]) => [
        token,
        makeDispatch(endpoints),
      ]),
    );

    const wired = new Map<AnyEndpointDefinition, WiredEndpoint>();
    for (const [declaration, resolved] of resolvedByDeclaration) {
      const dispatch = dispatches.get(resolved.transport);

      if (dispatch) {
        wired.set(declaration, {
          declaration,
          executable: resolved.executable,
          dispatch,
          moduleName: resolved.moduleName,
        });
      }
    }

    return { dispatches, wired };
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
