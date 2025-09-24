import { getLifecycleHooks, Hook } from '../lifecycle';
import { Constructor } from '../common';
import { Provider, ClassProvider, isClassProvider, isValueProvider, isFactoryProvider, isPlainProvider } from '../provider';
import { stringifyToken } from '../common';
import { BuiltContainer } from './container.built';
import { ModuleMetadata, moduleMetaStorage } from '../module';
import { instantiableMetaStorage } from '../providers.metadata';

type ClassWithDependencies = { cls: Constructor; id: string; dependencies: string[] };

/**
 * Uses depth first search to find out if the classes have circular dependency
 */
const noCircularDependencies = (cwds: ClassWithDependencies[], instanceIds: string[], providerIds: string[]) => {
  const inStack = new Set<string>();

  const hasCircularDependency = (id: string): boolean => {
    if (inStack.has(id)) {
      return true;
    }
    inStack.add(id);

    const cwd = cwds.find((c) => c.id === id);

    // we reference existing instance, there won't be circular dependency past this one because instances don't have any dependencies
    if (!cwd && (instanceIds.includes(id) || providerIds.includes(id))) {
      inStack.delete(id);
      return false;
    }

    if (!cwd) throw new Error(`assertion error: dependency ID missing ${id}`);

    for (const dependencyId of cwd.dependencies) {
      if (hasCircularDependency(dependencyId)) {
        return true;
      }
    }

    inStack.delete(id);
    return false;
  };

  for (const cwd of cwds) {
    if (hasCircularDependency(cwd.id)) {
      throw new Error(
        `Circular dependency detected between interfaces (${Array.from(inStack).join(', ')}), starting with '${cwd.id}' (class: ${cwd.cls.name}).`,
      );
    }
  }
};


/**
 * Container is responsible for managing dependency injection.
 * It uses providers to create and manage instances.
 * 
 * Architecture follows three phases:
 * 1. Registration: Register all providers
 * 2. Validation: Validate circular dependencies and duplicates
 * 3. Build: Instantiate all providers and return BuiltContainer
 */
export class ContainerBuilder {
  readonly #instances = new Map<string, unknown>();
  readonly #providers = new Map<string, Provider>();
  readonly #modules = new Set<Constructor>();
  readonly #initHooks: Hook[] = [];
  readonly #destroyHooks: Hook[] = [];
  #isBuilt = false;

  /**
   * Unified registration method that accepts either providers or modules.
   * This is the main entry point for registering dependencies.
   */
  register(...items: (Provider | Constructor)[]): this {
    if (this.#isBuilt) {
      throw new Error('Cannot register providers or modules after container is built');
    }

    for (const item of items) {
      if (isPlainProvider(item)) {
        this.registerProvider(item);
        continue;
      }

      const moduleMeta = moduleMetaStorage.get(item);
      if (moduleMeta) {
        this.registerModule(item, moduleMeta);
        continue;
      }

      const injectableMeta = instantiableMetaStorage.get(item);
      if (injectableMeta) {
        this.registerProvider(item);
        continue;
      }

      throw new Error(`Class ${item.name} is not decorated with @Injectable or @Module provider`);
    }

    return this;
  }

