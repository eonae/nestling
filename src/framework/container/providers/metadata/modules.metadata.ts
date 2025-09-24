import { Constructor } from '../../common';
import { InjectionToken } from '../../common';
import { Provider } from '../variants';

/**
 * Configuration for a module
 */
export interface ModuleConfig<TDeps extends InjectionToken[] = InjectionToken[]> {
  /** Classes decorated with @Injectable or Provider objects that this module provides */
  providers: (Constructor | Provider)[];
  /** Other modules that this module depends on */
  imports: Constructor[];
  /** Classes or InterfaceIds that this module exports for other modules to use */
  exports: InjectionToken[];
  /** Dependencies for the module constructor */
  deps: [...TDeps];
}

/**
 * Metadata stored for each module
 */
export interface ModuleMetadata extends Omit<ModuleConfig, 'deps'> {
  moduleClass: Constructor;
}

/**
 * Storage for module metadata
 */
export const moduleMetaStorage = new WeakMap<object, ModuleMetadata>();
