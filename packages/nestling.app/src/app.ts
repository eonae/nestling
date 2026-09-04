/* eslint-disable no-console */
/**
 * `makeApp` — единственный composition root; `AssembledApp` — фазовый
 * рантайм приложения.
 *
 * Декларация (`makeApp`) описывает, что такое приложение. Сборка
 * (`app.assemble(select)`) выбирает, что запускает этот процесс. Фазы:
 * `0 BOOTSTRAP → 1 ASSEMBLE → 2 INIT → 3 WIRE → 4 START → 5 RUN` и
 * `6 SHUTDOWN` строгим реверсом; их выполняет `run()`. Фазы 0 и 1
 * fail-fast: ошибка сборки предшествует захвату любых ресурсов.
 */

import { assertFeatureBoundary, buildOwnerMap } from './boundary.js';
import type { EndpointDiscovery } from './discovery.js';
import { discoverEndpoints, Discovery$ } from './discovery.js';
import type { Bundle, Feature, FeatureSelection } from './feature.js';
import { modulesOf, resolveSelection } from './feature.js';
import type { CheckedOperation } from './operations.js';
import { mapOperations } from './operations.js';
import type {
  AppSpec,
  AssemblyPlan,
  NormalizedAppSpec,
  WiredApp,
  WiredEndpoint,
} from './plan.js';
import {
  CHECK_SEAM,
  makePlan,
  normalizeSpec,
  TEST_SEAM,
  transportTokensOf,
} from './plan.js';
import { closeOverCalls } from './selection.js';

import { configKernel } from '@nestling/config';
import type {
  BuiltContainer,
  InjectionToken,
  Module,
  ModuleProvider,
  Provider,
} from '@nestling/container';
import { ContainerBuilder, tokenId, valueProvider } from '@nestling/container';
import type {
  AnyEndpointDefinition,
  HandlerClass,
  PolicySubject,
  SchemaDocConverter,
  TransportRef,
} from '@nestling/pipeline';
import {
  assertFormsSupported,
  contextKernel,
  handlerClassOf,
  transportNameOf,
} from '@nestling/pipeline';
import type { OperationDescriptor } from '@nestling/ports';
import {
  bindPorts,
  busBindingOf,
  collectImplementations,
  describeOperation,
  portsKernel,
  undurableOperations,
} from '@nestling/ports';
import type {
  Dispatch,
  ExecutableDeclaration,
  ITransport,
  TransportDeclaration,
} from '@nestling/transport';
import { makeDispatch } from '@nestling/transport';

export type { AppSpec, NormalizedAppSpec } from './plan.js';

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
   * Дескрипторы операций, **опубликованных** этой топологией.
   *
   * Строятся из discovery — по декларациям с bus-биндингом, а не из
   * приватного реестра `makeRequest`. Источник истины о составе
   * приложения один: дерево модулей. Реестр включал бы всё
   * импортированное, в том числе операции соседних фич, которые это
   * приложение не публикует.
   */
  readonly published: readonly OperationDescriptor[];

  /**
   * Карта операций: что реализовано здесь, что уходит наружу и через
   * какой интерком.
   *
   * Отвечает на вопрос, который иначе задают запуском: этот процесс сам
   * обслуживает операцию или зовёт соседа.
   */
  readonly operations: readonly CheckedOperation[];
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
 * Бренд декларации приложения: неперечислимое symbol-свойство.
 *
 * По нему тестовый корень и матрица топологий отличают декларацию от
 * словаря, случайно переданного вместо неё.
 */
const APP_BRAND = Symbol.for('nestling:app');

/**
 * Объявляет приложение.
 *
 * Единственный публичный composition root: фичи перечисляются в
 * `features:`, сквозная инфраструктура — в `plugins:`, транспорты
 * объявляются экземплярами, привязки конфига — полем `config`. Выбор фич
 * в словаре не пишется: его принимает `assemble(select)`.
 *
 * Декларация проверяется при создании: бренды фич и плагинов, дубли
 * имён фич, закрытый перечень полей, интерком среди транспортов.
 *
 * @param spec - Словарь декларации. Все поля опциональны
 * @returns Декларация приложения с методами `assemble()` и `check()`
 * @throws {TypeError} Неизвестное поле словаря, не фича в `features`, не
 * плагин в `plugins`
 * @throws {Error} Одноимённые разные фичи, интерком вне списка транспортов
 *
 * @example Одна фича и транспорт
 * ```typescript
 * // app.ts
 * export const app = makeApp({
 *   features: [OrdersFeature],
 *   transports: [http({ port: 3000 })],
 * });
 *
 * // main.ts
 * await app.assemble().run();
 * ```
 *
 * @example Несколько фич, интерком и выбор в процессе
 * ```typescript
 * export const app = makeApp({
 *   features: [OrdersFeature, BillingFeature],
 *   plugins: [appLogging],
 *   transports: [http(), nats({ name: 'events' })],
 *   intercom: 'events',
 * });
 *
 * await app.assemble({ features: load(RootConfig).features, includeDeps: true }).run();
 * ```
 */
