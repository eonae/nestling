import { Constructor } from './common';
import { instantiableMetaStorage } from './instantiable';
import { InjectionToken, makeToken, UnwrapInjectionTokens } from './common';
import { Provider } from './provider';

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

/**
 * Decorator for defining modules.
 * Modules group related providers and define their dependencies.
 * 
 * @param config Module configuration
 * @example
 * ```typescript
 * @Module({
 *   providers: [UserService, UserRepository],
 *   exports: [UserService],
 *   imports: [DatabaseModule]
 * })
 * class UserModule {}
 * ```
 */
export function Module<TDeps extends InjectionToken[]>(
  config: Partial<ModuleConfig<TDeps>> & { deps: [...TDeps] }
) {
  return function <T extends { new (...args: UnwrapInjectionTokens<TDeps>): any }>(
    constructor: T,
    _: ClassDecoratorContext<T>
  ) {
    // Store module metadata (validation will happen during module loading)
    moduleMetaStorage.set(constructor, {
      moduleClass: constructor,
      imports: [],
      providers: [],
      exports: [],
      ...config,
    });

    // Also register module as instantiable with dependencies
    instantiableMetaStorage.set(constructor, {
      id: makeToken(constructor.name),
      dependencies: config.deps || []
    });
    
    return constructor;
  };
}
