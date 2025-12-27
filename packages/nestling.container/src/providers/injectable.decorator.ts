import type {
  Constructor,
  InjectionToken,
  TokenString,
  UnwrapInjectionTokens,
} from '../common';
import { makeToken } from '../common';

import { injectableMetaStorage } from './injectable.metadata';

/**
 * Decorator to register a class in the DI container with an explicit token.
 *
 * Used when a class implements an interface and you want to register it
 * by that interface.
 *
 * @template I - The interface type that the class implements
 * @template TDependencies - Array of dependency tokens
 * @param id - The interface token (created via `makeToken`)
 * @param dependencies - List of tokens to be injected into the constructor
 *
 * @example
 * ```typescript
 * interface ILogger {
 *   log(message: string): void;
 * }
 * const ILogger = makeToken<ILogger>('ILogger');
 *
 * @Injectable(ILogger, [])
 * class ConsoleLogger implements ILogger {
 *   log(message: string) { console.log(message); }
 * }
 * ```
 */
export function Injectable<I, TDependencies extends InjectionToken[]>(
  id: TokenString<I>,
  dependencies: [...TDependencies],
): <T extends new (...args: UnwrapInjectionTokens<TDependencies>) => I>(
  constructor: T,
  context: ClassDecoratorContext<T>,
) => T;

/**
 * Decorator to register a class with automatic token generation.
 *
 * The token will be automatically created from the class name.
 * Suitable for concrete classes that don't implement interfaces.
 *
 * @template TDependencies - Array of dependency tokens
 * @param deps - List of tokens to be injected into the constructor
 *
 * @example
 * ```typescript
 * @Injectable([DatabaseService])
 * class UserService {
 *   constructor(private db: DatabaseService) {}
 * }
 * ```
 */
export function Injectable<TDependencies extends InjectionToken[]>(
  deps: [...TDependencies],
): <T extends new (...args: UnwrapInjectionTokens<TDependencies>) => any>(
  constructor: T,
  context: ClassDecoratorContext<T>,
) => T;

/**
 * Decorator to register a class with support for classes in dependencies.
 *
 * Supports both classes and string tokens as dependencies.
 *
 * @template TDependencies - Array of dependency tokens
 * @param deps - List of classes or tokens for injection
 */
export function Injectable<TDependencies extends InjectionToken[]>(
  deps: [...TDependencies],
): <T extends new (...args: UnwrapInjectionTokens<TDependencies>) => any>(
  constructor: T,
  context: ClassDecoratorContext,
) => T;

export function Injectable<I, TDependencies extends InjectionToken[]>(
  idOrDependencies: TokenString<I> | [...TDependencies],
  deps?: [...TDependencies],
) {
  // this is the trickiest part of the whole DI framework
  // we say, this decorator takes
  // - id (the interface that the injectable implements)
  // - dependencies (list of interface ids that will be injected to constructor)
  //
  // With then we return function that ensures that the decorated class implements the id interface
  // and its constructor has arguments of same type and order as the dependencies argument to the decorator
  return function <T extends Constructor>(
    constructor: T,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _: ClassDecoratorContext<T>,
  ) {
    const injectionToken =
      typeof idOrDependencies === 'string'
        ? idOrDependencies
        : makeToken(constructor.name);

    const dependencies =
      typeof idOrDependencies === 'string' ? deps || [] : idOrDependencies;

    injectableMetaStorage.set(constructor, { injectionToken, dependencies });
    return constructor;
  };
}
