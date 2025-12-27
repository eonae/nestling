import type { Constructor, InjectionToken } from '../common';
import { stringifyToken } from '../common';
import type { DINodeData, DINodeMetadata } from '../graph';
import { DIGraph, DINode } from '../graph';
import { getLifecycleHooks } from '../lifecycle';
import type { Module } from '../modules';
import { isModule } from '../modules';
import type {
  ClassProviderDefinition,
  Provider,
  ProviderDefinition,
  ProvidersFactory,
} from '../providers';
import {
  injectableMetaStorage,
  isClassDefinition,
  isDefinition,
  isFactoryProvider,
  isValueDefinition,
} from '../providers';

import { BuiltContainer } from './container.built';

/**
 * DI container builder.
 *
 * Responsible for managing dependency injection. Uses providers
 * to create and manage instances.
 *
 * Architecture follows three phases:
 * 1. **Registration**: register all providers and modules
 * 2. **Validation**: check for circular dependencies and duplicates
 * 3. **Build**: instantiate all providers and return a built container
 *
 * @example
 * ```typescript
 * const container = await new ContainerBuilder()
 *   .register(UserService)
 *   .register(DatabaseService)
 *   .build();
 * ```
 */
export class ContainerBuilder {
  readonly #providers = new Map<InjectionToken, ProviderDefinition>();
  readonly #providersFactories = new Map<string, ProvidersFactory>();
  readonly #providerToModule = new Map<InjectionToken, string>();
  readonly #moduleExports = new Map<string, Set<InjectionToken>>();
  readonly #modules = new Set<string>();

  #isBuilt = false;

  /**
   * Unified registration method that accepts providers or modules.
   *
   * This is the main entry point for registering dependencies.
   *
   * @param items - Providers or modules to register
   * @returns The current builder instance for method chaining
   * @throws {Error} If the container is already built
   *
   * @example
   * ```typescript
   * builder
   *   .register(UserService, DatabaseService)
   *   .register(userModule)
   *   .build();
   * ```
   */
  register(...items: (Provider | Module)[]): this {
    if (this.#isBuilt) {
      throw new Error(
        'Cannot register providers or modules after container is built',
      );
    }

    for (const item of items) {
      if (isModule(item)) {
        this.registerModule(item);
      } else {
        this.registerProvider(item);
      }
    }

    return this;
  }

  /**
   * Builds the container, validating dependencies and instantiating all providers.
   *
   * This method must be called after all providers are registered.
   * Performs the following steps:
   * 1. Instantiates all providers
   * 2. Builds the dependency graph
   * 3. Validates the graph for circular dependencies
   *
   * @returns A built container with access to instances
   * @throws {Error} If the container is already built or circular dependencies are detected
   *
   * @example
   * ```typescript
   * const container = await new ContainerBuilder()
   *   .register(UserService)
   *   .build();
   *
   * await container.init();
   * ```
   */
  async build(): Promise<BuiltContainer> {
    if (this.#isBuilt) {
      throw new Error('Container is already built');
    }

    // Step 1: Instantiate all providers
    const instances = await this.instantiateAll();

    // Step 2: Build dependency graph from instances
    const graph = this.buildDependencyGraph(instances);

    // Step 3: Validate the built graph for circular dependencies
    graph.ensureAcyclic();

    this.#isBuilt = true;

    // Return a new BuiltContainer with the graph
    return new BuiltContainer(graph);
  }

  /**
   * Load a module and all its dependencies.
   * This method handles module imports and registers providers.
   */
  private registerModule(m: Module): void {
    // Check if module is already loaded
    if (this.#modules.has(m.name)) {
      return;
    }

    // Load imported modules first (recursive)
    for (const importedModule of m.imports || []) {
      this.registerModule(importedModule);
    }

    // Сохраняем экспорты модуля
    if (m.exports && m.exports.length > 0) {
      const set = new Set(m.exports.map((token) => stringifyToken(token)));
      this.#moduleExports.set(m.name, set);
    }

    if (typeof m.providers === 'function') {
      this.#providersFactories.set(m.name, m.providers);
    } else {
      for (const provider of m.providers || []) {
        this.registerProvider(provider, m.name);
      }
    }

    // Mark module as loaded
    this.#modules.add(m.name);
  }

  private resolveProvider(
    plainOrCls: ProviderDefinition | Constructor,
  ): ProviderDefinition {
    if (isDefinition(plainOrCls)) {
      return plainOrCls;
    }

    const meta = injectableMetaStorage.get(plainOrCls);
    if (!meta) {
      throw new Error(
        `Class ${plainOrCls.name} is missing @Injectable decorator`,
      );
    }

    return {
      provide: meta.injectionToken,
      useClass: plainOrCls,
      deps: meta.dependencies,
    };
  }

  private getToken<T>(provider: Provider<T>): InjectionToken<T> {
    return isDefinition(provider) ? provider.provide : provider;
  }

