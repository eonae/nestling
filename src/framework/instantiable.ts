import { Constructor } from './common';
import { InjectionToken, InterfaceId } from './common';

interface InstantiableMetadata<T = unknown> {
  id: InterfaceId<T>;
  dependencies: InjectionToken[];
}

/**
 * Here we store the id and dependencies for all classes
 * decorated with @Injectable and @Module
 */
export const instantiableMetaStorage = new WeakMap<Constructor, InstantiableMetadata>();
