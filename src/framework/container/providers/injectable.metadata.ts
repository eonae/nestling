import { Constructor } from '../common';
import { InjectionToken } from '../common';

interface InjectableMetadata<T = unknown> {
  injectionToken: InjectionToken<T>;
  dependencies: InjectionToken[];
}

/**
 * Here we store the id and dependencies for all classes
 * decorated with @Injectable and @Module
 */
export const injectableMetaStorage = new WeakMap<Constructor, InjectableMetadata>();
