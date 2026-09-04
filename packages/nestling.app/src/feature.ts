/**
 * Фича и плагин — две роли слоя приложения и резолвер выбора.
 *
 * Обе роли **содержат** модули, а не расширяют `Module`: `endpoints` живут
 * здесь, а контейнеру достаётся модуль как группировка провайдеров с
 * меткой.
 *
 * Различие ролей — не «бизнес против инфраструктуры» и не наличие
 * endpoint'ов, а то, переживает ли связь границу процесса. Фича может
 * оказаться по ту сторону границы, поэтому к ней обращаются операциями.
 * Плагин есть в каждом процессе по определению, поэтому к нему обращаются
 * токенами.
 */

import type {
  InjectionToken,
  Module,
  ModuleProvider,
} from '@nestling/container';
import { dependenciesOf } from '@nestling/container';
import type { AnyEndpointDefinition } from '@nestling/pipeline';
import { handlerClassOf } from '@nestling/pipeline';

/**
 * Состав фичи или плагина: не больше одной из двух форм.
 *
 * Плоская форма — для единицы, которой хватает одного слоя провайдеров;
 * составная — когда внутри уже есть модули. Обе сразу отвергает
 * компилятор: у состава один источник истины. Ни одной — законно: единица,
 * которая только объявляет endpoint'ы, своих провайдеров не имеет.
 */
export type BundleComposition =
  | {
      /** Провайдеры единицы; их узлы несут её имя меткой */
      readonly providers?: readonly ModuleProvider[];
      readonly modules?: undefined;
    }
  | {
      /** Модули единицы; их узлы несут метки своих модулей */
      readonly modules?: readonly Module[];
      readonly providers?: undefined;
    };

/** Общая часть объявления фичи и плагина */
export interface BundleOptionsBase {
  /** Имя единицы; у фичи им же она называется в `select` */
  readonly name: string;

  /**
   * Декларации-значения, созданные конструктором своего транспорта
   * (`httpEndpoint`, `cliEndpoint`, `implement`).
   *
   * Инстанцировать в них нечего, поэтому в `providers` они не попадают.
   * Класс-хендлер регистрирует сам endpoint; зависимости хендлера — это
   * обычные провайдеры единицы.
   */
  readonly endpoints?: readonly AnyEndpointDefinition[];
}

/** Словарь объявления фичи */
export type FeatureOptions = BundleOptionsBase & BundleComposition;

/** Словарь объявления плагина */
export type PluginOptions = BundleOptionsBase &
  BundleComposition & {
    /**
     * Плагины, без которых этот не работает.
     *
     * Только плагины: параметризованную зависимость выражают токеном, а не
     * этим полем — параметры знает потребитель, и вызов чужой фабрики
     * создал бы второе значение под тем же именем.
     */
    readonly dependsOn?: readonly Plugin[];
  };

/**
 * Фича приложения: имя, её модули и её endpoint'ы.
 *
 * Поля `dependsOn` у фичи нет. Зависимость одной фичи от другой выводится
 * из объявленных операций: вызывающая сторона названа в зависимостях
 * хендлера, реализация — в составе другой фичи. Дублировать это полем
 * значило бы завести второй источник истины, который не с чем сверить.
 */
export interface Feature {
  /** Роль единицы; читается отчётами и проверкой границ */
  readonly role: 'feature';

  /** Имя фичи; им же она называется в `select` */
  readonly name: string;

  /** Модули фичи: они попадут в контейнер, если фича выбрана */
  readonly modules: readonly Module[];

  /** Endpoint'ы фичи в порядке объявления */
  readonly endpoints: readonly AnyEndpointDefinition[];
}

/**
 * Плагин: сквозная инфраструктура, которая есть в каждом процессе.
 *
 * В словарь `select` не входит и не выбирается: единица, доступная всем
 * токенами, обязана быть везде.
 */
export interface Plugin {
  /** Роль единицы; читается отчётами и проверкой границ */
  readonly role: 'plugin';

