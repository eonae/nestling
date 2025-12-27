export interface GraphNode {
  id: string | number;
  name: string;
  module?: string;
  exported?: boolean;
  color: string;
  size: number;
  dependencyCount: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface ExportedGraphNode {
  id: string;
  metadata: {
    module?: string;
    exported?: boolean;
  };
  dependencies: string[];
}

export interface ExportedGraph {
  nodes: ExportedGraphNode[];
}
