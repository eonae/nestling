import { InjectionToken, TokenString, Constructor } from './common';
import { instantiableMetaStorage } from './providers.metadata';

/**
 * Base interface for all provider types
 */
export interface BaseProvider {
  /** The token that this provider provides */
  provide: InjectionToken;
}

/**
 * Provider that creates an instance of a class
 */
export interface ClassProvider<T = unknown> extends BaseProvider {
  /** The class to instantiate */
  useClass: Constructor<T>;
  /** Dependencies to inject into the constructor */
  deps?: readonly InjectionToken[];
}

/**
 * Provider that provides a pre-created value
 */
export interface ValueProvider<T = unknown> extends BaseProvider {
  /** The value to provide */
  useValue: T;
}

/**
 * Provider that creates a value using a factory function
 */
export interface FactoryProvider<T = unknown> extends BaseProvider {
  /** Factory function that creates the value */
  useFactory: (...args: any[]) => T;
  /** Dependencies to inject into the factory function */
  deps: readonly (TokenString<unknown> | Constructor)[];
}

/**
 * Union type of all provider types
 */
export type Provider<T = unknown> = 
  | ClassProvider<T> 
  | ValueProvider<T> 
  | FactoryProvider<T>;

/**
 * Helper type to extract the type from a provider
 */
export type ProviderType<T extends Provider> = T extends Provider<infer U> ? U : never;

/**
 * Helper type to unwrap mixed tokens (InterfaceId or Constructor) to their types
 */
export type UnwrapTokens<T extends readonly (TokenString<unknown> | Constructor)[]> = {
  [K in keyof T]: T[K] extends TokenString<infer U> 
    ? U 
    : T[K] extends Constructor<infer V>
    ? V
    : never;
};

/**
 * Helper type to create a factory provider with typed dependencies
 */
export type FactoryProviderWithDeps<
  T,
  TDeps extends readonly (TokenString<unknown> | Constructor)[]
> = FactoryProvider<T> & {
  useFactory: (...args: UnwrapTokens<TDeps>) => T;
  deps: TDeps;
};

/**
 * Helper function to create a ClassProvider
 */
export function classProvider<T>(
  provide: TokenString<T> | Constructor<T>,
  useClass: Constructor<T>,
): ClassProvider<T> {
  const instantiableMetadata = instantiableMetaStorage.get(useClass);
  if (!instantiableMetadata) {
    throw new Error(`Class ${useClass.name} can't be used in classProvider without @Injectable decorator. If you need register third party class prefer useFactory.`);
  }

  return {
    provide,
    useClass,
    deps: instantiableMetadata.dependencies
  };
}

/**
 * Helper function to create a ValueProvider
 */
export function valueProvider<T>(
  provide: TokenString<T> | Constructor<T>,
  useValue: T
): ValueProvider<T> {
  return {
    provide,
    useValue
  };
}

/**
 * Helper function to create a FactoryProvider with typed dependencies
 */
export function factoryProvider<
  T,
  TDeps extends readonly (TokenString<unknown> | Constructor)[]
>(
  provide: TokenString<T> | Constructor<T>,
  useFactory: (...args: UnwrapTokens<TDeps>) => T,
  deps: TDeps
): FactoryProviderWithDeps<T, TDeps> {
  return {
    provide,
    useFactory,
    deps,
  }
}

/**
 * Type guard to check if an object is a Provider
 */
export const isPlainProvider = (obj: Constructor | Provider): obj is Provider =>
  typeof obj === 'object' && obj !== null && 'provide' in obj;

/**
 * Type guard for ClassProvider
 */
export const isClassProvider = (provider: Provider): provider is ClassProvider => 'useClass' in provider;

/**
 * Type guard for ValueProvider
 */
export const isValueProvider = (provider: Provider): provider is ValueProvider =>
  'useValue' in provider;

/**
 * Type guard for FactoryProvider
 */
export const isFactoryProvider = (provider: Provider): provider is FactoryProvider =>
  'useFactory' in provider;
