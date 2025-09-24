import { Constructor } from './common';
import { InjectionToken, TokenString } from './common';

interface InstantiableMetadata<T = unknown> {
  id: TokenString<T>;
  dependencies: InjectionToken[];
}

/**
 * Here we store the id and dependencies for all classes
 * decorated with @Injectable and @Module
 */
export const instantiableMetaStorage = new WeakMap<Constructor, InstantiableMetadata>();
