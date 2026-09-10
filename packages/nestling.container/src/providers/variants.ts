import type {
  ClassToken,
  Constructor,
  InjectionToken,
  Token,
} from '../common.js';

import { readRoleMeta } from './role.metadata.js';
import type { TokenFamily } from './token-family.js';
import { isTokenFamily } from './token-family.js';

/**
 * Общая часть всех определений провайдеров: DI-токен регистрации.
 *
 * @template T - Тип значения, которое даёт провайдер
 */
interface BaseDefinition<T> {
  /** DI-токен, под которым провайдер доступен в контейнере */
  provide: InjectionToken<T>;
}

/**
 * Провайдер, создающий экземпляр класса.
 *
 * Контейнер создаёт экземпляр сам, передавая в конструктор зависимости
 * из `deps` в том же порядке.
 *
 * @template T - Тип создаваемого экземпляра
 *
 * @example
 * ```typescript
 * const provider: ClassProviderDefinition<MyService> = {
 *   provide: MyService,
 *   useClass: MyServiceImpl,
 *   deps: [DatabaseService]
 * };
 * ```
 */
export interface ClassProviderDefinition<T = unknown>
  extends BaseDefinition<T> {
  /** Класс, экземпляр которого создаётся */
  useClass: Constructor<T>;
  /** Зависимости, передаваемые в конструктор */
  deps?: readonly InjectionToken[];
}

/**
 * Провайдер готового значения.
 *
 * Регистрирует уже созданный объект, примитив или константу. Значение
 * отдаётся как есть.
 *
 * @template T - Тип значения
 *
 * @example
 * ```typescript
 * const config = { apiUrl: 'https://api.example.com' };
 * const provider: ValueProviderDefinition<typeof config> = {
 *   provide: 'CONFIG',
 *   useValue: config
 * };
 * ```
 */
export interface ValueProviderDefinition<T = unknown>
  extends BaseDefinition<T> {
  /** Значение, которое отдаёт провайдер */
  useValue: T;
}

/**
 * Значение фабрики без `Promise`.
 *
 * Условный тип, а не просто `T`: он стоит в невыводимой позиции, поэтому
 * тип значения задаёт DI-токен, а фабрика, объявленная `async`, не проходит
 * по типу. Литерал провайдера внутри модуля этим типом не закрывается —
 * `Module.providers` типизирован значением `unknown`, — и его ловит
 * рантайм-проверка `build()`.
 *
 * @template T - Тип значения
 */
export type SyncValue<T> = T extends PromiseLike<unknown> ? never : T;

/**
 * Провайдер, создающий значение фабричной функцией.
 *
 * Подходит для сложной логики создания и классов сторонних библиотек без
 * декоратора роли. Фабрика синхронна: захват соединения — дело ресурса, а
 * не сборки.
 *
 * @template T - Тип создаваемого значения
 *
 * @example
 * ```typescript
 * const provider: FactoryProviderDefinition<ApiClient> = {
 *   provide: IApiClient,
 *   useFactory: (config: Config) => new ApiClient(config.apiUrl),
 *   deps: [IConfig]
 * };
 * ```
 */
export interface FactoryProviderDefinition<T> extends BaseDefinition<T> {
  /** Фабрика, создающая значение; `Promise` в возвращаемом типе запрещён */
  useFactory: (...args: any[]) => SyncValue<T>;
  /** Зависимости, передаваемые фабрике аргументами */
  deps: readonly InjectionToken[];
}

/**
 * Исход проверки состояния ресурса.
 *
 * Объединение объявлено здесь, а не берётся из `@nestlingjs/app`: контейнер
 * от ядра не зависит. Смысл значений задаёт ядро — оно же и собирает
 * исходы в отчёт пробы.
 */
export type HealthStatus = 'ok' | 'degraded' | 'down';

/**
 * Класс-ресурс: значение создаёт `static acquire`, а не конструктор.
 *
 * Конструктор ресурса контейнеру недоступен и может быть приватным,
 * поэтому тип называет только статическую фабрику и имя класса.
 *
 * @template T - Тип захваченного значения
 */
export interface ResourceClass<T = any> {
  /** Захватывает значение: зависимости по порядку, сигнал последним */
  acquire(...args: any[]): Promise<T>;
  /** Имя класса */
  readonly name: string;
}

