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

import type {
  ConfigBinding,
  ConfigInput,
  ConfigReader,
} from '../config/index.js';
import { bootstrapConfig, configKernel, toBindings } from '../config/index.js';
import type { Logger } from '../logger/index.js';
import {
  Logger$,
  loggerKernel,
  makeKernelLogger,
  RootLogger$,
} from '../logger/index.js';
import type {
  AnyEndpointDefinition,
  HandlerClass,
  PolicySubject,
  SchemaDocConverter,
  TransportCapabilities,
  TransportRef,
} from '../pipeline/index.js';
import {
  assertFormsSupported,
  contextKernel,
  handlerClassOf,
  transportNameOf,
} from '../pipeline/index.js';
import type { OperationDescriptor } from '../ports/index.js';
import {
  bindPorts,
  BUS_CAPABILITIES,
  busBindingOf,
  BusTransport$,
  collectImplementations,
  describeOperation,
  portsKernel,
  undurableOperations,
} from '../ports/index.js';
import type {
  Dispatch,
  ExecutableDeclaration,
  ITransport,
  TransportDeclaration,
} from '../transport/index.js';
import { makeDispatch } from '../transport/index.js';

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

import type {
  BuiltContainer,
  InjectionToken,
  Module,
  ModuleProvider,
  Provider,
} from '@nestling/container';
import { ContainerBuilder, tokenId, valueProvider } from '@nestling/container';

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

  /**
   * Источники конфига проверки: голый источник, одна привязка или список
   * привязок.
   *
   * **Заменяет** привязки декларации целиком — те же три формы, что у
   * тестового корня. С `config: vars({ … })` проверка обходится без
   * источников и без ввода-вывода. Без поля поднимаются привязки
   * декларации.
   */
  readonly config?: ConfigInput;
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
 * объявляются экземплярами, привязки конфига — полем `config`, корневой
 * логгер — полем `logger`. Выбор фич в словаре не пишется: его принимает
 * `assemble(select)`.
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
   * discovery, построение графа, сверка требуемых транспортов, проверка
   * форм io против способностей объявленных транспортов и проверка
   * объявленных политик.
   *
   * Не выполняется ни один конструктор: экземпляры создаёт INIT, а
   * проверка до него не доходит. `acquire`, WIRE, `@OnStart`, `serve` и
   * `release` тоже не выполняются.
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
 * ловит контейнер общей ошибкой о занятом DI-токене.
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
   * Читалка конфига, поднятая на фазе 0.
   *
   * Живёт время `run()`, а не время контейнера: её `close()` — явный шаг
   * SHUTDOWN после `container.destroy()`.
   */
  #reader?: ConfigReader;

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

    // 0 BOOTSTRAP — резолв выбора, подъём источников конфига и корневой
    // логгер: единственный ввод-вывод до INIT
    const { reader, root } = await this.#bootstrap();
    this.#reader = reader;

    // 1 ASSEMBLE — граф, discovery и все fail-fast'ы до захвата ресурсов
    const { container, discovery } = this.#assemble(reader, root);
    this.#container = container;

    // Канал остановки создаётся до INIT: его получают и `acquire` ресурсов,
    // и хуки `@OnStart`, и `serve` транспортов — один и тот же сигнал
    this.#shutdown = new AbortController();
    const { signal } = this.#shutdown;

    // 2 INIT — экземпляры и захват ресурсов
    await container.init(signal);

    // С этой строки ядро пишет через узел графа: подмена корня в тестовом
    // прогоне действует с INIT, и записи фазы RUN обязаны её видеть
    const logger = container.getOrThrow(Logger$('nestling'));

    // 3 WIRE — резолв зависимостей деклараций и `dispatch` на транспорт
    const { dispatches } = this.#wire(container, discovery, logger);

    // 4 START — сначала хуки графа, затем старт приёма запросов
    // транспортами
    await container.start(signal);

    for (const [token, dispatch] of dispatches) {
      const transport = container.getOrThrow<ITransport>(
        token as InjectionToken<ITransport>,
      );

      await transport.serve(dispatch, signal);
      this.#serving.push({ token, transport });
    }

    this.#announce(discovery, logger);
    this.#attachSignals(logger);
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
    // Переданный `config` заменяет привязки декларации целиком: с
    // `config: vars({ … })` проверка обходится без источников
    const { reader, root } = await this.#bootstrap(
      options.config === undefined ? undefined : toBindings(options.config),
    );

    try {
      return this.#report(this.#assemble(reader, root).discovery, options);
    } finally {
      // Контейнер проверка не разрушает, поэтому источники закрываются
      // сразу после отчёта — иначе они остались бы открытыми
      await reader.close();
    }
  }

  /** Отчёт о составе по результату discovery */
  #report(discovery: EndpointDiscovery, options: CheckOptions): CheckReport {
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

    // 0 BOOTSTRAP — привязки прогона уже в плане: тест изолирован от
    // источников приложения так же, как от `process.env`
    const { reader, root } = await this.#bootstrap();
    this.#reader = reader;

    // 1 ASSEMBLE — те же fail-fast'ы, что и в бою
    const { container, discovery } = this.#assemble(reader, root);
    this.#container = container;

    this.#shutdown = new AbortController();
    const { signal } = this.#shutdown;

    // 2 INIT
    await container.init(signal);

    // 3 WIRE — и остановка: START, `#announce()` и `#attachSignals()` не
    // выполняются, поэтому тест не начинает принимать запросы и не
    // трогает процесс
    const { wired } = this.#wire(
      container,
      discovery,
      container.getOrThrow(Logger$('nestling')),
    );

    return {
      container,
      endpoints: wired,
      features: this.#selectedFeatures(),
      signal,
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

    // 3. И только теперь — `release` ресурсов в реверсе топологического
    // порядка
    await this.#container?.destroy();
    this.#container = undefined;

    // 4. Источники конфига — последними: читалка живёт время `run()`, а
    // не время контейнера, и хука в графе у неё нет
    await this.#reader?.close();
    this.#reader = undefined;

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
   * Опечатка в имени фичи падает раньше любого захвата. Замыкание по
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
   * Фаза 0: резолв выбора, подъём источников конфига и корневой логгер.
   *
   * Единственный ввод-вывод до INIT и единственное место, где он
   * происходит раньше графа. После неё значения ключей лежат в снимке, и
   * фазе 1 читать уже нечего.
   *
   * Корневой логгер создаётся здесь же и живёт вне графа: ядро пишет уже
   * на этой фазе, а первый узел появляется только на INIT. Читалка конфига
   * получает свой логгер сразу — накопленные ею предупреждения уходят в
   * тот же логгер, что и записи фазы RUN.
   *
   * @param config - Привязки, заменяющие привязки плана целиком; проверка
   * передаёт сюда свой `config:`
   */
  async #bootstrap(
    config?: readonly ConfigBinding[],
  ): Promise<{ reader: ConfigReader; root: Logger }> {
    this.#select();

    const { spec } = this.#plan;

    const reader = await bootstrapConfig([
      ...(config ?? this.#plan.config ?? spec.config),
    ]);

    const root = spec.logger ?? makeKernelLogger(reader);

    reader.attachLogger(root.child({ scope: 'nestling:config' }));

    return { reader, root };
  }

  /**
   * Фаза 1: дерево модулей, discovery, граф, сверка транспортов и форм,
   * инварианты сборки — именно в этом порядке.
   *
   * Синхронна и без ввода-вывода: всё, что читает внешний мир, осталось на
   * фазе 0. Всё, что может не сойтись, сходится здесь: до INIT не доходит
   * ни одна неудовлетворённая потребность, и ни один конструктор не
   * выполняется.
   *
   * Общий метод для `run()`, проверки и шва: собранный контейнер он
   * возвращает, но не запоминает — иначе проверка оставляла бы за собой
   * граф, который никто не будет ни инициализировать, ни разрушать.
   *
   * @param reader - Читалка со снимком фазы 0
   * @param root - Корневой логгер, созданный на фазе 0
   */
  #assemble(
    reader: ConfigReader,
    root: Logger,
  ): {
    container: BuiltContainer;
    discovery: EndpointDiscovery;
  } {
    const { spec } = this.#plan;
    const bundles = this.#bundles();

    const builder = new ContainerBuilder({
      overrides: this.#plan.overrides,
      familyOverrides: this.#plan.familyOverrides,
    });

    // Kernel-модуль конфига регистрируется всегда: иначе сценарий
    // «источник — только env, про конфиг в корне ничего не пишем» не
    // работал бы. Без привязок читалка тривиальна, а рецепты семейств не
    // создают ни одного узла, пока никто не инжектит секцию. Читалка
    // входит значением: источники подняты на фазе 0.
    builder.register(configKernel(reader));

    // Kernel-модуль ambient-контекста — по той же причине и с той же ценой:
    // без единого `Ctx(...)` в `deps` он не создаёт ни одного узла, зато
    // в корне про request-контекст не пишется ни строки
    builder.register(contextKernel());

    // Kernel-модуль логгера — тоже всегда: рецепт семейства областей и два
    // члена ядра. Самого корня в модуле нет — он создан на фазе 0 и
    // регистрируется провайдером значения ниже, последним
    builder.register(loggerKernel());

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

    // Корень логгера — последним: провайдер приложения под `RootLogger$`
    // обязан упасть ошибкой, называющей опцию корня, а не общей ошибкой
    // дубля
    this.#registerRootLogger(builder, root);

    const container = builder.build();

    // Записи фаз 0–1 идут в тот же корень, что и узлы графа с фазы INIT:
    // до INIT члена семейства ещё нет, поэтому сборка строит своего
    // ребёнка сама
    const logger = root.child({ scope: 'nestling' });

    for (const warning of container.warnings) {
      logger.warn(warning);
    }

    // Граница фич — первой на собранном графе: ребро, которое не переживёт
    // разъезда процессов, важнее любого недостающего транспорта
    assertFeatureBoundary(
      container,
      buildOwnerMap(this.#selectedFeatures(), spec.plugins),
    );

    this.#warnOnIdleIntercom(discovery, logger);
    this.#assertRequiredTransports(container, discovery);
    this.#assertFormsSupported(discovery);
    // Инварианты — последними: сперва «граф вообще собирается», потом
    // утверждения на нём. Политика, ругающаяся на endpoint
    // незарегистрированного транспорта, увела бы автора не туда.
    this.#assertPolicies(discovery);

    return { container, discovery };
  }

  /**
   * Регистрирует корневой логгер провайдером значения.
   *
   * Второго способа объявить корень нет: провайдер под `RootLogger$` в
   * `providers:` даёт ошибку дубля, потому что иначе оставался бы вопрос,
   * кто из двух пишет на фазе 0.
   */
  #registerRootLogger(builder: ContainerBuilder, root: Logger): void {
    try {
      builder.register(valueProvider(RootLogger$, root));
    } catch (error) {
      throw new Error(
        `A provider for 'RootLogger' is declared by the application, but the ` +
          `root logger is set by the 'logger' option of makeApp({ … }) — it ` +
          `exists before the graph, so records of phases 0 and 1 go to it too. ` +
          `Remove the provider and pass the logger as 'logger: <value>'.`,
        { cause: error },
      );
    }
  }

  /**
   * Регистрирует классы-хендлеры провайдерами модулей-объявителей.
   *
   * Класс — DI-токен, поэтому один класс у двух endpoint'ов регистрируется
   * один раз и даёт один экземпляр. Тот же класс в `providers:` любого
   * модуля или корня — ошибка: у узла графа один источник. Роль класса
   * сверяется с позицией: слот `handler:` принимает только `@Handler`.
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

      builder.registerHandlerIn(owner, cls);
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
    logger: Logger,
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

    // Логгер незадекларированных отказов живёт в `dispatch`, а не в опциях
    // вызова: у сборки он есть один раз, а транспорту ради одного вызова
    // зависимость от логгера не нужна
    const dispatches = new Map(
      [...executable].map(([token, endpoints]) => [
        token,
        makeDispatch(endpoints, { logger }),
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
   * Одинаково обслуживает оба источника: класс-хендлер и класс-юнит
   * пайплайна — для автора это одна и та же незарегистрированная
   * зависимость.
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
          `(classes — with @Component or @Resource).`,
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
  #warnOnIdleIntercom(discovery: EndpointDiscovery, logger: Logger): void {
    const intercom = this.#plan.spec.intercom;

    if (
      !intercom ||
      mapOperations(discovery, this.#bundles(), intercom.name).length > 0
    ) {
      return;
    }

    logger.warn(
      'intercom is assigned, but this assembly declares no operations',
      {
        transport: intercom.name,
        hint:
          `nothing will be carried through it. Drop 'intercom:' with its ` +
          `transport, or check that the feature that needs it is part of the ` +
          `selection`,
      },
    );
  }

  /**
   * Сверяет транспортные DI-токены деклараций с собранным графом.
   *
   * Отдельной «capability negotiation» нет: транспорт, которого нет в
   * графе, — та же незарегистрированная зависимость, что и любая другая.
   */
  #assertRequiredTransports(
    container: BuiltContainer,
    discovery: EndpointDiscovery,
  ): void {
    for (const [token, endpoints] of discovery.transports) {
      // Наличие — это регистрация, а не экземпляр: на фазе ASSEMBLE
      // экземпляров нет ни у кого
      if (container.has(token as InjectionToken<ITransport>)) {
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
   * Сверяет формы io деклараций со способностями объявленных транспортов.
   *
   * Способности читаются из `transports:`, а не из графа: на фазе ASSEMBLE
   * экземпляров нет. Реализация и текст ошибки те же, что на
   * standalone-пути (`serve`).
   *
   * Транспорт, зарегистрированный мимо `transports:` корня, объявления не
   * имеет, и его формы сверяет только собственный `serve`.
   */
  #assertFormsSupported(discovery: EndpointDiscovery): void {
    const capabilities = new Map<TransportRef, TransportCapabilities>([
      // Шину in-proc ставит kernel-модуль портов, а не `transports:` корня:
      // объявления у неё нет, а формы её endpoint'ов сверяются на той же
      // фазе, что и у прочих. Объявление корня перекрывает эту запись
      [BusTransport$ as TransportRef, BUS_CAPABILITIES],
      ...this.#plan.spec.transports.map(
        (declaration) => [declaration.token, declaration.capabilities] as const,
      ),
    ]);

    for (const { endpoint, moduleName } of discovery.endpoints) {
      const supported = capabilities.get(endpoint.transport);

      if (!supported) {
        continue;
      }

      assertFormsSupported(
        endpoint as AnyEndpointDefinition,
        supported,
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
   * diff'е одного файла. Пустой список не даёт ни одной записи.
   *
   * Всё уровнем `info`, кроме деградации долговечности: расхождение
   * объявленного с обслуживаемым — предупреждение.
   */
  #announce(discovery: EndpointDiscovery, logger: Logger): void {
    const features = this.#selectedFeatures().map((feature) => feature.name);
    const transports = this.#serving.map(({ token }) => transportNameOf(token));

    logger.info(
      `features: ${features.join(', ') || '(none)'}; ` +
        `transports: ${transports.join(', ') || '(none)'}`,
      { features, transports },
    );

    // Фактический состав при замыкании — не украшение: выбор назвал одни
    // фичи, а собрались другие, и разойтись эти списки не должны молча
    if (this.#includeDeps) {
      const named = this.#named;
      const added = features.filter((name) => !named.includes(name));

      logger.info('selection closed over calls', { named, added });
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
      logger.warn('durable delivery is not available on this bus', {
        operations: undurable,
        hint:
          'served without persistence. Register a bus transport that ' +
          'supports it (for example nats()) to make the guarantee real',
      });
    }

    for (const { endpoint } of discovery.endpoints) {
      if (endpoint.detached === undefined) {
        continue;
      }

      logger.info('detached from policies', {
        pattern: endpoint.pattern,
        transport: transportNameOf(endpoint.transport),
        reason: endpoint.detached,
      });
    }
  }

  /** Корректная остановка по сигналам процесса. Снимается в `close()` */
  #attachSignals(logger: Logger): void {
    const handlers: [NodeJS.Signals, () => void][] = (
      ['SIGTERM', 'SIGINT'] as NodeJS.Signals[]
    ).map((signal) => [
      signal,
      () => {
        logger.info('shutting down', { signal });
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
