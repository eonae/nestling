import { getLifecycleHooks } from '../lifecycle';
import { Constructor } from '../common';
import { Provider, ClassProvider, isClassProvider, isValueProvider, isFactoryProvider, isPlainProvider } from '../providers';
import { DINode, DINodeData, DINodeMetadata, DIGraph } from '../graph';
import { stringifyToken } from '../common';
import { BuiltContainer } from './container.built';
import { injectableMetaStorage } from '../providers';
import { isModule, Module } from '../modules';


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
  readonly #providers = new Map<string, Provider>();
  readonly #modules = new Set<string>(); // Store module names instead of constructors
  readonly #providerToModule = new Map<string, string>(); // Отслеживание провайдеров по модулям
  readonly #moduleExports = new Map<string, Set<string>>(); // Экспорты модулей
  #isBuilt = false;

  /**
   * Unified registration method that accepts either providers or modules.
   * This is the main entry point for registering dependencies.
   */
  register(...items: (Provider | Constructor | Module)[]): this {
    if (this.#isBuilt) {
      throw new Error('Cannot register providers or modules after container is built');
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
* Build the container by validating dependencies and instantiating all providers.
* This method must be called after all providers are registered.
* Returns a BuiltContainer that provides access to instances.
*/
  async build(): Promise<BuiltContainer> {
    if (this.#isBuilt) {
      throw new Error('Container is already built');
    }

    // Step 1: Instantiate all providers
    const instances = await this.instantiateAllProviders();

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
      this.#moduleExports.set(m.name, new Set(m.exports.map(token => stringifyToken(token))));
    }

    // Register all providers from this module
    for (const provider of m.providers || []) {
      this.registerProvider(provider, m.name);
    }

    // Mark module as loaded
    this.#modules.add(m.name);
  }

  private resolveProvider(plainOrCls: Provider | Constructor): Provider {
    if (isPlainProvider(plainOrCls)) {
      return plainOrCls;
    }

    const meta = injectableMetaStorage.get(plainOrCls);
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
  private registerProvider(plainOrCls: Provider | Constructor, moduleName?: string): void {
    const provider = this.resolveProvider(plainOrCls);
    const tokenId = stringifyToken(provider.provide);

    if (this.#providers.has(tokenId)) {
      throw new Error(`Provider for token '${tokenId}' is already registered`);
    }

    // Store provider metadata for lazy instantiation
    this.#providers.set(tokenId, provider);

    // Отслеживаем принадлежность к модулю
    if (moduleName) {
      this.#providerToModule.set(tokenId, moduleName);
    }
  }

  /**
   * Create instance from ClassProvider
   */
  private createClassInstance(provider: ClassProvider, instances: Map<string, unknown>): unknown {
    const deps = provider.deps || [];
    const args = deps.map(dep => instances.get(stringifyToken(dep)));
    
    // eslint-disable-next-line new-cap
    return new provider.useClass(...args);
  }


  /**
   * Create instance from any provider type
   */
  private async createInstance(provider: Provider, instances: Map<string, unknown>): Promise<unknown> {
    if (isClassProvider(provider)) {
      return this.createClassInstance(provider, instances);
    } else if (isValueProvider(provider)) {
      return provider.useValue;
    } else if (isFactoryProvider(provider)) {
      const args = provider.deps.map(dep => instances.get(stringifyToken(dep)));
      return await provider.useFactory(...args);
    } else {
      throw new Error('Unknown provider type');
    }
  }


  /**
   * Instantiate all providers in dependency order
   */
  private async instantiateAllProviders(): Promise<Map<string, unknown>> {
    const instances = new Map<string, unknown>();
    const visited = new Set<string>();
    const instantiating = new Set<string>();

    const instantiateProvider = async (tokenId: string): Promise<void> => {
      if (instances.has(tokenId)) {
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
      const instance = await this.createInstance(provider, instances);
      instances.set(tokenId, instance);

      instantiating.delete(tokenId);
      visited.add(tokenId);
    };

    // Instantiate all providers
    for (const tokenId of this.#providers.keys()) {
      await instantiateProvider(tokenId);
    }

    return instances;
  }

  /**
   * Build dependency graph from instantiated providers
   */
  private buildDependencyGraph(instances: Map<string, unknown>): DIGraph {
    const graph = new DIGraph();
    const nodes = new Map<string, DINode>();
    
    // Prepare all node data first
    const nodeData = new Map<string, DINodeData>();

    // First pass: collect all node information
    for (const [tokenId, instance] of instances) {
      const provider = this.#providers.get(tokenId)!;
      const moduleName = this.#providerToModule.get(tokenId);
      
      const hooks = getLifecycleHooks(instance);
      
      const metadata: DINodeMetadata = {
        module: moduleName,
        exported: moduleName ? 
          this.#moduleExports.get(moduleName)?.has(tokenId) : 
          undefined
      };

      const deps = isValueProvider(provider) 
        ? [] 
        : (provider.deps || []).map(dep => stringifyToken(dep));

      nodeData.set(tokenId, {
        instance,
        metadata,
        hooks,
        deps
      });
    }

    // Second pass: create nodes with dependencies

    // Create nodes in topological order to ensure dependencies exist
    const visited = new Set<string>();
    const creating = new Set<string>();
    
    const createRecursive = (id: string): DINode => {
      if (nodes.has(id)) {
        return nodes.get(id)!;
      }
      
      if (creating.has(id)) {
        throw new Error(`Circular dependency detected during node creation: ${id}`);
      }
      
      creating.add(id);
      
      const data = nodeData.get(id);
      if (!data) {
        throw new Error(`Node data not found for token: ${id}`);
      }
      
      // Recursively create all dependencies first
      const dependencies = data.deps.map(createRecursive);

      const node = new DINode(id, dependencies, data);

      graph.addNode(node);

      nodes.set(id, node);
      creating.delete(id);
      visited.add(id);
      
      return node;
    };
    
    // Create all nodes
    for (const tokenId of nodeData.keys()) {
      if (!visited.has(tokenId)) {
        createRecursive(tokenId);
      }
    }

    return graph;
  }
}
