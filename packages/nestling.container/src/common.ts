/**
 * Represents a class constructor.
 * This is the standard TypeScript way to define a class type.
 *
 * @template T - The type of instance created by the constructor
 */
export interface Constructor<T = any> {
  /** Class constructor */
  new (...args: any[]): T;
  /** Class name */
  name: string;
}

/**
 * This is a branded type for the type T, it associates a string with the type so we
 * can refer to the T type at runtime.
 */
export type TokenString<T> = string & { __type: T };

/**
 * An injection token - an identifier for a dependency in the DI container.
 *
 * Can be either a string token (created via `makeToken`) or a class constructor.
 *
 * @template T - The type of value that this token provides
 */
export type InjectionToken<T = unknown> = TokenString<T> | Constructor<T>;

/**
 * Unwraps an array of injection tokens into their corresponding types.
 *
 * This utility type is used to ensure type safety when injecting
 * dependencies into a class constructor.
 *
 * @template T - Array of injection tokens
 *
 * @example
 * ```typescript
 * // UnwrapInjectionTokens<[TokenString<string>, Constructor<SomeClass>]>
 * // becomes [string, SomeClass]
 * ```
 */
export type UnwrapInjectionTokens<T extends InjectionToken[]> = {
  [K in keyof T]: T[K] extends TokenString<infer U>
    ? U
    : T[K] extends Constructor<infer V>
      ? V
      : never;
};

/**
 * Creates a runtime identifier for an interface to be used in dependency injection.
 *
 * The function creates a deterministic identifier based on the provided string.
 * Used for interfaces that are not classes (e.g., external services,
 * configurations, abstract interfaces).
 *
 * @template T - The type of the interface that the token represents
 * @param id - A unique string identifier
 * @returns A token typed for use in the DI container
 *
 * @example
 * ```typescript
 * interface ILogger {
 *   log(message: string): void;
 * }
 *
 * const ILogger = makeToken<ILogger>('ILogger');
 *
 * @Injectable(ILogger, [])
 * class ConsoleLogger implements ILogger {
 *   log(message: string) { console.log(message); }
 * }
 * ```
 */
export const makeToken = <T>(id: string): TokenString<T> =>
  id as TokenString<T>;

/**
 * Converts an injection token to a string identifier.
 *
 * If the token is already a string, returns it as is.
 * If the token is a class constructor, creates a string token from the class name.
 *
 * @template T - The type of the token's value
 * @param token - The injection token to convert
 * @returns A string token
 *
 * @example
 * ```typescript
 * const token1 = makeToken<ILogger>('ILogger');
 * stringifyToken(token1); // 'ILogger'
 *
 * class MyService {}
 * stringifyToken(MyService); // 'MyService'
 * ```
 */
export const stringifyToken = <T>(token: InjectionToken<T>): TokenString<T> =>
  typeof token === 'string' ? token : makeToken(token.name);
