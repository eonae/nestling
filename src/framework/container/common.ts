
// new (...args: any[]): any is actually how TS defines type of a class
export type Constructor<T = any> = { new (...args: any[]): T; name: string };

/**
 * This is a branded type for the type T, it associates a string with the type so we
 * can refer to the T type at runtime.
 */
export type TokenString<T> = string & { __type: T };

/*
 * Takes an array of InjectionTokens and turn them into an array of the types that the tokens wrap
 *
 * e.g. `UnwrapInjectionTokens<[InterfaceId<string>, Constructor<SomeClass>]>` equals to `[string, SomeClass]`
 *
 * this type is used to enforce dependency types in the constructor of the injected class
 */
export type UnwrapInjectionTokens<T extends InjectionToken[]> = {
  [K in keyof T]: T[K] extends TokenString<infer U> ? U : T[K] extends Constructor<infer V> ? V : never;
};

/**
 * Creates a runtime identifier of an interface used for dependency injection.
 *
 * Creates a deterministic identifier based on the provided string.
 * This is used for interfaces that are not classes (e.g., external services, configurations).
 */
export const makeToken = <T>(id: string): TokenString<T> => id as TokenString<T>;

export type InjectionToken<T = unknown> = TokenString<T> | Constructor<T>;

/**
 * Get token ID from provider token
 */
export const stringifyToken = <T>(token: TokenString<T> | Constructor<T>): TokenString<T> =>
  typeof token === 'string' ? token : makeToken(token.name);