/**
 * Провайдер ресурса: значение захватывается на INIT и освобождается на
 * SHUTDOWN.
 *
 * `acquire` получает зависимости из `deps` в порядке объявления, а
 * последним аргументом — сигнал остановки старта. `release` получает
 * захваченное значение.
 *
 * @template T - Тип захваченного значения
 *
 * @example
 * ```typescript
 * const provider: ResourceProviderDefinition<Pool> = {
 *   provide: Pool$,
 *   deps: [DbConfig],
 *   acquire: (cfg, signal) => createPool(cfg.url, { signal }),
 *   release: (pool) => pool.end(),
 * };
 * ```
 */
export interface ResourceProviderDefinition<T = unknown>
  extends BaseDefinition<T> {
  /** Зависимости, передаваемые в `acquire` перед сигналом */
  deps?: readonly InjectionToken[];
  /** Захват: последним аргументом приходит сигнал остановки старта */
  acquire: (...args: any[]) => T | Promise<T>;
  /**
   * Освобождение захваченного значения.
   *
   * Параметр типизирован `any`, как аргументы фабрики: точный тип задаёт
   * `resourceProvider`, а хранимое определение обязано оставаться
   * присваиваемым `ProviderDefinition<unknown>`.
   */
  release: (value: any) => void | Promise<void>;
  /**
   * Проверка состояния захваченного значения.
   *
   * Объявивший её ресурс становится вкладом в пробы: узел проверки заводит
   * сборка приложения, а контейнер только перечисляет такие провайдеры
   * (`ContainerBuilder.healthResources()`). Параметр значения типизирован
   * `any` по той же причине, что у `release`.
   */
  health?: (value: any, signal: AbortSignal) => Promise<HealthStatus>;
}

/**
 * Определение провайдера любого вида: класс, значение, фабрика или ресурс.
 *
 * @template T - Тип значения
 */
export type ProviderDefinition<T = unknown> =
  | ClassProviderDefinition<T>
  | ValueProviderDefinition<T>
  | FactoryProviderDefinition<T>
  | ResourceProviderDefinition<T>;

/**
 * Превращает массив DI-токенов (объектных или классов) в массив их типов.
 *
 * @template T - Массив DI-токенов
 */
export type UnwrapTokens<T extends readonly InjectionToken[]> = {
  [K in keyof T]: T[K] extends ClassToken<infer V>
    ? V
    : T[K] extends Token<infer U>
      ? U
      : never;
};

/**
 * Фабричный провайдер с типизированными зависимостями: типы аргументов
 * фабрики выводятся из списка `deps`.
 *
 * @template T - Тип создаваемого значения
 * @template TDeps - Массив DI-токенов зависимостей
 */
export type FactoryProviderWithDeps<
  T,
  TDeps extends readonly InjectionToken[],
> = FactoryProviderDefinition<T> & {
  useFactory: (...args: UnwrapTokens<TDeps>) => SyncValue<T>;
  deps: TDeps;
};

/**
 * Поле `health` определения ресурса, если класс объявил одноимённый метод.
 *
 * Метод переносится в поле тем же приёмом, что и `release`: определение
 * провайдера — значение, и знание «у этого ресурса есть проверка» должно
 * читаться из него, а не из прототипа. Класса без метода поле не касается,
 * поэтому результат — либо пустой словарь, либо словарь с одним полем.
 *
 * @param cls - Класс-ресурс
 * @returns `{ health }` или пустой словарь
 */
function healthOf<T>(
  cls: Constructor<T> | ResourceClass<T>,
): Pick<ResourceProviderDefinition<T>, 'health'> {
  const method = (cls as { prototype?: { health?: unknown } }).prototype
    ?.health;

  return typeof method === 'function'
    ? {
        health: (value: T, signal: AbortSignal) =>
          (
            value as {
              health(signal: AbortSignal): Promise<HealthStatus>;
            }
          ).health(signal),
      }
    : {};
}