  /** Имя плагина; совпадает с именем npm-пакета, который его поставляет */
  readonly name: string;

  /** Модули плагина */
  readonly modules: readonly Module[];

  /** Endpoint'ы плагина в порядке объявления */
  readonly endpoints: readonly AnyEndpointDefinition[];

  /** Плагины, без которых этот не работает */
  readonly dependsOn: readonly Plugin[];
}

/** Фича или плагин — там, где роль не важна */
export type Bundle = Feature | Plugin;

/**
 * Форма `select`.
 *
 * Строковая форма — граница процесса (аргумент бинарника, переменная
 * окружения), она строковая по природе; опечатка ловится fail-fast'ом с
 * перечнем доступных имён. Объектная форма добавляет `includeDeps`.
 */
export type FeatureSelection =
  | string
  | readonly string[]
  | {
      /** Имена выбранных фич либо `'all'` */
      readonly features: string | readonly string[];

      /**
       * Замкнуть выбор по вызываемым операциям видов `request` и
       * `command`.
       *
       * События в замыкании не участвуют: у события ноль или больше
       * подписчиков, и отсутствие подписчика в этом процессе допустимо.
       */
      readonly includeDeps?: boolean;
    };

/** Проверяет имя и форму состава — одинаково для обеих ролей */
function normalize(
  constructorName: 'makeFeature' | 'makePlugin',
  options: BundleOptionsBase & {
    readonly providers?: readonly ModuleProvider[];
    readonly modules?: readonly Module[];
  },
): { name: string; modules: Module[]; endpoints: AnyEndpointDefinition[] } {
  const { name, providers, modules, endpoints = [] } = options;

  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error(
      `${constructorName}({ … }): 'name' must be a non-empty string.`,
    );
  }

  if (providers && modules) {
    throw new Error(
      `${constructorName}({ name: '${name}' }): declare either 'providers' or ` +
        `'modules', not both — the composition has a single source of truth.`,
    );
  }

  if (!Array.isArray(endpoints)) {
    throw new TypeError(
      `${constructorName}({ name: '${name}' }): 'endpoints' must be an array of ` +
        `endpoint declarations.`,
    );
  }

  // Плоская форма нормализуется в один модуль с именем единицы: дальше
  // состав однороден, и карта «модуль → владелец» строится одинаково
  const own: Module[] = providers
    ? [{ name, providers: [...providers] }]
    : [...(modules ?? [])];

  return { name, modules: own, endpoints: [...endpoints] };
}

/**
 * Объявляет фичу.
 *
 * @param options - Имя, состав и endpoint'ы
 * @returns Значение-фичу; ничего не регистрируется, пока её не выбрали
 *
 * @example
 * ```typescript
 * export const UsersFeature = makeFeature({
 *   name: 'users',
 *   providers: [UserService],
 *   endpoints: [CreateUser, GetUser],
 * });
 * ```
 *
 * @throws {Error} Пустое имя или не ровно одна форма состава
 */
export function makeFeature(options: FeatureOptions): Feature {
  const { name, modules, endpoints } = normalize('makeFeature', options);

  return Object.freeze({
    role: 'feature' as const,
    name,
    modules: Object.freeze(modules),
    endpoints: Object.freeze(endpoints),
  });
}

/**
 * Объявляет плагин.
 *
 * Имя плагина обязано совпадать с именем npm-пакета, который его
 * поставляет: иначе два чужих пакета роняют сборку коллизией имён, и
 * починить её нечем — оба имени заданы их авторами.
 *
 * @param options - Имя, состав, endpoint'ы и плагины-зависимости
 * @returns Значение-плагин
 *
 * @example
 * ```typescript
 * export const appLogging = (options: LoggingOptions) =>
 *   makePlugin({
 *     name: '@acme/logging',
 *     providers: [familyProvider(ILogger, recipe(options))],
 *   });
 * ```
 *
 * @throws {Error} Пустое имя, не ровно одна форма состава или не-плагин в
 * `dependsOn`
 */
