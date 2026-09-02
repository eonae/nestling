/* eslint-disable no-console */
/**
 * `assemble` — единственный composition root и фазовый рантайм приложения.
 *
 * Фазы: `0 BOOTSTRAP → 1 ASSEMBLE → 2 INIT → 3 WIRE → 4 START → 5 RUN`
 * и `6 SHUTDOWN` строгим реверсом. Фаза 0 живёт вне `assemble` (выбор
 * считается в корне). Фазы 0 и 1 fail-fast: ошибка сборки предшествует
 * захвату любых ресурсов.
 */

import type { EndpointDiscovery } from './discovery';
import { discoverEndpoints, Discovery$ } from './discovery';
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
import { ContainerBuilder, tokenId, valueProvider } from '@nestling/container';
import type {
  AnyEndpointDefinition,
  PolicySubject,
  SchemaDocConverter,
  TransportRef,
} from '@nestling/pipeline';
import {
  assertFormsSupported,
  contextKernel,
  transportNameOf,
} from '@nestling/pipeline';
import type { ContractDescriptor } from '@nestling/ports';
import {
  bindPorts,
  busBindingOf,
  BusTransport$,
  collectImplementations,
  describeContract,
  portsKernel,
  undurableContracts,
} from '@nestling/ports';
import type {
  Dispatch,
  ExecutableDeclaration,
  ITransport,
} from '@nestling/transport';
import { makeDispatch } from '@nestling/transport';

export type { AssemblySpec } from './plan';

/** Endpoint в отчёте `check()`: чем обслуживается и кем объявлен */
export interface CheckedEndpoint {
  /** Паттерн декларации — то же, что увидит транспорт */
  readonly pattern: string;

  /** Имя транспорта, обслуживающего endpoint */
  readonly transport: string;

  /** Модуль, объявивший endpoint в `endpoints:` */
  readonly module: string;

  /**
   * Причина вывода endpoint'а из-под инвариантов, если он помечен
   * `detached: '<причина>'`.
   *
   * Отчёт — значение: тест матрицы топологий сравнивает состав
   * detached-endpoint'ов, а не парсит stdout.
   */
  readonly detached?: string;
}

/**
 * Отчёт структурной проверки: из чего собралось приложение.
 *
 * Отчёт — не лог, а значение: тест матрицы топологий сравнивает состав,
 * а не парсит stdout.
 */
export interface CheckReport {
  /** Имена выбранных фич, включая добавленные через `dependsOn` */
  readonly features: readonly string[];

  /** Endpoint'ы, найденные discovery, с их транспортами */
  readonly endpoints: readonly CheckedEndpoint[];

  /** Транспорты приложения: перечисленные в корне и требуемые endpoint'ами */
  readonly transports: readonly string[];

  /**
   * Дескрипторы контрактов, **опубликованных** этой топологией.
   *
   * Строятся из discovery — по декларациям с bus-биндингом, а не из
   * приватного реестра `makeContract`. Источник истины о составе
   * приложения один: дерево модулей. Реестр включал бы всё
   * импортированное, в том числе контракты соседних фич, которые это
   * приложение не публикует.
   */
  readonly contracts: readonly ContractDescriptor[];
}

/** Опции структурной проверки */
export interface CheckOptions {
  /**
   * Конвертеры листовых схем (`SchemaDocConverter`).
   *
   * Отсутствие конвертера для вендора — не ошибка: лист дескриптора
   * помечается непрозрачным, и `check()` из-за этого не падает.
   * Строгость выбирает потребитель дескриптора, а не проверка.
   */
  readonly converters?: readonly SchemaDocConverter[];
}

/**
 * Собирает приложение.
 *
 * Единственный публичный composition root: `modules` и `features`
 * совмещаются, транспорты задаются провайдерами, привязки конфига —
 * полем `config`.
 *
 * @param spec - Словарь сборки. Все поля опциональны
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
 * Дескрипторы контрактов, опубликованных этой сборкой.
 *
 * Источник — discovery: декларация с bus-биндингом и есть «я это
 * обслуживаю». У события подписчиков может быть несколько, а контракт
 * один, поэтому дескрипторы сводятся по имени. Порядок отчёта — по
 * имени, чтобы он не зависел от обхода дерева модулей.
 */
