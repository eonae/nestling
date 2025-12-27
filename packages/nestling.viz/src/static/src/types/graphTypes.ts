export interface GraphNode {
  id: string;
  name: string;
  exported: boolean;
  color: string;
  size: number;
  dependencyCount: number;
  module?: string;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  modules: Module[];
}

export interface Module {
  name: string;
  color: string;
  components: GraphNode[];
}

export interface ModuleInfo {
  color: string;
  components: GraphNode[];
}
