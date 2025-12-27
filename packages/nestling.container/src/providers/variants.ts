import type { Constructor, InjectionToken, TokenString } from '../common';

import { injectableMetaStorage } from './injectable.metadata';

/**
 * Base interface for all provider types.
 *
 * Defines the common property for all provider variants - the token
 * by which the provider is registered in the container.
 *
 * @template T - The type of value provided by the provider
 */
interface BaseDefinition<T> {
  /** The token by which this provider will be accessible in the container */
  provide: InjectionToken<T>;
}

/**
 * Provider that creates an instance of a class.
 *
 * Used to register a class in the DI container. The container will automatically
 * create an instance of the class, injecting the specified dependencies into the constructor.
 *
 * @template T - The type of the created instance
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
  /** The class to instantiate */
  useClass: Constructor<T>;
  /** Dependencies to inject into the constructor */
  deps?: readonly InjectionToken[];
}

/**
 * Provider that provides a pre-created value.
 *
 * Used to register already created objects, primitives, or constants.
 * The value is used as is, without creating new instances.
 *
 * @template T - The type of the provided value
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
  /** The value to provide */
  useValue: T;
}

/**
 * Provider that creates a value using a factory function.
 *
 * Used for complex instance creation logic, asynchronous initialization,
 * or integration with external libraries.
 *
 * @template T - The type of the created value
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
  /** Factory function to create the value */
  useFactory: (...args: any[]) => T;
  /** Dependencies to inject into the factory function */
  deps: readonly InjectionToken[];
}

/**
 * Union type of all provider variants.
 *
 * Represents any of the possible provider types: class, value, or factory.
 *
 * @template T - The type of the provided value
 */
export type ProviderDefinition<T = unknown> =
  | ClassProviderDefinition<T>
  | ValueProviderDefinition<T>
  | FactoryProviderDefinition<T>;

/**
 * Helper type to unwrap mixed tokens (string or class) to their types.
 *
 * Transforms an array of tokens (string or class) into an array of corresponding types.
 * Used for type safety when working with dependencies.
 *
 * @template T - Array of tokens to unwrap
 */
export type UnwrapTokens<
  T extends readonly (TokenString<unknown> | Constructor)[],
> = {
  [K in keyof T]: T[K] extends TokenString<infer U>
    ? U
    : T[K] extends Constructor<infer V>
      ? V
      : never;
};

/**
 * Helper type to create a factory provider with typed dependencies.
 *
 * Ensures full type safety: the types of factory function arguments
 * are automatically inferred from the list of dependencies.
 *
 * @template T - The type of the created value
 * @template TDeps - Array of dependency tokens
 */
export type FactoryProviderWithDeps<
  T,
  TDeps extends readonly InjectionToken[],
> = FactoryProviderDefinition<T> & {
  useFactory: (...args: UnwrapTokens<TDeps>) => T;
  deps: TDeps;
};

/**
 * Creates a class-based provider.
 *
 * The class must be decorated with @Injectable. Dependencies are automatically
 * extracted from the decorator metadata.
 *
 * @template T - The type of the created instance
 * @param provide - The token by which the provider will be registered
 * @param useClass - The class to instantiate (must be decorated with @Injectable)
 * @returns A class provider definition
 * @throws {Error} If the class is not decorated with @Injectable
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
 * Creates a value-based provider.
 *
 * Used to register constants, configurations, or already created objects.
 *
 * @template T - The type of the provided value
 * @param provide - The token by which the provider will be registered
 * @param useValue - The value to provide
 * @returns A value provider definition
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
 * Creates a factory-based provider.
 *
 * The factory function receives dependencies as arguments and returns
 * the created value. Supports both synchronous and asynchronous factories.
 *
 * @template T - The type of the created value
 * @template TDeps - Array of dependency tokens
 * @param provide - The token by which the provider will be registered
 * @param useFactory - Factory function to create the value
 * @param deps - Array of dependency tokens to inject into the factory
 * @returns A factory provider definition with typed dependencies
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
 * A provider - a definition or class that can be registered in the container.
 *
 * Can be either an explicit provider definition (ClassProviderDefinition,
 * ValueProviderDefinition, FactoryProviderDefinition), or simply a class
 * decorated with @Injectable.
 *
 * @template T - The type of the provided value
 */
export type Provider<T = unknown> = ProviderDefinition<T> | Constructor<T>;

/**
 * A providers factory - a function that returns an array of providers.
 *
 * Used for lazy loading of providers in modules. Supports both
 * synchronous and asynchronous factories.
 *
 * @template T - The type of provided values
 */
export type ProvidersFactory<T = unknown> = () =>
  | Provider<T>[]
  | Promise<Provider<T>[]>;

/**
 * Type guard to check if an object is a provider definition.
 *
 * Distinguishes explicit provider definitions from classes.
 *
 * @template T - The type of the provider
 * @param obj - The object to check
 * @returns true if the object is a ProviderDefinition
 */
export const isDefinition = <T>(
  obj: Provider<T>,
): obj is ProviderDefinition<T> =>
  typeof obj === 'object' && obj !== null && 'provide' in obj;

/**
 * Type guard to check if a definition is a class provider.
 *
 * @template T - The type of the provider
 * @param definition - The provider definition to check
 * @returns true if the definition is a ClassProviderDefinition
 */
export const isClassDefinition = <T>(
  definition: ProviderDefinition<T>,
): definition is ClassProviderDefinition<T> => 'useClass' in definition;

/**
 * Type guard to check if a definition is a value provider.
 *
 * @template T - The type of the provider
 * @param provider - The provider definition to check
 * @returns true if the definition is a ValueProviderDefinition
 */
export const isValueDefinition = <T>(
  provider: ProviderDefinition<T>,
): provider is ValueProviderDefinition<T> => 'useValue' in provider;

/**
 * Type guard to check if a definition is a factory provider.
 *
 * @template T - The type of the provider
 * @param provider - The provider definition to check
 * @returns true if the definition is a FactoryProviderDefinition
 */
export const isFactoryProvider = <T>(
  provider: ProviderDefinition<T>,
): provider is FactoryProviderDefinition<T> => 'useFactory' in provider;