export function makeApp<const T extends readonly TransportDeclaration[] = []>(
  spec: AppSpec<T> = {},
): App {
  return new App(normalizeSpec(spec));
}

/**
 * Проверяет, что значение — декларация приложения, созданная `makeApp`.
 */
export function isApp(value: unknown): value is App {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[APP_BRAND] === true
  );
}

/**
 * Декларация приложения: результат `makeApp`.
 *
 * Значение, а не процесс: одна декларация собирается сколько угодно раз с
 * разным выбором. Публичная поверхность — `assemble(select?)` и
 * `check(select?, options?)`.
 */
export class App {
  /** Нормализованная декларация: списки скопированы, интерком найден */
  readonly spec: NormalizedAppSpec;

  /** @internal конструируется только `makeApp` */
  constructor(spec: NormalizedAppSpec) {
    this.spec = spec;

    Object.defineProperty(this, APP_BRAND, {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  /**
   * Собирает приложение для этого процесса.
   *
   * Вызов синхронный и ничего не читает: ни `process.env`, ни граф.
   * Фазы 0–5 выполняет `run()` собранного приложения; ошибки выбора
   * (неизвестное имя фичи, пустой выбор) — ошибки фазы ASSEMBLE, их
   * бросает `run()`.
   *
   * @param select - Выбор фич: `'all'`, `'orders,billing'`,
   * `['orders', 'billing']` или `{ features, includeDeps }`. Отсутствует —
   * выбраны все
   * @returns Собранное приложение с методами `run()` и `close()`
   */
  assemble(select?: FeatureSelection): AssembledApp {
    return new AssembledApp(makePlan(this.spec, select));
  }

  /**
   * Структурный смок: фазы 0 BOOTSTRAP и 1 ASSEMBLE — и остановка.
   *
   * Выполняется: резолв выбора, регистрация модулей и провайдеров,
   * discovery, построение графа (конструкторы отрабатывают), сверка
   * требуемых транспортов, проверка форм io против их способностей и
   * проверка объявленных политик.
   *
   * Не выполняется: `@OnInit`, WIRE, `@OnStart`, `serve` и `@OnDestroy`.
   * Значит, ресурсы не захватываются, при условии что их не захватывают
   * конструкторы, что и так нарушение фазовой модели.
   *
   * Проверка — «собрать и выбросить»: граф не сохраняется, на
   * последующий `assemble()` той же декларации вызов не влияет, и гонять
   * его можно по матрице `select`-топологий.
   *
   * @param select - Выбор фич в тех же формах, что у `assemble`
   * @param options - Конвертеры схем для дескрипторов операций. Вызов
   * без аргумента ведёт себя ровно как прежде
   * @returns Отчёт о составе: фичи, endpoint'ы с транспортами, транспорты
   * и дескрипторы опубликованных операций
   * @throws {Error} Те же ошибки, что бросил бы `run()` на этих фазах
   *
   * @example
   * ```typescript
   * for (const select of ['all', 'users', 'logging'] as const) {
   *   await app.check(select);
   * }
   * ```
   */
  async check(
    select?: FeatureSelection,
    options: CheckOptions = {},
  ): Promise<CheckReport> {
    return await new AssembledApp(makePlan(this.spec, select))[CHECK_SEAM](
      options,
    );
  }
}

/**
 * Дескрипторы операций, опубликованных этой сборкой.
 *
 * Источник — discovery: декларация с bus-биндингом и есть «я это
 * обслуживаю». У события подписчиков может быть несколько, а операция
 * один, поэтому дескрипторы сводятся по имени. Порядок отчёта — по
 * имени, чтобы он не зависел от обхода дерева модулей.
 */
function publishedOperations(
  discovery: EndpointDiscovery,
  options: CheckOptions,
): readonly OperationDescriptor[] {
  const byName = new Map<string, OperationDescriptor>();

  for (const { endpoint } of discovery.endpoints) {
    const binding = busBindingOf(endpoint);

    if (!binding || byName.has(binding.subject)) {
      continue;
    }

    byName.set(binding.subject, describeOperation(endpoint, options));
  }

  return [...byName.values()].sort((left, right) =>
    left.name < right.name ? -1 : 1,
  );
}

/** Класс, которым провайдер регистрирует узел, если это провайдер класса */
function providedClass(provider: ModuleProvider): unknown {
  if (typeof provider === 'function') {
    return provider;
  }

  const definition = provider as { useClass?: unknown; provide?: unknown };

  return definition.useClass ?? definition.provide;
}

/**
 * Модули, в чьих `providers:` встречается класс. Фабрики провайдеров не
 * разбираются: их значения известны только в `build()`, и повтор оттуда
 * ловит контейнер общей ошибкой о занятом токене.
 */
function modulesListing(
  cls: HandlerClass,
  modules: readonly Module[],
): string[] {
  return modules
    .filter(
      ({ providers }) =>
        Array.isArray(providers) &&
        providers.some((provider) => providedClass(provider) === cls),
    )
    .map(({ name }) => name);
}

/**
 * Приложение, собранное для этого процесса: результат `app.assemble()`.
 *
 * Публичная поверхность — `run()` и `close()`. Конструктор принимает
 * внутренний план сборки, тип которого пакет не экспортирует.
 */
export class AssembledApp {
  readonly #plan: AssemblyPlan;

  /**
   * Фактический состав фич: выбор, замкнутый по вызываемым операциям.
   *
   * Считается на фазе ASSEMBLE один раз: `run()`, проверка и шов обязаны
   * видеть один и тот же состав. До неё поле пусто.
   */
  #features?: readonly Feature[];

  /** Имена фич, названных в выборе, — для строки состава */
  #named: readonly string[] = [];

  #includeDeps = false;

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

  /** @internal конструируется только `App.assemble` и швами */
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
   * Структурная проверка: фазы 0–1 и отчёт о составе.
   *
   * Ключ — символ из непубличного модуля: снаружи проверку зовут через
   * `App.check()`, у собранного приложения такого метода нет.
   *
   * @internal
   */
  async [CHECK_SEAM](options: CheckOptions): Promise<CheckReport> {
    const { discovery } = await this.#assemble();

    return {
      features: this.#selectedFeatures().map((feature) => feature.name),
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
      published: publishedOperations(discovery, options),
      operations: mapOperations(
        discovery,
        this.#bundles(),
        this.#plan.spec.intercom?.name,
      ),
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
      features: this.#selectedFeatures(),
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

  /** Выбранные фичи; доступны после резолва выбора на фазе ASSEMBLE */
  #selectedFeatures(): readonly Feature[] {
    return this.#features ?? [];
  }

  /** Единицы сборки: фактически выбранные фичи и все плагины */
  #bundles(): Bundle[] {
    return [...this.#selectedFeatures(), ...this.#plan.spec.plugins];
  }

  /**
   * Фаза 0: резолв выбора — до построения контейнера.
   *
   * Опечатка в имени фичи падает раньше любого `@OnInit`. Замыкание по
   * вызовам считается здесь же, один раз.
   */
  #select(): void {
    if (this.#features) {
      return;
    }

    const selection = resolveSelection(
      this.#plan.spec.features,
      this.#plan.select,
    );

    this.#named = selection.features.map((feature) => feature.name);
    this.#includeDeps = selection.includeDeps;
    this.#features = selection.includeDeps
      ? closeOverCalls(selection.features, selection.declared)
      : selection.features;
  }

  /**
   * Фаза 1: дерево модулей, discovery, граф, сверка транспортов и форм,
   * инварианты сборки — именно в этом порядке.
   *
   * Всё, что может не сойтись, сходится здесь: до `@OnInit` не доходит ни
   * одна неудовлетворённая потребность.
   *
   * Общий метод для `run()`, проверки и шва: собранный контейнер он
   * возвращает, но не запоминает — иначе проверка оставляла бы за собой
   * граф, который никто не будет ни инициализировать, ни разрушать.
   */
  async #assemble(): Promise<{
    container: BuiltContainer;
    discovery: EndpointDiscovery;
  }> {
    this.#select();

    const { spec } = this.#plan;
    const bundles = this.#bundles();

    const builder = new ContainerBuilder({
      overrides: this.#plan.overrides,
      familyOverrides: this.#plan.familyOverrides,
    });

    // Kernel-модуль конфига регистрируется всегда: иначе сценарий
    // «источник — только env, про конфиг в корне ничего не пишем» не
    // работал бы. Без привязок читалка тривиальна, а рецепты семейств не
    // создают ни одного узла, пока никто не инжектит секцию. Привязка
    // теста заменяет привязку декларации целиком.
    builder.register(configKernel([...(this.#plan.config ?? spec.config)]));

    // Kernel-модуль ambient-контекста — по той же причине и с той же ценой:
    // без единого `Ctx(...)` в `deps` он не создаёт ни одного узла, зато
    // в корне про request-контекст не пишется ни строки
    builder.register(contextKernel());

    // Discovery — плоским проходом по выбранным фичам и подключённым
    // плагинам: невыбранные фичи в нём не участвуют вовсе. Считается до
    // регистрации модулей, потому что топология реализаций операций нужна
    // kernel-модулю портов уже на регистрации: функция чистая, порядок ни
    // на что не влияет
    const discovery = discoverEndpoints(bundles);

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
        // Назначенный интерком — единственный вход ветки «шину поставил
        // корень»: так подключается брокер, и in-proc реализация тогда не
        // регистрируется вовсе. Признак даёт роль, а не присутствие
        // провайдера в списке транспортов
        rootSuppliesBus: spec.intercom !== undefined,
      }),
    );

    // Модули считаются от **фактического** состава: замыкание по вызовам
    // могло добавить фичу, и её провайдеры обязаны попасть в граф
    const modules = modulesOf(bundles);

    if (modules.length > 0) {
      builder.register(...modules);
    }

    // Класс-хендлер регистрирует сам endpoint — провайдером
    // модуля-объявителя
    this.#registerHandlerClasses(builder, discovery, bundles, modules);

    const providers = [...spec.providers, ...this.#plan.extraProviders];
    if (providers.length > 0) {
      builder.register(...providers);
    }

    const transports = spec.transports.map(({ provider }) => provider);
    if (transports.length > 0) {
      builder.register(...(transports as Provider[]));
    }

    const container = await builder.build();

    // Граница фич — первой на собранном графе: ребро, которое не переживёт
    // разъезда процессов, важнее любого недостающего транспорта
    await assertFeatureBoundary(
      container,
      buildOwnerMap(this.#selectedFeatures(), spec.plugins),
    );

    this.#warnOnIdleIntercom(discovery);
    this.#assertRequiredTransports(container, discovery);
    this.#assertFormsSupported(container, discovery);
    // Инварианты — последними: сперва «граф вообще собирается», потом
    // утверждения на нём. Политика, ругающаяся на endpoint
    // незарегистрированного транспорта, увела бы автора не туда.
    this.#assertPolicies(discovery);

    return { container, discovery };
  }

  /**
   * Регистрирует классы-хендлеры провайдерами модулей-объявителей.
   *
   * Класс — токен, поэтому один класс у двух endpoint'ов регистрируется
   * один раз и даёт один экземпляр. Тот же класс в `providers:` любого
   * модуля или корня — ошибка: у узла графа один источник.
   *
   * Атрибуция: для единицы с `providers:` — её синтетический модуль, для
   * единицы с `modules:` — первый модуль, для единицы без состава — сама
   * единица по имени.
   */
  #registerHandlerClasses(
    builder: ContainerBuilder,
    discovery: EndpointDiscovery,
    bundles: readonly Bundle[],
    modules: readonly Module[],
  ): void {
    const registered = new Set<HandlerClass>();
    const rootProviders = [
      ...this.#plan.spec.providers,
      ...this.#plan.extraProviders,
    ];

    for (const { endpoint, moduleName } of discovery.endpoints) {
      const cls = handlerClassOf(endpoint);

      if (!cls || registered.has(cls)) {
        continue;
      }

      const listedIn = modulesListing(cls, modules);
      if (rootProviders.some((provider) => providedClass(provider) === cls)) {
        listedIn.push('(root providers)');
      }

      if (listedIn.length > 0) {
        throw new Error(
          `Handler class '${cls.name}' of endpoint '${endpoint.pattern}' ` +
            `(declared in '${moduleName}') is also listed in 'providers:' of ` +
            `${listedIn.map((name) => `'${name}'`).join(', ')}. The endpoint ` +
            `registers its handler class itself — remove it from 'providers:'.`,
        );
      }

      const bundle = bundles.find(({ name }) => name === moduleName);
      const owner = bundle?.modules[0]?.name ?? moduleName;

      builder.registerIn(owner, cls);
      registered.add(cls);
    }
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

    // Связывание вызывателей операций с исполнителем — здесь и только
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
      ...transportTokensOf(this.#plan.spec),
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
   * Одинаково обслуживает все три источника: токен из `handler.deps`,
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
   * Предупреждает об интеркоме, которому нечего переносить.
   *
   * Роль назначена, брокер поднимется и займёт соединение, а операций в
   * сборке нет: либо роль назначена по ошибке, либо фича, ради которой
   * она нужна, не выбрана. Это предупреждение, а не ошибка: топология из
   * одного процесса, готовая к разъезду, законна.
   */
  #warnOnIdleIntercom(discovery: EndpointDiscovery): void {
    const intercom = this.#plan.spec.intercom;

    if (
      !intercom ||
      mapOperations(discovery, this.#bundles(), intercom.name).length > 0
    ) {
      return;
    }

    console.warn(
      `[nestling] intercom '${intercom.name}' is assigned, but this ` +
        `assembly declares no operations: nothing will be carried through ` +
        `it. Drop 'intercom:' with its transport, or check that the feature ` +
        `that needs it is part of the selection.`,
    );
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
          `declared in '${moduleName}', but the root does not declare it. ` +
          `Add it to 'transports:' of makeApp({ … }); a bus additionally ` +
          `needs the intercom role ('intercom: <instance name>').`,
      );
    }
  }

  /**
   * Сверяет формы io деклараций со способностями инстансов транспортов.
   *
   * Точка проверки для сборки — фаза ASSEMBLE: здесь известны и
   * декларации, и инстансы из графа. Реализация и текст ошибки те же, что
   * на standalone-пути (`serve`).
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
        `declared in '${moduleName}'`,
      );
    }
  }

  /**
   * Проверяет объявленные инварианты на обнаруженных endpoint'ах.
   *
   * Содержимое политики сборка не разбирает: её дело — собрать субъекты
   * из discovery (`{ endpoint, moduleName }` уже структурно совпадает с
   * `PolicySubject`), позвать `check` и отформатировать результат.
   *
   * Прогоняются **все** политики: чинить инварианты по одному
   * endpoint'у за прогон — не режим работы, поэтому нарушения
   * складываются и бросаются одним исключением.
   */
  #assertPolicies(discovery: EndpointDiscovery): void {
    const { policies } = this.#plan.spec;

    if (policies.length === 0) {
      return;
    }

    const subjects: readonly PolicySubject[] = discovery.endpoints;

    const groups: string[] = [];
    let total = 0;

    for (const policy of policies) {
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
    const features = this.#selectedFeatures().map((feature) => feature.name);
    const transports = this.#serving.map(({ token }) => transportNameOf(token));

    console.log(
      `[nestling] features: ${features.join(', ') || '(none)'}; ` +
        `transports: ${transports.join(', ') || '(none)'}`,
    );

    // Фактический состав при замыкании — не украшение: выбор назвал одни
    // фичи, а собрались другие, и разойтись эти списки не должны молча
    if (this.#includeDeps) {
      const named = this.#named;
      const added = features.filter((name) => !named.includes(name));

      console.log(
        `[nestling] selection closed over calls: ${named.join(', ') || '(none)'}` +
          (added.length > 0 ? ` + ${added.join(', ')}` : ' (nothing added)'),
      );
    }

    // Деградация долговечности — рядом с составом и по тем же основаниям,
    // что список detached-endpoint'ов: расхождение объявленного с
    // обслуживаемым обязано быть поверхностью для аудита, а не тихим
    // «как-нибудь доставится»
    const undurable = this.#container
      ? undurableOperations(
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
