import type { Hook, LifecycleHooks } from '../lifecycle';

import type { INode } from '@common/graphs';

/**
 * Metadata for a node in the dependency graph.
 */
export interface DINodeMetadata {
  /** Module name if the provider comes from a module. undefined if registered without a module */
  module?: string;
  /** true if the provider is in the module's exports. undefined if no module */
  exported?: boolean;
}

/**
 * Data required to create a DINode.
 *
 * @internal
 */
export interface DINodeData {
  /** The service instance */
  instance: unknown;
  /** Node metadata */
  metadata: DINodeMetadata;
  /** Lifecycle hooks */
  hooks: LifecycleHooks;
  /** Dependency token IDs */
  deps: string[];
}

/**
 * A node in the dependency graph.
 *
 * Represents a single service instance with its metadata, lifecycle hooks,
 * and dependencies.
 */
export class DINode implements INode<DINode> {
  /** Token ID as a string */
  readonly id: string;
  /** The service instance */
  readonly instance: unknown;
  /** Node metadata */
  readonly metadata: DINodeMetadata;
  /** Initialization hooks for this instance */
  readonly onInit: readonly Hook[];
  /** Destruction hooks for this instance */
  readonly onDestroy: readonly Hook[];
  /** Dependencies - child nodes */
  readonly dependencies: readonly DINode[];

  constructor(id: string, dependencies: DINode[] = [], data: DINodeData) {
    this.id = id;
    this.instance = data.instance;
    this.metadata = { ...data.metadata };
    this.onInit = [...data.hooks.onInit];
    this.onDestroy = [...data.hooks.onDestroy];
    this.dependencies = [...dependencies];
  }

  /**
   * Returns all dependencies transitively (all nodes that this node depends on).
   *
   * @returns A set of all transitive dependencies
   */
  getAllDependencies(): Set<DINode> {
    const visited = new Set<DINode>();
    const stack: DINode[] = [this];

    while (stack.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const current = stack.pop()!;

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);
      stack.push(...current.dependencies);
    }

    visited.delete(this); // Exclude self from result
    return visited;
  }

  /**
   * Runs all initialization hooks for this node.
   */
  async runInitHooks(): Promise<void> {
    for (const hook of this.onInit) {
      await hook();
    }
  }

  /**
   * Runs all destruction hooks for this node.
   */
  async runDestroyHooks(): Promise<void> {
    for (const hook of this.onDestroy) {
      await hook();
    }
  }

  /**
   * Returns a string representation of the node for debugging.
   *
   * @returns A string in the format "DINode(tokenId)"
   */
  toString(): string {
    return `DINode(${this.id})`;
  }
}
