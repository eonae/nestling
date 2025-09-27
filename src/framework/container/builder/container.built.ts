import { DAG } from '../../dag';
import { InjectionToken } from '../common';
import { DINode } from '../graph';

/**
 * BuiltContainer provides access to instantiated services.
 * This container is immutable and only allows getting instances.
 */
export class BuiltContainer {
  readonly #graph: DAG<DINode>;

  constructor(graph: DAG<DINode>) {
    this.#graph = graph;
  }


  /**
   * Initialize all modules by calling their onInit hooks in topological order
   */
  async init(): Promise<void> {
    await this.#graph.traverse(async (node) => {
      await node.runInitHooks();
    }, { direction: 'topological' });
  }

  /**
   * Destroy all modules by calling their onDestroy hooks in reverse topological order
   */
  async destroy(): Promise<void> {
    await this.#graph.traverse(async (node) => {
      await node.runDestroyHooks();
    }, { direction: 'reverse-topological' });
  }

  /**
   * Get an instance from the container
   */
  get<T>(token: InjectionToken<T>): T {
    const id = typeof token === 'string' ? token : token.name;

    const node = this.#graph.getNode(id);
    if (!node) {
      throw new Error(`Instance for interface '${id}' is not in the container.`);
    }

    return node.instance as T;
  }

  /**
   * Get the dependency graph for advanced access
   */
  getGraph(): DAG<DINode> {
    return this.#graph;
  }
}
