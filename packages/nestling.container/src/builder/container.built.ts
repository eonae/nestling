import type { InjectionToken } from '../common';
import type { DIGraph, DINode, JsonDIGraph } from '../graph';

import type { VisitCallback, VisitOptions } from '@common/graphs';

/**
 * Built DI container with access to instantiated services.
 *
 * This container is immutable and only allows getting instances,
 * running lifecycle hooks, and traversing the dependency graph.
 *
 * @example
 * ```typescript
 * const container = await new ContainerBuilder()
 *   .register(UserService)
 *   .build();
 *
 * await container.init();
 * const userService = container.get(UserService);
 * await container.destroy();
 * ```
 */
export class BuiltContainer {
  readonly #graph: DIGraph;

  constructor(graph: DIGraph) {
    this.#graph = graph;
  }

  /**
   * Initializes all services by calling their @OnInit hooks.
   *
   * Hooks are called in topological order: dependencies first,
   * then services that depend on them.
   *
   * @throws {Error} If any of the hooks throws an error
   *
   * @example
   * ```typescript
   * const container = await builder.build();
   * await container.init(); // Calls all @OnInit hooks
   * ```
   */
  async init(): Promise<void> {
    await this.#graph.traverse(
      async (node) => {
        await node.runInitHooks();
      },
      { direction: 'topological' },
    );
  }

  /**
   * Destroys all services by calling their @OnDestroy hooks.
   *
   * Hooks are called in reverse topological order: services first,
   * then their dependencies.
   *
   * @throws {Error} If any of the hooks throws an error
   *
   * @example
   * ```typescript
   * await container.destroy(); // Calls all @OnDestroy hooks
   * ```
   */
  async destroy(): Promise<void> {
    await this.#graph.traverse(
      async (node) => {
        await node.runDestroyHooks();
      },
      { direction: 'reverse-topological' },
    );
  }

  /**
   * Gets a service instance from the container by token.
   *
   * @template T - The type of the requested instance
   * @param token - The service token (class or string token)
   * @returns The service instance
   * @throws {Error} If the service is not registered in the container
   *
   * @example
   * ```typescript
   * const userService = container.get(UserService);
   * const logger = container.get(ILogger);
   * ```
   */
  get<T>(token: InjectionToken<T>): T {
    const id = typeof token === 'string' ? token : token.name;

    const node = this.#graph.getNode(id);
    if (!node) {
      throw new Error(
        `Instance for interface '${id}' is not in the container.`,
      );
    }

    return node.instance as T;
  }

  /**
   * Traverses the dependency graph, executing the callback for each node.
   *
   * @param callback - Function to call for each node
   * @param options - Traversal options (direction, filters, etc.)
   */
  async traverse(
    callback: VisitCallback<DINode>,
    options: VisitOptions<DINode> = {},
  ): Promise<void> {
    return await this.#graph.traverse(callback, options);
  }

  /**
   * Converts the dependency graph to JSON format.
   *
   * Used for visualization and analysis of the dependency structure.
   *
   * @returns JSON representation of the dependency graph
   */
  async toJSON(): Promise<JsonDIGraph> {
    return await this.#graph.toJSON();
  }
}
