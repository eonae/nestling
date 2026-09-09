/**
 * `makeApp` — единственный composition root; `AssembledApp` — фазовый
 * рантайм приложения.
 *
 * Декларация (`makeApp`) описывает, что такое приложение. Сборка
 * (`app.assemble(args)`) выбирает, что запускает этот процесс. Фазы:
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
import { registerHealth } from '../health/index.js';
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
  IListener,
  ITransport,
  ServerDeclaration,
  TransportDeclaration,
  TransportEntry,
} from '../transport/index.js';
import { makeDispatch } from '../transport/index.js';

import type { AssembleArgs } from './args.js';
import { undeclaredSwitch } from './args.js';
import { assertFeatureBoundary, buildOwnerMap } from './boundary.js';
import { resolveComposition } from './composition.js';
import type { EndpointDiscovery } from './discovery.js';
import { discoverEndpoints, Discovery$ } from './discovery.js';
import type { ResolvedBundle } from './feature.js';
import { modulesOf } from './feature.js';
import type { CheckedOperation } from './operations.js';
import { mapOperations } from './operations.js';
import type { AppPhase } from './phase.js';
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

import type {
  AnySwitch,
  Branchable,
  BuiltContainer,
  InjectionToken,
  Module,
  ModuleProvider,
  Provider,
  SwitchValues,
} from '@nestling/container';
import {
  branchCandidates,
  ContainerBuilder,
  resolveBranches,
  switchesUsed,
  tokenId,
  valueProvider,
} from '@nestling/container';

export type { AppSpec, NormalizedAppSpec } from './plan.js';
export type { AssembleArgs, AssembleObject, SwitchFields } from './args.js';

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

  /**
   * Значение каждого переключателя декларации в порядке объявления.
   *
   * Второе измерение состава рядом с первым: топология описывается
   * выбором фич и ветками вместе. У приложения без `switches:` поле
   * пусто.
   */
  readonly switches: Readonly<Record<string, string>>;

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
 * Единственный публичный composition root. Состав описывается одной из
 * трёх форм: `{ endpoints, providers? }`, `{ endpoints, modules? }` или
 * `{ features }`. Сквозная инфраструктура перечисляется в `plugins:`,
 * переключатели состава — в `switches:`, транспорты объявляются
 * экземплярами, привязки конфига — полем `config`, корневой логгер —
 * полем `logger`. Выбор фич в словаре не пишется: он часть аргумента
 * `assemble(args)`.
 *
 * Декларация проверяется при создании: бренды фич и плагинов, дубли имён
 * фич и имён переключателей, форма состава, закрытый перечень полей,
 * интерком среди транспортов.
 *
 * @param spec - Словарь декларации. Все поля опциональны
 * @returns Декларация приложения с методами `assemble()`, `discover()` и
 * `check()`
 * @throws {TypeError} Неизвестное поле словаря, смешанная форма состава,
 * не фича в `features`, не плагин в `plugins`
 * @throws {Error} Одноимённые разные фичи или переключатели, интерком вне
 * списка транспортов
 *
 * @example Endpoint'ы и транспорт без фичи
 * ```typescript
 * // app.ts
 * export const app = makeApp({
 *   endpoints: [CreateOrder],
 *   providers: [OrdersService],
 *   transports: [http()],
 * });
 *
 * // main.ts
 * await app.assemble().run();
 * ```
 *
 * @example Фичи, переключатели и аргумент сборки
 * ```typescript
 * export const app = makeApp({
 *   features: [OrdersFeature, BillingFeature],
 *   plugins: [appLogging],
 *   switches: [Storage],
 *   transports: [http(), nats({ name: 'events' })],
 *   intercom: 'events',
 * });
 *
 * await app.assemble({ features: 'orders', storage: 's3' }).run();
 * ```
 */
export function makeApp<
  const T extends readonly Branchable<TransportEntry>[] = [],
  const S extends readonly AnySwitch[] = [],
>(spec: AppSpec<T, S> = {}): App<S> {
  return new App<S>(normalizeSpec(spec));
}

/**
 * Проверяет, что значение — декларация приложения, созданная `makeApp`.
 */
