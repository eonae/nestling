import type { Constructor, InjectionToken, Token } from '../common';

import { injectableMetaStorage } from './injectable.metadata';
import type { TokenFamily } from './token-family';
import { isTokenFamily } from './token-family';

/**
 * Общая часть всех определений провайдеров: токен регистрации.
 *
 * @template T - Тип значения, которое даёт провайдер
 */
interface BaseDefinition<T> {
  /** Токен, под которым провайдер доступен в контейнере */
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
 * Провайдер, создающий значение фабричной функцией.
 *
 * Подходит для сложной логики создания, асинхронной инициализации и
 * классов сторонних библиотек без `@Injectable`.
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
  /** Фабрика, создающая значение */
  useFactory: (...args: any[]) => T;
  /** Зависимости, передаваемые фабрике аргументами */
  deps: readonly InjectionToken[];
}

/**
 * Определение провайдера любого вида: класс, значение или фабрика.
 *
 * @template T - Тип значения
 */
export type ProviderDefinition<T = unknown> =
  | ClassProviderDefinition<T>
  | ValueProviderDefinition<T>
  | FactoryProviderDefinition<T>;

/**
 * Превращает массив токенов (объектных или классов) в массив их типов.
 *
 * @template T - Массив токенов
 */
export type UnwrapTokens<T extends readonly (Token<unknown> | Constructor)[]> =
  {
    [K in keyof T]: T[K] extends Constructor<infer V>
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
 * @template TDeps - Массив токенов зависимостей
 */
export type FactoryProviderWithDeps<
  T,
  TDeps extends readonly InjectionToken[],
> = FactoryProviderDefinition<T> & {
  useFactory: (...args: UnwrapTokens<TDeps>) => T;
  deps: TDeps;
};

/**
 * Создаёт провайдер класса.
 *
 * Класс должен быть помечен `@Injectable`: зависимости берутся из
 * метаданных декоратора.
 *
 * @template T - Тип создаваемого экземпляра
 * @param provide - Токен, под которым регистрируется провайдер
 * @param useClass - Класс с декоратором `@Injectable`
 * @returns Определение провайдера класса
 * @throws {Error} Если у класса нет декоратора `@Injectable`
 *
 * @example
 * ```typescript
 * @Injectable(ILogger, [])
 * class ConsoleLogger implements ILogger {}
 *
 * const provider = classProvider(ILogger, ConsoleLogger);
 * ```
 */
export function classProvider<T>(
  provide: InjectionToken<T>,
  useClass: Constructor<T>,
): ClassProviderDefinition<T> {
  const metadata = injectableMetaStorage.get(useClass);
  if (!metadata) {
    throw new Error(
      `Class ${useClass.name} can't be used in classProvider without @Injectable decorator. If you need register third party class prefer useFactory.`,
    );
  }

  return {
    provide,
    useClass,
    deps: metadata.dependencies,
  };
}

/**
 * Создаёт провайдер готового значения.
 *
 * @template T - Тип значения
 * @param provide - Токен, под которым регистрируется провайдер
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
 * значение. Фабрика может быть синхронной или асинхронной.
 *
 * @template T - Тип создаваемого значения
 * @template TDeps - Массив токенов зависимостей
 * @param provide - Токен, под которым регистрируется провайдер
 * @param useFactory - Фабрика, создающая значение
 * @param deps - Токены зависимостей, передаваемых фабрике
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
  useFactory: (...args: UnwrapTokens<TDeps>) => T,
  deps: TDeps,
): FactoryProviderWithDeps<T, TDeps> {
  return {
    provide,
    useFactory,
    deps,
  };
}

/**
 * То, что можно зарегистрировать в контейнере: явное определение
 * провайдера или класс с декоратором `@Injectable`.
 *
 * @template T - Тип значения
 */
export type Provider<T = unknown> = ProviderDefinition<T> | Constructor<T>;

/**
 * Единственный рецепт для целого семейства токенов.
 *
 * Рецепт возвращает обычное определение провайдера для запрошенного члена;
 * билдер проверяет, что его `provide` совпадает с токеном члена.
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
 * Создаёт рецепт для целого семейства токенов.
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
 * Вызывается в `build()`. Может быть асинхронной и возвращать рецепты
 * семейств наряду с обычными провайдерами.
 *
 * @template T - Тип значений
 */
export type ProvidersFactory<T = unknown> = () =>
  | ModuleProvider<T>[]
  | Promise<ModuleProvider<T>[]>;

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
