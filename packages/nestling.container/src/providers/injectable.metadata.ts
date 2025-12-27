import type { Constructor, InjectionToken } from '../common';

/**
 * Metadata for an injectable class.
 *
 * Contains information about the injection token and class dependencies.
 */
interface InjectableMetadata<T = unknown> {
  /** The token by which the class is registered in the container */
  injectionToken: InjectionToken<T>;
  /** List of dependency tokens to be injected into the constructor */
  dependencies: InjectionToken[];
}

/**
 * Metadata storage for all classes decorated with @Injectable.
 *
 * Used by the internal DI mechanism to store information about tokens
 * and class dependencies. WeakMap allows automatic memory cleanup
 * when references to classes are removed.
 *
 * @internal
 */
export const injectableMetaStorage = new WeakMap<
  Constructor,
  InjectableMetadata
>();