  /**
   * Register a provider in the container
   */
  private registerProvider<T>(
    provider: Provider<T>,
    moduleName?: string,
  ): void {
    const resolvedProvider = this.resolveProvider(provider);
    const token = this.getToken(resolvedProvider);
    const tokenId = stringifyToken(token);

    if (this.#providers.has(tokenId)) {
      throw new Error(
        `Provider for token '${stringifyToken(token)}' is already registered`,
      );
    }

    // Store provider metadata for lazy instantiation
    this.#providers.set(tokenId, resolvedProvider);

    // Отслеживаем принадлежность к модулю
    if (moduleName) {
      this.#providerToModule.set(tokenId, moduleName);
    }
  }

  /**
   * Create instance from ClassProvider
   */
  private createClassInstance(
    provider: ClassProviderDefinition,
    instances: Map<InjectionToken, unknown>,
  ): unknown {
    const deps = provider.deps || [];
    const args = deps.map((dep) => instances.get(stringifyToken(dep)));

    return new provider.useClass(...args);
  }

  /**
   * Create instance from any provider type
   */
  private async createInstance(
    provider: ProviderDefinition,
    instances: Map<InjectionToken, unknown>,
  ): Promise<unknown> {
    if (isClassDefinition(provider)) {
      return this.createClassInstance(provider, instances);
    } else if (isValueDefinition(provider)) {
      return provider.useValue;
    } else if (isFactoryProvider(provider)) {
      const args = provider.deps.map((dep) =>
        instances.get(stringifyToken(dep)),
      );
      return await provider.useFactory(...args);
    } else {
      throw new Error('Unknown provider type');
    }
  }

  private async appendFactoryProviders(): Promise<void> {
    for (const factory of this.#providersFactories.values()) {
      const providers = await factory();
      for (const provider of providers) {
        this.registerProvider(provider);
      }
    }
  }

  /**
   * Instantiate all providers in dependency order
   */
  private async instantiateAll(): Promise<Map<InjectionToken, unknown>> {
    await this.appendFactoryProviders();
    const instances = new Map<InjectionToken, unknown>();
    const visited = new Set<InjectionToken>();
    const instantiating = new Set<InjectionToken>();

    const instantiateOne = async (token: InjectionToken): Promise<void> => {
      if (instances.has(token)) {
        return;
      }

      if (instantiating.has(token)) {
        throw new Error(
          `Circular dependency detected while instantiating '${token}'`,
        );
      }

      instantiating.add(token);

      const provider = this.#providers.get(token);
      if (!provider) {
        throw new Error(`Provider for token '${token}' not found`);
      }

      if (!isValueDefinition(provider)) {
        for (const dep of provider.deps || []) {
          await instantiateOne(stringifyToken(dep));
        }
      }

      // Create instance
      const instance = await this.createInstance(provider, instances);
      instances.set(token, instance);

      instantiating.delete(token);
      visited.add(token);
    };

    // Instantiate all providers
    for (const tokenId of this.#providers.keys()) {
      await instantiateOne(tokenId);
    }

    return instances;
  }

  /**
   * Build dependency graph from instantiated providers
   */
  private buildDependencyGraph(
    instances: Map<InjectionToken, unknown>,
  ): DIGraph {
    const graph = new DIGraph();
    const nodes = new Map<string, DINode>();

    // Prepare all node data first
    const nodeData = new Map<string, DINodeData>();

    // First pass: collect all node information
    for (const [token, instance] of instances) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const provider = this.#providers.get(token)!;
      const moduleName = this.#providerToModule.get(token);

      const hooks = getLifecycleHooks(instance);

      const metadata: DINodeMetadata = {
        module: moduleName,
        exported: moduleName
          ? this.#moduleExports.get(moduleName)?.has(token)
          : undefined,
      };

      const deps = isValueDefinition(provider)
        ? []
        : (provider.deps || []).map((dep) => stringifyToken(dep));

      nodeData.set(stringifyToken(token), {
        instance,
        metadata,
        hooks,
        deps,
      });
    }

    // Second pass: create nodes with dependencies

    // Create nodes in topological order to ensure dependencies exist
    const visited = new Set<string>();
    const creating = new Set<string>();

    const createRecursive = (id: string): DINode => {
      if (nodes.has(id)) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return nodes.get(id)!;
      }

      if (creating.has(id)) {
        throw new Error(
          `Circular dependency detected during node creation: ${id}`,
        );
      }

      creating.add(id);

      const data = nodeData.get(id);
      if (!data) {
        throw new Error(`Node data not found for token: ${id}`);
      }

      const dependencies = data.deps.map(createRecursive);

      const node = new DINode(id, dependencies, data);

      graph.addNode(node);

      nodes.set(id, node);
      creating.delete(id);
      visited.add(id);

      return node;
    };

    for (const tokenId of nodeData.keys()) {
      if (!visited.has(tokenId)) {
        createRecursive(tokenId);
      }
    }

    return graph;
  }
}