function publishedContracts(
  discovery: EndpointDiscovery,
  options: CheckOptions,
): readonly ContractDescriptor[] {
  const byName = new Map<string, ContractDescriptor>();

  for (const { endpoint } of discovery.endpoints) {
    const binding = busBindingOf(endpoint);

    if (!binding || byName.has(binding.subject)) {
      continue;
    }

    byName.set(binding.subject, describeContract(endpoint, options));
  }

  return [...byName.values()].sort((left, right) =>
    left.name < right.name ? -1 : 1,
  );
}

/**
 * Приложение: результат `assemble`.
 *
 * Публичная поверхность — `run()`, `check()` и `close()`. Конструктор
 * принимает внутренний план сборки, тип которого пакет не экспортирует.
 */
export class App {
  readonly #plan: AssemblyPlan;

  #container?: BuiltContainer;

  /**
   * Транспорты в порядке запуска (фаза START).
   *
   * Shutdown идёт этим списком в реверсе.
   */
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

    // 1 ASSEMBLE — граф, discovery и все fail-fast'ы до захвата ресурсов
    const { container, discovery } = await this.#assemble();
    this.#container = container;

    // 2 INIT
    await container.init();

    // 3 WIRE — резолв зависимостей деклараций и `dispatch` на транспорт
    const { dispatches } = this.#wire(container, discovery);

    // 4 START — сначала хуки графа, затем старт приёма запросов
    // транспортами
    await container.start();

    this.#shutdown = new AbortController();
    for (const [token, dispatch] of dispatches) {
      const transport = container.getOrThrow<ITransport>(
        token as InjectionToken<ITransport>,
      );

      await transport.serve(dispatch, this.#shutdown.signal);
      this.#serving.push({ token, transport });
    }

    this.#announce(discovery);
    this.#attachSignals();
  }