/**
 * Создаёт провайдер класса: привязывает DI-токен интерфейса к реализации.
 *
 * Единственный способ зарегистрировать класс под чужим DI-токеном:
 * декораторы роли DI-токена не принимают. Класс должен быть компонентом или
 * ресурсом; зависимости берутся из метаданных декоратора. Класс-ресурс
 * даёт провайдер ресурса — захват на INIT и `release` на SHUTDOWN.
 *
 * @template T - Тип создаваемого значения
 * @param provide - DI-токен, под которым регистрируется провайдер
 * @param useClass - Класс с декоратором `@Component` или `@Resource`
 * @returns Определение провайдера класса или ресурса
 * @throws {Error} Если у класса нет декоратора роли или его роль — хендлер
 *
 * @example
 * ```typescript
 * @Component([])
 * class ConsoleLogger implements Logger {}
 *
 * const provider = classProvider(Logger$, ConsoleLogger);
 * ```
 */
export function classProvider<T>(
  provide: InjectionToken<T>,
  useClass: Constructor<T> | ResourceClass<T>,
): ClassProviderDefinition<T> | ResourceProviderDefinition<T> {
  const metadata = readRoleMeta(useClass);

  if (!metadata) {
    throw new Error(
      `Class '${useClass.name}' has no role decorator, so classProvider cannot register it. ` +
        `Declare it @Component([...]) or @Resource([...]); a class from another package ` +
        `is registered with factoryProvider or resourceProvider instead.`,
    );
  }

  if (metadata.role === 'handler') {
    throw new Error(
      `Class '${useClass.name}' is declared @Handler, so classProvider cannot register it. ` +
        `A handler class belongs in the 'handler:' slot of a declaration and is registered by ` +
        `the endpoint itself.`,
    );
  }

  if (metadata.role === 'resource') {
    const cls = useClass as ResourceClass<T>;

    return {
      provide,
      deps: metadata.dependencies,
      acquire: (...args: unknown[]) => cls.acquire(...args),
      release: (value: T) =>
        (value as { release(): void | Promise<void> }).release(),
      ...healthOf(useClass),
    };
  }

  return {
    provide,
    useClass: useClass as Constructor<T>,
    deps: metadata.dependencies,
  };
}

/**
 * Создаёт провайдер готового значения.
 *
 * @template T - Тип значения
 * @param provide - DI-токен, под которым регистрируется провайдер
 * @param useValue - Значение
 * @returns Определение провайдера значения
 *
 * @example
 * ```typescript
 * const config = { apiUrl: 'https://api.example.com' };
 * const provider = valueProvider(IConfig, config);
 * ```
 */
export function valueProvider<T>(
  provide: InjectionToken<T>,
  useValue: T,
): ValueProviderDefinition<T> {
  return {
    provide,
    useValue,
  };
}

/**
 * Создаёт фабричный провайдер.
 *
 * Фабрика получает зависимости аргументами в порядке `deps` и возвращает
 * значение. Фабрика синхронна: `Promise` в возвращаемом значении не
 * компилируется, потому что фаза сборки не выполняет ввода-вывода.
 *
 * @template T - Тип создаваемого значения
 * @template TDeps - Массив DI-токенов зависимостей
 * @param provide - DI-токен, под которым регистрируется провайдер
 * @param useFactory - Фабрика, создающая значение
 * @param deps - DI-токены зависимостей, передаваемых фабрике
 * @returns Определение фабричного провайдера с типизированными
 * зависимостями
 *
 * @example
 * ```typescript
 * const provider = factoryProvider(
 *   IApiClient,
 *   (config: Config) => new ApiClient(config.apiUrl),
 *   [IConfig]
 * );
 * ```
 */
export function factoryProvider<T, TDeps extends readonly InjectionToken[]>(
  provide: InjectionToken<T>,
  useFactory: (...args: UnwrapTokens<TDeps>) => SyncValue<T>,
  deps: TDeps,
): FactoryProviderWithDeps<T, TDeps> {
  return {
    provide,
    useFactory,
    deps,
  };
}

/**
 * Провайдер ресурса с типизированными зависимостями: типы аргументов
 * `acquire` выводятся из списка `deps`, а сигнал идёт последним.
 *
 * @template T - Тип захваченного значения
 * @template TDeps - Массив DI-токенов зависимостей
 */
export type ResourceProviderWithDeps<
  T,
  TDeps extends readonly InjectionToken[],
> = ResourceProviderDefinition<T> & {
  acquire: (...args: [...UnwrapTokens<TDeps>, AbortSignal]) => T | Promise<T>;
  deps: TDeps;
  health?: (value: T, signal: AbortSignal) => Promise<HealthStatus>;
};

