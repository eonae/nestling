import type { DINode } from './node.class';

import { DAG } from '@common/graphs';

/**
 * JSON representation of a single node in the dependency graph.
 */
export interface JsonDINode {
  /** The token ID */
  id: string;
  /** Node metadata */
  metadata: {
    /** Module name if the provider belongs to a module */
    module?: string;
    /** Whether the provider is exported from its module */
    exported?: boolean;
  };
  /** IDs of dependencies */
  dependencies: string[];
}

/**
 * JSON representation of the entire dependency graph.
 */
export interface JsonDIGraph {
  /** All nodes in the graph */
  nodes: JsonDINode[];
}

/**
 * Dependency injection graph.
 *
 * Extends the base DAG (Directed Acyclic Graph) with DI-specific functionality.
 */
export class DIGraph extends DAG<DINode> {
  /**
   * Converts the dependency graph to JSON format.
   *
   * @returns A JSON representation of the graph
   */
  async toJSON(): Promise<JsonDIGraph> {
    const nodes: JsonDINode[] = [];

    // Traverse all container nodes and export their metadata
    await this.traverse(({ id, metadata, dependencies }) => {
      const exportedNode: JsonDINode = {
        id,
        metadata: {
          module: metadata.module,
          exported: metadata.exported,
        },
        dependencies: dependencies.map((dep) => dep.id),
      };

      nodes.push(exportedNode);
    });

    return { nodes };
  }
}