  /**
   * Структурный смок: фазы 0 BOOTSTRAP и 1 ASSEMBLE — и остановка.
   *
   * Выполняется: резолв `select`, регистрация модулей и провайдеров,
   * discovery, построение графа (конструкторы отрабатывают), сверка
   * требуемых транспортов, проверка форм io против их способностей и
   * проверка объявленных политик.
   *
   * Не выполняется: `@OnInit`, WIRE, `@OnStart`, `serve` и `@OnDestroy`.
   * Значит, ресурсы не захватываются, при условии что их не захватывают
   * конструкторы, что и так нарушение фазовой модели.
   *
   * Собственный граф `check()` не сохраняет: на последующий `run()` вызов
   * не влияет, и гонять его можно по матрице `select`-топологий.
   *
   * @param options - Конвертеры схем для дескрипторов контрактов. Вызов
   * без аргумента ведёт себя ровно как прежде
   * @returns Отчёт о составе: фичи, endpoint'ы с транспортами, транспорты
   * и дескрипторы опубликованных контрактов
   * @throws {Error} Те же ошибки, что бросил бы `run()` на этих фазах
   *
   * @example
   * ```typescript
   * for (const select of ['all', 'users', 'logging'] as const) {
   *   await assemble({ features, select, transports: [http()] }).check();
   * }
   * ```
   */
  async check(options: CheckOptions = {}): Promise<CheckReport> {
    const { discovery } = await this.#assemble();

    return {
      features: this.#plan.features.map((feature) => feature.name),
      endpoints: discovery.endpoints.map(({ endpoint, moduleName }) => ({
        pattern: endpoint.pattern,
        transport: transportNameOf(endpoint.transport),
        module: moduleName,
        ...(endpoint.detached === undefined
          ? {}
          : { detached: endpoint.detached }),
      })),
      transports: this.#transportOrder(discovery).map((token) =>
        transportNameOf(token),
      ),
      contracts: publishedContracts(discovery, options),
    };
  }

  /**
   * Внутренний шов тестового корня: фазы 0–3 и остановка.
   *
   * Ключ — символ из непубличного модуля, поэтому назвать этот метод из
   * прод-кода нечем. Единственный его вызыватель — `@nestling/app/testing`.
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
    // выполняются, поэтому тест не начинает принимать запросы и не
    // трогает процесс
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
   * Порядок: взвод сигнала, затем `close()` транспортов в обратном
   * порядке, затем `container.destroy()`. Идемпотентен.
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

    // 3. И только теперь — `@OnDestroy` в реверсе топологического
    // порядка
    await this.#container?.destroy();
    this.#container = undefined;

    this.#detachSignals?.();
    this.#detachSignals = undefined;
  }

  /**
   * Фаза 1: дерево модулей, discovery, граф, сверка транспортов и форм,
   * инварианты сборки — именно в этом порядке.
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

    // Kernel-модуль конфига регистрируется всегда: иначе сценарий
    // «источник — только env, про конфиг в корне ничего не пишем» не
    // работал бы. Без привязок читалка тривиальна, а рецепты семейств не
    // создают ни одного узла, пока никто не инжектит секцию.
    builder.register(configKernel([...this.#plan.config]));

    // Kernel-модуль ambient-контекста — по той же причине и с той же ценой:
    // без единого `Ctx(...)` в `deps` он не создаёт ни одного узла, зато
    // в корне про request-контекст не пишется ни строки
    builder.register(contextKernel());

    // Discovery — по дереву модулей, отобранных `select`: невыбранные
    // фичи в нём не участвуют вовсе. Считается до регистрации модулей,
    // потому что топология реализаций контрактов нужна kernel-модулю
    // портов уже на регистрации: функция чистая, порядок ни на что не
    // влияет
    const discovery = discoverEndpoints(this.#plan.modules);

    // Состав приложения — узел графа. Регистрируется всегда и без
    // условий: провайдер-значение ничего не стоит, а условная
    // регистрация сделала бы satellite-модуль (генератор документации,
    // реестр) зависимым от флага в корне. Значение — то самое, что
    // вычислено строкой выше: второй discovery не запускается, поэтому
    // «обнаруженное» и «инжектированное» всегда совпадают.
    builder.register(valueProvider(Discovery$, discovery));

    // Kernel-модуль портов — по тем же правилам, что конфиг и контекст:
    // регистрируется всегда, а узлы заводит только под запрошенные
    // вызыватели и под реально объявленные реализации
    builder.register(
      portsKernel({
        implementations: collectImplementations(discovery.endpoints),
        // Зависимости деклараций — тоже потребность: endpoint, зовущий
        // порт, обязан получить вызыватель наравне с провайдером, который
        // его инжектит
        requested: discovery.endpoints.flatMap(
          ({ endpoint }) => endpoint.deps ?? [],
        ),
        // Транспорт шины в `transports:` корня — единственный вход ветки
        // «шину поставил корень»: так подключается брокер, и in-proc
        // реализация тогда не регистрируется вовсе
        rootSuppliesBus: this.#plan.transportTokens.includes(
          BusTransport$ as TransportRef,
        ),
      }),
    );

    if (this.#plan.modules.length > 0) {
      builder.register(...this.#plan.modules);
    }

    if (this.#plan.providers.length > 0) {
      builder.register(...this.#plan.providers);
    }

    if (this.#plan.transports.length > 0) {
      builder.register(...(this.#plan.transports as Provider[]));
    }

    const container = await builder.build();

    this.#assertRequiredTransports(container, discovery);
    this.#assertFormsSupported(container, discovery);
    // Инварианты — последними: сперва «граф вообще собирается», потом
    // утверждения на нём. Политика, ругающаяся на endpoint
    // незарегистрированного транспорта, увела бы автора не туда.
    this.#assertPolicies(discovery);

    return { container, discovery };
  }

  /**
   * Фаза 3: резолвит зависимости деклараций через контейнер и строит
   * `dispatch` на каждый транспорт.
   *
   * Один `dispatch` — один транспорт: транспорт получает только свои
   * endpoint'ы.
   *
   * Попутно строится карта «исходная декларация — её исполнимая копия и
   * диспетчер её транспорта». Боевому прогону она не нужна, а тестовому
   * даёт адресацию endpoint'а по идентичности значения.
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

    // Транспорт без единого обнаруженного endpoint'а — это допустимо: у
    // него пустой `dispatch`, и он всё равно начинает принимать запросы
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

    // Связывание вызывателей контрактов с исполнителем — здесь и только
    // здесь: `dispatch` создаётся в WIRE, поэтому раньше связывать не с
    // чем, а позже транспорт уже начал бы принимать запросы. Приложение
    // без единого порта проходит шаг вхолостую: держателя в графе
    // просто нет.
    bindPorts(container, dispatches);

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
   * появившиеся в discovery.
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
   * Достаёт зависимость декларации из контейнера, называя в ошибке
   * endpoint, модуль-объявитель и способ починки.
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
      const name = tokenId(token);

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

  /**
   * Проверяет объявленные инварианты на обнаруженных endpoint'ах.
   *
   * Содержимое политики `App` не разбирает: его дело — собрать субъекты
   * из discovery (`{ endpoint, moduleName }` уже структурно совпадает с
   * `PolicySubject`), позвать `check` и отформатировать результат.
   *
   * Прогоняются **все** политики: чинить инварианты по одному
   * endpoint'у за прогон — не режим работы, поэтому нарушения
   * складываются и бросаются одним исключением.
   */
  #assertPolicies(discovery: EndpointDiscovery): void {
    if (this.#plan.policies.length === 0) {
      return;
    }

    const subjects: readonly PolicySubject[] = discovery.endpoints;

    const groups: string[] = [];
    let total = 0;

    for (const policy of this.#plan.policies) {
      const violations = policy.check(subjects);
      if (violations.length === 0) {
        continue;
      }

      total += violations.length;
      groups.push(
        `policy: ${policy.describe()}\n` +
          violations
            .map(
              ({ pattern, transport, moduleName, detail }) =>
                `  - ${pattern} (${transport}, module '${moduleName}'): ${detail}`,
            )
            .join('\n'),
      );
    }

    if (total === 0) {
      return;
    }

    throw new Error(
      `${total} endpoint violation(s) of assembly policies:\n\n` +
        `${groups.join('\n\n')}\n\n` +
        `Fix each handle by composing the required layer into its ` +
        `'pipeline:', or opt out deliberately with ` +
        `detached: '<reason>' in its declaration.`,
    );
  }

  /**
   * Состав сборки одной строкой: что выбрано и что начало принимать
   * запросы.
   *
   * Плюс список detached-endpoint'ов с причинами: opt-out из
   * инвариантов обязан быть поверхностью для аудита, а не строчкой в
   * diff'е одного файла. Пустой список не печатается вовсе.
   */
  #announce(discovery: EndpointDiscovery): void {
    const features = this.#plan.features.map((feature) => feature.name);
    const transports = this.#serving.map(({ token }) => transportNameOf(token));

    console.log(
      `[nestling] features: ${features.join(', ') || '(none)'}; ` +
        `transports: ${transports.join(', ') || '(none)'}`,
    );

    // Деградация долговечности — рядом с составом и по тем же основаниям,
    // что список detached-endpoint'ов: расхождение объявленного с
    // обслуживаемым обязано быть поверхностью для аудита, а не тихим
    // «как-нибудь доставится»
    const undurable = this.#container
      ? undurableContracts(
          this.#container,
          discovery.endpoints.map(({ endpoint }) => endpoint),
        )
      : [];

    if (undurable.length > 0) {
      console.log(
        `[nestling] durable delivery is not available on this bus: ` +
          `${undurable.join(', ')} — served without persistence. Register a ` +
          `bus transport that supports it (for example nats()) to make the ` +
          `guarantee real.`,
      );
    }

    for (const { endpoint } of discovery.endpoints) {
      if (endpoint.detached === undefined) {
        continue;
      }

      console.log(
        `[nestling] detached from policies: ${endpoint.pattern} ` +
          `(${transportNameOf(endpoint.transport)}) — ${endpoint.detached}`,
      );
    }
  }

  /** Корректная остановка по сигналам процесса. Снимается в `close()` */
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