/**
 * Создаёт провайдер ресурса.
 *
 * Функциональная форма ресурса: для классов чужих пакетов и для значений
 * без класса — там же, где нужен `factoryProvider`. Контейнер зовёт
 * `acquire` на фазе INIT в топологическом порядке и `release` на SHUTDOWN
 * в обратном.
 *
 * @template T - Тип захваченного значения
 * @template TDeps - Массив DI-токенов зависимостей
 * @param provide - DI-токен, под которым регистрируется провайдер
 * @param definition - Зависимости, захват и освобождение
 * @returns Определение провайдера ресурса
 *
 * @example
 * ```typescript
 * const provider = resourceProvider(Pool$, {
 *   deps: [DbConfig],
 *   acquire: (cfg, signal) => createPool(cfg.url, { signal }),
 *   release: (pool) => pool.end(),
 * });
 * ```
 */
export function resourceProvider<T, TDeps extends readonly InjectionToken[]>(
  provide: InjectionToken<T>,
  definition: {
    /** DI-токены, передаваемые в `acquire` перед сигналом */
    readonly deps: TDeps;
    /** Захват: последним аргументом приходит сигнал остановки старта */
    readonly acquire: (
      ...args: [...UnwrapTokens<TDeps>, AbortSignal]
    ) => T | Promise<T>;
    /** Освобождение захваченного значения */
    readonly release: (value: T) => void | Promise<void>;
    /**
     * Проверка состояния захваченного значения. Объявившего её ресурса
     * сборка приложения делает вкладом в пробы.
     */
    readonly health?: (value: T, signal: AbortSignal) => Promise<HealthStatus>;
  },
): ResourceProviderWithDeps<T, TDeps> {
  return {
    provide,
    deps: definition.deps,
    acquire: definition.acquire,
    release: definition.release,
    ...(definition.health === undefined ? {} : { health: definition.health }),
  };
}

/**
 * То, что можно зарегистрировать в контейнере: явное определение
 * провайдера или класс с декоратором роли.
 *
 * @template T - Тип значения
 */
export type Provider<T = unknown> =
  | ProviderDefinition<T>
  | Constructor<T>
  | ResourceClass<T>;

/**
 * Единственный рецепт для целого семейства DI-токенов.
 *
 * Рецепт возвращает обычное определение провайдера для запрошенного члена;
 * билдер проверяет, что его `provide` совпадает с DI-токеном члена.
 *
 * @template T - Тип значения каждого члена
 * @template Params - Параметры члена
 */
export interface FamilyProviderDefinition<
  T = unknown,
  Params extends [param: string] = [param: string],
> {
  /** Семейство, которое обслуживает рецепт */
  family: TokenFamily<T, Params>;
  /** Возвращает определение провайдера для одного члена */
  recipe: (...params: Params) => ProviderDefinition<T>;
}

/**
 * Создаёт рецепт для целого семейства DI-токенов.
 *
 * Результат принимают `ContainerBuilder.register()` и `providers` модуля
 * (массив или фабрика). В `build()` контейнер собирает всех членов,
 * упомянутых в зависимостях провайдеров, вызывает рецепт один раз на
 * каждый параметр и регистрирует результат как обычный узел графа.
 *
 * @template T - Тип значения каждого члена
 * @template Params - Параметры члена
 * @param family - Семейство, созданное `makeTokenFamily`
 * @param recipe - Возвращает определение провайдера для параметра члена
 * @returns Определение рецепта семейства
 *
 * @example
 * ```typescript
 * const LoggingModule = makeModule({
 *   name: 'module:logging',
 *   providers: [
 *     familyProvider(ILogger, (scope) =>
 *       factoryProvider(ILogger(scope), (cfg) => new Logger(scope, cfg), [IConfig]),
 *     ),
 *   ],
 * });
 * ```
 */
export function familyProvider<T, Params extends [param: string]>(
  family: TokenFamily<T, Params>,
  recipe: (...params: Params) => ProviderDefinition<T>,
): FamilyProviderDefinition<T, Params> {
  return { family, recipe };
}