  /**
 * Build the container by validating dependencies and instantiating all providers.
 * This method must be called after all providers are registered.
 * Returns a BuiltContainer that provides access to instances.
 */
  async build(): Promise<BuiltContainer> {
    if (this.#isBuilt) {
      throw new Error('Container is already built');
    }

    // Step 1: Validate all dependencies for circular references
    this.validateAllDependencies();

    // Step 2: Instantiate all providers
    await this.instantiateAllProviders();

    this.#isBuilt = true;

    // Return a new BuiltContainer with the instances
    return new BuiltContainer(
      new Map(this.#instances),
      this.#initHooks,
      this.#destroyHooks
    );
  }

  /**
   * Load a module and all its dependencies.
   * This method handles module imports and registers providers.
   */
  private registerModule(cls: Constructor, metadata?: ModuleMetadata): void {
    // Check if module is already loaded
    if (this.#modules.has(cls)) {
      return;
    }

    const moduleMetadata = metadata ?? moduleMetaStorage.get(cls);

    if (!moduleMetadata) {
      throw new Error(`Class ${cls.name} is not decorated with @Module`);
    }

    // Load imported modules first
    for (const importedModule of moduleMetadata.imports) {
      this.registerModule(importedModule);
    }

    // Register module itself as a provider (dependencies are now in instantiableMetaStorage)
    this.registerProvider(cls);

    for (const provider of moduleMetadata.providers) {
      this.registerProvider(provider);
    }

    // Mark module as loaded
    this.#modules.add(cls);
  }

  private resolveProvider(plainOrCls: Provider | Constructor): Provider {
    if (isPlainProvider(plainOrCls)) {
      return plainOrCls;
    }

    const meta = instantiableMetaStorage.get(plainOrCls);
    if (!meta) {
      throw new Error(`Class ${plainOrCls.name} is missing @Injectable decorator`)
    }
  
    return {
      provide: meta.injectionToken,
      useClass: plainOrCls,
      deps: meta.dependencies
    };
  }

  /**
   * Register a provider in the container
   */
  private registerProvider(plainOrCls: Provider | Constructor): void {
    const provider = this.resolveProvider(plainOrCls);
    const tokenId = stringifyToken(provider.provide);

    if (this.#providers.has(tokenId)) {
      throw new Error(`Provider for token '${tokenId}' is already registered`);
    }

    // Store provider metadata for lazy instantiation
    this.#providers.set(tokenId, provider);
  }

  /**
   * Create instance from ClassProvider
   */
  private createClassInstance(provider: ClassProvider): unknown {
    const deps = provider.deps || [];
    const args = deps.map(dep => this.#instances.get(stringifyToken(dep)));
    
    // eslint-disable-next-line new-cap
    return new provider.useClass(...args);
  }


  /**
   * Create instance from any provider type
   */
  private async createInstance(provider: Provider): Promise<unknown> {
    if (isClassProvider(provider)) {
      return this.createClassInstance(provider);
    } else if (isValueProvider(provider)) {
      return provider.useValue;
    } else if (isFactoryProvider(provider)) {
      const args = provider.deps.map(dep => this.#instances.get(stringifyToken(dep)));
      return await provider.useFactory(...args);
    } else {
      throw new Error('Unknown provider type');
    }
  }

  /**
   * Validate all dependencies for circular references
   */
  private validateAllDependencies(): void {
    const classesWithDeps: ClassWithDependencies[] = [];
    const visited = new Set<string>();

    const collectDependencies = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      const provider = this.#providers.get(id);
      if (provider && isClassProvider(provider)) {
        const deps = provider.deps || [];
        classesWithDeps.push({
          id,
          cls: provider.useClass,
          dependencies: deps.map(dep => stringifyToken(dep))
        });

        // Recursively collect dependencies
        for (const dep of deps) {
          collectDependencies(stringifyToken(dep));
        }
      }
    };

    // Collect dependencies for all registered providers
    for (const tokenId of this.#providers.keys()) {
      collectDependencies(tokenId);
    }

    if (classesWithDeps.length > 0) {
      noCircularDependencies(
        classesWithDeps,
        Array.from(this.#instances.keys()),
        Array.from(this.#providers.keys())
      );
    }
  }

  /**
   * Instantiate all providers in dependency order
   */
  private async instantiateAllProviders(): Promise<void> {
    const visited = new Set<string>();
    const instantiating = new Set<string>();

    const instantiateProvider = async (tokenId: string): Promise<void> => {
      if (this.#instances.has(tokenId)) {
        return; // Already instantiated
      }

      if (instantiating.has(tokenId)) {
        throw new Error(`Circular dependency detected while instantiating '${tokenId}'`);
      }

      instantiating.add(tokenId);

      const provider = this.#providers.get(tokenId);
      if (!provider) {
        throw new Error(`Provider for token '${tokenId}' not found`);
      }

      if (!isValueProvider(provider)) {
        for (const dep of provider.deps || []) {
          await instantiateProvider(stringifyToken(dep));
        }
      }


      // Create instance
      const instance = await this.createInstance(provider);
      this.#instances.set(tokenId, instance);

      // Collect lifecycle hooks from the instance
      this.collectLifecycleHooks(instance);

      instantiating.delete(tokenId);
      visited.add(tokenId);
    };

    // Instantiate all providers
    for (const tokenId of this.#providers.keys()) {
      await instantiateProvider(tokenId);
    }
  }

  /**
   * Collect lifecycle hooks from an instance and add them to the appropriate arrays
   */
  private collectLifecycleHooks(instance: any): void {
    const hooks = getLifecycleHooks(instance);
    
    // Add init hooks in registration order
    this.#initHooks.push(...hooks.onInit);
    
    // Add destroy hooks in reverse order (LIFO)
    this.#destroyHooks.unshift(...hooks.onDestroy);
  }
}