export function makePlugin(options: PluginOptions): Plugin {
  const { name, modules, endpoints } = normalize('makePlugin', options);
  const dependsOn = options.dependsOn ?? [];

  if (!Array.isArray(dependsOn)) {
    throw new TypeError(
      `makePlugin({ name: '${name}' }): 'dependsOn' must be an array of ` +
        `plugins — values returned by makePlugin(), not their names.`,
    );
  }

  for (const dependency of dependsOn) {
    if (dependency?.role !== 'plugin') {
      throw new TypeError(
        `makePlugin({ name: '${name}' }): 'dependsOn' accepts plugins only. ` +
          `A feature cannot be a dependency of infrastructure, and a ` +
          `parameterized plugin is required by its token, not by this field.`,
      );
    }
  }

  return Object.freeze({
    role: 'plugin' as const,
    name,
    modules: Object.freeze(modules),
    endpoints: Object.freeze(endpoints),
    dependsOn: Object.freeze([...dependsOn]),
  });
}

/** Индекс «имя → фича» с fail-fast на одноимённых разных фичах */
function indexByName(features: readonly Feature[]): Map<string, Feature> {
  const index = new Map<string, Feature>();

  for (const feature of features) {
    const existing = index.get(feature.name);

    if (existing && existing !== feature) {
      throw new Error(
        `Two different features are named '${feature.name}'. ` +
          `Feature names are the selection vocabulary, so they must be unique.`,
      );
    }

    index.set(feature.name, feature);
  }

  return index;
}

/** Разбирает имена выбора; форму-строку режет по запятой */
function readNames(select: string | readonly string[]): string[] {
  const names = Array.isArray(select)
    ? [...(select as readonly string[])]
    : String(select).split(',');

  return names.map((name) => name.trim()).filter((name) => name.length > 0);
}

/** Нормализованный выбор: имена и флаг замыкания */
export interface NormalizedSelection {
  /** Выбранные фичи в порядке выбора */
  readonly features: readonly Feature[];

  /** Замкнуть выбор по вызываемым операциям */
  readonly includeDeps: boolean;

  /** Все объявленные фичи — словарь выбора для замыкания и отчётов */
  readonly declared: ReadonlyMap<string, Feature>;
}

/**
 * Резолвит выбор фич: имена → значения.
 *
 * Все проверки — fail-fast на фазе ASSEMBLE, до построения контейнера.
 * Транзитивного замыкания по объявленному полю здесь нет: у фичи такого
 * поля нет. Замыкание по вызовам делает `closeOverCalls` — оно требует
 * discovery и потому живёт в `App`.
 *
 * @param features - Фичи, перечисленные в корне
 * @param select - Форма выбора; отсутствует — выбраны все
 * @returns Выбранные фичи, флаг замыкания и словарь объявленных
 *
 * @throws {Error} Неизвестное имя, одноимённые фичи, пустой выбор или
 * `select` без `features`
 */
export function resolveSelection(
  features: readonly Feature[] | undefined,
  select?: FeatureSelection,
): NormalizedSelection {
  const empty = { features: [], includeDeps: false, declared: new Map() };

  if (!features || features.length === 0) {
    if (select !== undefined) {
      throw new Error(
        `A selection is given, but no features are declared. ` +
          `Declare them in 'features:' of makeApp({ … }) or assemble without ` +
          `a selection.`,
      );
    }

    return empty;
  }

  const declared = indexByName(features);

  const requested =
    select !== undefined && typeof select === 'object' && !Array.isArray(select)
      ? (select as { features: string | readonly string[] }).features
      : (select as string | readonly string[] | undefined);

  const includeDeps =
    select !== undefined && typeof select === 'object' && !Array.isArray(select)
      ? ((select as { includeDeps?: boolean }).includeDeps ?? false)
      : false;

  if (requested === undefined || requested === 'all') {
    return { features: [...features], includeDeps, declared };
  }

  const names = readNames(requested);

  if (names.length === 0) {
    throw new Error(
      `The selection is empty. "Nothing" is written by declaring no ` +
        `features at all, not by an empty selection.`,
    );
  }

  const chosen: Feature[] = [];
  for (const name of names) {
    const feature = declared.get(name);

    if (!feature) {
      throw new Error(
        `Unknown feature '${name}' in the selection. ` +
          `Available features: ${[...declared.keys()].join(', ')}.`,
      );
    }

    chosen.push(feature);
  }

  return { features: chosen, includeDeps, declared };
}

