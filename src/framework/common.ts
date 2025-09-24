
// new (...args: any[]): any is actually how TS defines type of a class
export type Constructor<T = any> = { new (...args: any[]): T; name: string };

/**
 * This is a branded type for the type T, it associates a string with the type so we
 * can refer to the T type at runtime.
 */
export type InterfaceId<T> = string & { __type: T };

/*
 * Takes an array of InjectionTokens and turn them into an array of the types that the tokens wrap
 *
 * e.g. `UnwrapInjectionTokens<[InterfaceId<string>, Constructor<SomeClass>]>` equals to `[string, SomeClass]`
 *
 * this type is used to enforce dependency types in the constructor of the injected class
 */
export type UnwrapInjectionTokens<T extends InjectionToken[]> = {
  [K in keyof T]: T[K] extends InterfaceId<infer U> ? U : T[K] extends Constructor<infer V> ? V : never;
};

/**
 * Creates a runtime identifier of an interface used for dependency injection.
 *
 * Creates a deterministic identifier based on the provided string.
 * This is used for interfaces that are not classes (e.g., external services, configurations).
 */
export const createInterfaceId = <T>(id: string): InterfaceId<T> => id as InterfaceId<T>;

export const sanitizeId = (idWithRandom: string) => idWithRandom.replace(/-[^-]+$/, '');

  /**
   * Get token ID from provider token
   */
  export const getTokenId = (token: InterfaceId<unknown> | Constructor): string =>
    typeof token === 'string' ? token : token.name;


export type InjectionToken<T = unknown> = InterfaceId<T> | Constructor;

export const isInterfaceId = <T = unknown>(x: InjectionToken<T>): x is InterfaceId<T> => typeof x === 'string';