/**
 * Проверяет, что значение — рецепт семейства.
 *
 * В `register()` вызывается раньше `isModule`: модуль узнаётся по
 * строковому `name`, и эта проверка не должна видеть рецепт семейства.
 *
 * @param item - Проверяемое значение
 * @returns `true`, если это `FamilyProviderDefinition`
 */
export const isFamilyDefinition = (
  item: unknown,
): item is FamilyProviderDefinition<any, any> =>
  typeof item === 'object' &&
  item !== null &&
  'family' in item &&
  'recipe' in item &&
  isTokenFamily((item as FamilyProviderDefinition<any, any>).family);

/**
 * Элемент `providers` модуля: обычный провайдер или рецепт семейства.
 *
 * @template T - Тип значения
 */
export type ModuleProvider<T = unknown> =
  | Provider<T>
  | FamilyProviderDefinition<any, any>;

/**
 * Фабрика провайдеров модуля: функция, возвращающая массив провайдеров.
 *
 * Вызывается в `build()` и потому синхронна: фаза сборки не выполняет
 * ввода-вывода. Возвращать рецепты семейств наряду с обычными провайдерами
 * можно.
 *
 * @template T - Тип значений
 */
export type ProvidersFactory<T = unknown> = () => ModuleProvider<T>[];

/**
 * Проверяет, что провайдер — явное определение, а не класс.
 *
 * @template T - Тип значения
 * @param obj - Проверяемое значение
 * @returns `true`, если это `ProviderDefinition`
 */
export const isDefinition = <T>(
  obj: Provider<T>,
): obj is ProviderDefinition<T> =>
  typeof obj === 'object' && obj !== null && 'provide' in obj;

/**
 * Проверяет, что определение — провайдер класса.
 *
 * @template T - Тип значения
 * @param definition - Проверяемое определение
 * @returns `true`, если это `ClassProviderDefinition`
 */
export const isClassDefinition = <T>(
  definition: ProviderDefinition<T>,
): definition is ClassProviderDefinition<T> => 'useClass' in definition;

/**
 * Проверяет, что определение — провайдер значения.
 *
 * @template T - Тип значения
 * @param provider - Проверяемое определение
 * @returns `true`, если это `ValueProviderDefinition`
 */
export const isValueDefinition = <T>(
  provider: ProviderDefinition<T>,
): provider is ValueProviderDefinition<T> => 'useValue' in provider;

/**
 * Проверяет, что определение — фабричный провайдер.
 *
 * @template T - Тип значения
 * @param provider - Проверяемое определение
 * @returns `true`, если это `FactoryProviderDefinition`
 */
export const isFactoryProvider = <T>(
  provider: ProviderDefinition<T>,
): provider is FactoryProviderDefinition<T> => 'useFactory' in provider;

/**
 * Проверяет, что определение — провайдер ресурса.
 *
 * @template T - Тип значения
 * @param provider - Проверяемое определение
 * @returns `true`, если это `ResourceProviderDefinition`
 */
export const isResourceDefinition = <T>(
  provider: ProviderDefinition<T>,
): provider is ResourceProviderDefinition<T> => 'acquire' in provider;

/**
 * DI-токены, которые провайдер запрашивает у контейнера.
 *
 * Читает объявленное значение, ничего не вызывая: у класса зависимости
 * берутся из метаданных декоратора роли, у определения — из `deps`. Нужна
 * тем, кто разбирает состав приложения **до** построения графа: выбор фич
 * и карта операций считаются на фазе ASSEMBLE, когда узлов ещё нет.
 *
 * Рецепт семейства зависимостей не отдаёт: определение он возвращает
 * только для конкретного параметра, а параметры известны по спросу внутри
 * `build()`.
 *
 * @param provider - Провайдер модуля: класс, определение или рецепт
 * семейства
 * @returns DI-токены зависимостей в порядке объявления
 *
 * @example
 * ```typescript
 * dependenciesOf(UserService); // [ILogger, IConfig]
 * ```
 */
export function dependenciesOf(
  provider: ModuleProvider,
): readonly InjectionToken[] {
  if (typeof provider === 'function') {
    return readRoleMeta(provider)?.dependencies ?? [];
  }

  if (isFamilyDefinition(provider)) {
    return [];
  }

  const definition = provider as ProviderDefinition;

  return 'deps' in definition ? (definition.deps ?? []) : [];
}