/**
 * Модули перечисленных единиц в порядке объявления.
 *
 * Дедупликация — **по ссылке**: то же значение, встреченное дважды,
 * регистрируется один раз, а два разных значения под одним именем —
 * ошибка. Молчаливый пропуск одноимённого модуля потерял бы его
 * провайдеры, и «обнаружено» разошлось бы с «собрано».
 */
export function modulesOf(bundles: readonly Bundle[]): Module[] {
  const byName = new Map<string, Module>();
  const modules: Module[] = [];

  for (const bundle of bundles) {
    for (const module of bundle.modules) {
      const seen = byName.get(module.name);

      if (seen) {
        if (seen !== module) {
          throw new Error(
            `Two different modules are named '${module.name}'. ` +
              `A module name is the attribution key of its providers, so it ` +
              `must be unique. Either share one module value between its ` +
              `consumers (create it once and import that value), or give the ` +
              `two configurations different names.`,
          );
        }

        continue;
      }

      byName.set(module.name, module);
      modules.push(module);
    }
  }

  return modules;
}

/**
 * Модули, достижимые из единицы: её собственные плюс их `dependsOn`.
 *
 * Дедупликация по ссылке: тот же модуль, привезённый двумя путями, в
 * списке один раз.
 */
export function reachableModules(bundle: Bundle): Module[] {
  const seen = new Set<Module>();
  const found: Module[] = [];

  const visit = (module: Module): void => {
    if (seen.has(module)) {
      return;
    }
    seen.add(module);
    found.push(module);

    for (const required of module.dependsOn ?? []) {
      visit(required);
    }
  };

  for (const module of bundle.modules) {
    visit(module);
  }

  return found;
}

/**
 * Токены, которые единица запрашивает у контейнера: зависимости её
 * классов-хендлеров и её провайдеров.
 *
 * Вызыватель операции — обычный токен, поэтому инжектировать его может и
 * декларация, и любой провайдер фичи. Читать одни декларации значило бы
 * видеть половину вызовов.
 *
 * Модуль, чьи `providers` заданы фабрикой, в разбор не попадает: фабрика
 * вызывается в `build()`, а состав считается до него. Вызов из такого
 * модуля остаётся виден проверке достижимости на собранном графе.
 */
export function injectedTokens(bundle: Bundle): InjectionToken[] {
  const tokens: InjectionToken[] = [];

  for (const endpoint of bundle.endpoints) {
    const handlerClass = handlerClassOf(endpoint);
    if (handlerClass) {
      tokens.push(...dependenciesOf(handlerClass));
    }
  }

  for (const module of reachableModules(bundle)) {
    const { providers } = module;

    if (!Array.isArray(providers)) {
      continue;
    }

    for (const provider of providers) {
      tokens.push(...dependenciesOf(provider));
    }
  }

  return tokens;
}

/** Плагины, достижимые из перечисленных по `dependsOn`, в порядке обхода */
export function reachablePlugins(plugins: readonly Plugin[]): Plugin[] {
  const seen = new Set<Plugin>();
  const known: Plugin[] = [];

  const visit = (plugin: Plugin): void => {
    if (seen.has(plugin)) {
      return;
    }
    seen.add(plugin);

    for (const dependency of plugin.dependsOn) {
      visit(dependency);
    }

    known.push(plugin);
  };

  for (const plugin of plugins) {
    visit(plugin);
  }

  return known;
}