export function isApp(value: unknown): value is App<any> {
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
 * разным аргументом. Публичная поверхность — три входа с одним и тем же
 * аргументом сборки, различающиеся глубиной: `discover(args?)` — фаза 0,
 * `check(args?, options?)` — фазы 0–1, `assemble(args?).run()` — фазы 0–5.
 *
 * @template S - Переключатели декларации; из них выведен тип аргумента
 */
export class App<S extends readonly AnySwitch[] = readonly AnySwitch[]> {
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
   * Фазы 0–5 выполняет `run()` собранного приложения; ошибки аргумента
   * (неизвестное имя фичи, пустой выбор, значение переключателя не из
   * словаря) — ошибки фазы ASSEMBLE, их бросает `run()`.
   *
   * @param args - Аргумент сборки: `'all'`, `'orders,billing'`,
   * `['orders', 'billing']` или `{ features, includeDeps, …значения
   * переключателей }`. Отсутствует — выбраны все фичи и умолчания
   * @returns Собранное приложение с методами `run()` и `close()`
   */
  assemble(args?: AssembleArgs<S>): AssembledApp {
    return new AssembledApp(makePlan(this.spec, args));
  }

  /**
   * Состав приложения при этом аргументе: фаза 0 BOOTSTRAP — и остановка.
   *
   * Выполняется: разбор аргумента сборки, расчёт значений переключателей,
   * раскрытие веток, разрешение выбора фич с замыканием по вызываемым
   * операциям при `includeDeps` и проход discovery по выбранным единицам.
   *
   * Вызов синхронный и без ввода-вывода: источники конфига не
   * поднимаются, граф не строится, экземпляры транспортов не создаются.
   * Отсюда назначение метода — вход генератора документа: `openapi.json`
   * описывает тот состав, которым процесс и поднимется.
   *
   * Метод отвечает на вопрос «что обслуживается», а не «соберётся ли».
   * Ошибки собранного графа он не бросает: неудовлетворённая
   * зависимость, нарушенная политика, форма io вне способностей
   * транспорта и отсутствие требуемого транспорта — исходы `check()`.
   *
   * @param args - Аргумент сборки в тех же формах, что у `assemble`
   * @returns Endpoint'ы с атрибуцией к единице и карта требуемых
   * транспортов — то же значение, что сборка кладёт под `Discovery$`
   * @throws {TypeError} Неизвестное поле аргумента сборки
   * @throws {Error} Неизвестное имя фичи, значение переключателя вне
   * словаря, ветка на необъявленном переключателе, элемент `endpoints:`
   * не является декларацией, две разные единицы под одним именем,
   * дубликат паттерна на экземпляре транспорта
   *
   * @example
   * ```typescript
   * const document = buildOpenApiDocument(app.discover(args).endpoints, {
   *   info: { title: 'Users API', version: '1.0.0' },
   *   converters: [zodConverter()],
   * });
   * ```
   */
  discover(args?: AssembleArgs<S>): EndpointDiscovery {
    return discoverEndpoints(resolveComposition(this.spec, args).bundles);
  }

  /**
   * Структурный смок: фазы 0 BOOTSTRAP и 1 ASSEMBLE — и остановка.
   *
   * Выполняется: разбор аргумента сборки, раскрытие веток
   * переключателей, регистрация модулей и провайдеров, discovery,
   * построение графа, сверка требуемых транспортов, проверка форм io
   * против способностей объявленных транспортов и проверка объявленных
   * политик.
   *
   * Не выполняется ни один конструктор: экземпляры создаёт INIT, а
   * проверка до него не доходит. `acquire`, WIRE, `@OnStart`, `serve` и
   * `release` тоже не выполняются.
   *
   * Проверка — «собрать и выбросить»: граф не сохраняется, на
   * последующий `assemble()` той же декларации вызов не влияет, и гонять
   * его можно по матрице топологий.
   *
   * @param args - Аргумент сборки в тех же формах, что у `assemble`
   * @param options - Конвертеры схем для дескрипторов операций и конфиг
   * проверки
   * @returns Отчёт о составе: фичи, значения переключателей, endpoint'ы с
   * транспортами, транспорты и дескрипторы опубликованных операций
   * @throws {Error} Те же ошибки, что бросил бы `run()` на этих фазах
   *
   * @example
   * ```typescript
   * for (const args of ['all', 'users', 'logging'] as const) {
   *   await app.check(args);
   * }
   * ```
   */
  async check(
    args?: AssembleArgs<S>,
    options: CheckOptions = {},
  ): Promise<CheckReport> {
    return await new AssembledApp(makePlan(this.spec, args))[CHECK_SEAM](
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
  values: SwitchValues,
): string[] {
  return modules
    .filter(
      ({ providers }) =>
        Array.isArray(providers) &&
        resolveBranches(providers, values).some(
          (provider) => providedClass(provider) === cls,
        ),
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
   * Фактический состав фич: выбор, замкнутый по вызываемым операциям, с
   * раскрытыми ветками.
   *
   * Считается на фазе ASSEMBLE один раз: `run()`, проверка и шов обязаны
   * видеть один и тот же состав. До неё поле пусто.
   */
  #features?: readonly ResolvedBundle[];

  /** Единица корня и плагины после раскрытия веток */
  #alwaysOn: readonly ResolvedBundle[] = [];

  /** Транспорты сборки после раскрытия веток */
  #transports: readonly TransportDeclaration[] = [];

  /**
   * Серверы сборки после раскрытия веток, в порядке объявления.
   *
   * Собраны из элементов `transports:` и из полей `server` объявлений
   * транспортов, без повторов.
   */
  #serverDecls: readonly ServerDeclaration[] = [];

  /** Значения переключателей этой сборки в порядке объявления */
  #switches: SwitchValues = {};

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

  /**
   * Серверы, открывшие сокет (фаза START), в порядке `listen`.
   *
   * Дренаж идёт этим списком в реверсе — и до `close()` транспортов.
   */
  #listening: IListener[] = [];

  /** Объявленные серверы по имени экземпляра; заполняется на INIT */
  #servers = new Map<string, IListener>();

  /** Канал остановки, переданный транспортам в `serve` */
  #shutdown?: AbortController;

  #started = false;
  #closed = false;

  /**
   * Текущая фаза приложения.
   *
   * Читается узлами ядра — сегодня узлом проб. Начальное значение INIT:
   * первый узел появляется именно на ней, а фаз 0 и 1 он не наблюдает.
   */
  #phase: AppPhase = 'INIT';

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

    // 2 INIT — экземпляры и захват ресурсов; серверы среди них, но сокет
    // ни один из них не открывает
    await container.init(signal);
    this.#collectServers(container);

    // С этой строки ядро пишет через узел графа: подмена корня в тестовом
    // прогоне действует с INIT, и записи фазы RUN обязаны её видеть
    const logger = container.getOrThrow(Logger$('nestling'));

    // 3 WIRE — резолв зависимостей деклараций и `dispatch` на транспорт
    this.#phase = 'WIRE';
    const { dispatches } = this.#wire(container, discovery, logger);

    // 4 START, шаг 1 — хуки графа
    this.#phase = 'START';
    await container.start(signal);

    // 4 START, шаг 2 — транспорты присоединяют обработчики; сокета ещё нет
    for (const [token, dispatch] of dispatches) {
      const transport = container.getOrThrow<ITransport>(
        token as InjectionToken<ITransport>,
      );

      await transport.serve(dispatch, signal);
      this.#serving.push({ token, transport });
    }

    // 4 START, шаг 3 — серверы открывают сокет, в порядке объявления.
    // Последним, а не первым: запрос не может прийти раньше, чем каждый
    // транспорт присоединил свой обработчик
    for (const server of this.#servers.values()) {
      await server.listen();
      this.#listening.push(server);
    }

    // 5 RUN — приложение обслуживает запросы: сокет открыт, обработчики
    // присоединены. Отсюда и только отсюда проба готовности отвечает `ready`
    this.#phase = 'RUN';

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
      switches: this.#switches,
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
        this.#switches,
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
    this.#collectServers(container);

    // 3 WIRE — и остановка: START, `#announce()` и `#attachSignals()` не
    // выполняются, поэтому тест не начинает принимать запросы и не
    // трогает процесс
    const { wired } = this.#wire(
      container,
      discovery,
      container.getOrThrow(Logger$('nestling')),
    );

    // Шов останавливается после WIRE, но `testApp.call` — это и есть приём
    // запроса. Поэтому в тестовом прогоне фаза RUN: без этого проба
    // готовности в app-тесте всегда отвечала бы `not_ready`
    this.#phase = 'RUN';

    return {
      container,
      endpoints: wired,
      features: this.#selectedFeatures(),
      signal,
      close: () => this.close(),
    };
  }

  /**
   * Объявленные серверы по имени экземпляра.
   *
   * Доступ к сокету изнутри теста и хелпера: `HTTP_PORT=0` отдаёт
   * фактический порт только через `address()` сервера. Пусто до фазы INIT:
   * экземпляров до неё нет.
   */
  get servers(): ReadonlyMap<string, IListener> {
    return this.#servers;
  }

  /**
   * Выполняет фазу SHUTDOWN строгим реверсом START.
   *
   * Порядок: взвод сигнала, `drain()` серверов в обратном порядке,
   * `close()` транспортов в обратном порядке, `container.destroy()`.
   * Идемпотентен.
   */
  async close(): Promise<void> {
    if (this.#closed || !this.#started) {
      this.#closed = true;
      return;
    }
    this.#closed = true;

    // Фаза меняется первой: проба готовности обязана ответить `not_ready`
    // раньше, чем закроется первый сокет, — иначе балансировщик успеет
    // прислать запрос в дренаж
    this.#phase = 'SHUTDOWN';

    // 1. Новые запросы не принимаем, in-flight отменяем кооперативно
    this.#shutdown?.abort();
    this.#shutdown = undefined;

    // 2. Дренаж соединений — в порядке, обратном порядку `listen`. Раньше
    // транспортов: сервер обязан перестать принимать соединения до того,
    // как обработчик, который их обслуживает, перестанет существовать
    for (const server of [...this.#listening].reverse()) {
      await server.drain();
    }
    this.#listening = [];

    // 3. Отмена запросов в обработке — в порядке, обратном порядку `serve`
    for (const { transport } of [...this.#serving].reverse()) {
      await transport.close?.();
    }
    this.#serving = [];

    // 4. И только теперь — `release` ресурсов в реверсе топологического
    // порядка; сервер среди них
    await this.#container?.destroy();
    this.#container = undefined;
    this.#servers = new Map();

    // 5. Источники конфига — последними: читалка живёт время `run()`, а
    // не время контейнера, и хука в графе у неё нет
    await this.#reader?.close();
    this.#reader = undefined;

    this.#detachSignals?.();
    this.#detachSignals = undefined;
  }

  /**
   * Достаёт объявленные серверы из графа — сразу после INIT.
   *
   * Порядок карты — порядок объявления: им же идёт `listen` на START, а
   * дренаж идёт его реверсом.
   */
  #collectServers(container: BuiltContainer): void {
    this.#servers = new Map(
      this.#serverDecls.map(({ name, token }) => [
        name,
        container.getOrThrow<IListener>(token as InjectionToken<IListener>),
      ]),
    );
  }

  /** Выбранные фичи; доступны после резолва выбора на фазе ASSEMBLE */
  #selectedFeatures(): readonly ResolvedBundle[] {
    return this.#features ?? [];
  }

  /** Единицы сборки: корень, фактически выбранные фичи и все плагины */
  #bundles(): ResolvedBundle[] {
    return [...this.#selectedFeatures(), ...this.#alwaysOn];
  }

  /**
   * Фаза 0: состав приложения по аргументу сборки — до построения
   * контейнера.
   *
   * Счёт делает `resolveComposition`: тот же код, что стоит за
   * `app.discover(args)`. Метод только присваивает поля, чтобы состав
   * сборки и состав генератора документа не могли разойтись.
   *
   * Опечатка в имени фичи или значение вне словаря переключателя падают
   * раньше любого захвата.
   */
  #select(): void {
    if (this.#features) {
      return;
    }

    const composition = resolveComposition(this.#plan.spec, this.#plan.args);

    this.#switches = composition.switches;
    this.#alwaysOn = composition.alwaysOn;
    this.#transports = composition.transports;
    this.#serverDecls = composition.servers;
    this.#named = composition.named;
    this.#includeDeps = composition.includeDeps;
    this.#features = composition.features;
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
      // Ветки в `providers:` и `dependsOn:` модулей раскрывает билдер —
      // там, где эти списки читаются
      switches: this.#switches,
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

    // Ветки внутри модулей раскроет билдер, но перечень переключателей
    // знает только корень: его сообщение называет `switches:`, а не опцию
    // билдера
    this.#assertSwitchesDeclared(modules);

    if (modules.length > 0) {
      builder.register(...modules);
    }

    // Класс-хендлер регистрирует сам endpoint — провайдером
    // модуля-объявителя
    this.#registerHandlerClasses(builder, discovery, bundles, modules);

    // Провайдеры корня едут модулем `app` вместе с остальным его составом;
    // здесь остаются только стабы тестового прогона
    if (this.#plan.extraProviders.length > 0) {
      builder.register(...this.#plan.extraProviders);
    }

    // Серверы регистрируются вместе с транспортами: объявление сервера
    // приходит и элементом `transports:`, и полем `server` объявления
    // транспорта, а `collectServers` уже свёл их без повторов
    const nodes = [
      ...this.#transports.map(({ provider }) => provider),
      ...this.#serverDecls.map(({ provider }) => provider),
    ];
    if (nodes.length > 0) {
      builder.register(...(nodes as Provider[]));
    }

    // Пробы — после всего, что может объявить вклад: узел проб называет
    // каждый вклад поимённо, а вклад приходит и провайдером члена из
    // модуля, и методом `health` любого ресурса, включая серверы
    registerHealth(builder, () => this.#phase);

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
      buildOwnerMap(
        [
          ...this.#selectedFeatures(),
          ...this.#alwaysOn.filter(({ role }) => role === 'feature'),
        ],
        this.#alwaysOn.filter(({ role }) => role === 'plugin'),
        this.#switches,
      ),
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
   * Отвергает ветку на переключателе, которого нет в `switches:` корня.
   *
   * Списки единиц раскрывает сборка и ловит это сама; `providers:` и
   * `dependsOn:` модулей раскрывает билдер, а он знает только карту
   * значений. Проход идёт по всем веткам, а не по выбранным: `pick` на
   * незаявленном переключателе — ошибка декларации, и от выбора она не
   * зависит.
   */
  #assertSwitchesDeclared(modules: readonly Module[]): void {
    const declared = new Set(
      this.#plan.spec.switches.map(({ name }) => name as string),
    );
    const seen = new Set<Module>();

    const visit = (module: Module): void => {
      if (seen.has(module)) {
        return;
      }
      seen.add(module);

      const used = [
        ...switchesUsed(
          Array.isArray(module.providers) ? module.providers : [],
        ),
        ...switchesUsed(module.dependsOn),
      ];

      for (const declaration of used) {
        if (!declared.has(declaration.name)) {
          throw undeclaredSwitch(declaration);
        }
      }

      for (const required of branchCandidates(module.dependsOn)) {
        visit(required);
      }
    };

    for (const module of modules) {
      visit(module);
    }
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
    bundles: readonly ResolvedBundle[],
    modules: readonly Module[],
  ): void {
    const registered = new Set<HandlerClass>();
    const stubs = this.#plan.extraProviders;

    for (const { endpoint, moduleName } of discovery.endpoints) {
      const cls = handlerClassOf(endpoint);

      if (!cls || registered.has(cls)) {
        continue;
      }

      const listedIn = modulesListing(cls, modules, this.#switches);
      if (stubs.some((provider) => providedClass(provider) === cls)) {
        listedIn.push('(test stubs)');
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
      ...transportTokensOf(this.#transports),
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
      mapOperations(discovery, this.#bundles(), this.#switches, intercom.name)
        .length > 0
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
      ...this.#transports.map(
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
    const switches = this.#switches;

    // Выбор веток печатается рядом с фичами: это второе измерение состава,
    // и читать его надо там же, где первое. Приложение без переключателей
    // даёт строку прежнего вида
    const chosen = Object.entries(switches)
      .map(([name, value]) => `${name}=${value}`)
      .join(' ');

    logger.info(
      `features: ${features.join(', ') || '(none)'}; ` +
        (chosen ? `${chosen}; ` : '') +
        `transports: ${transports.join(', ') || '(none)'}`,
      { features, switches, transports },
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
