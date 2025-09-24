import { InjectionToken, makeToken, UnwrapInjectionTokens } from '../../common';
import { instantiableMetaStorage } from '../providers.metadata';
import { ModuleConfig, moduleMetaStorage } from '../module';

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
    _: ClassDecoratorContext<T>,
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
      injectionToken: makeToken(constructor.name),
      dependencies: config.deps || []
    });
    
    return constructor;
  };
}
