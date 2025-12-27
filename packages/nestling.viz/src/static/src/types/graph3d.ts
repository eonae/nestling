import { ForceGraph3DInstance, NodeObject, LinkObject } from '3d-force-graph';
import { GraphNode, GraphLink, GraphData } from './graphTypes';

// Тип для 3D узла - это NodeObject с нашими дополнительными свойствами
export interface ForceGraphNode extends NodeObject {
  // Наши доменные свойства
  name: string;
  module?: string;
  exported?: boolean;
  color: string;
  size: number;
  dependencyCount: number;
}

// Тип для 3D связи
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ForceGraphLink extends LinkObject<ForceGraphNode> {
  // Базовые свойства уже есть в LinkObject
}

export interface ForceGraphData {
  nodes: ForceGraphNode[];
  links: ForceGraphLink[];
}

export type Graph3D = ForceGraph3DInstance;

export interface CameraPosition {
  x: number;
  y: number;
  z: number;
}

// Адаптеры для преобразования между нашими типами и типами библиотеки
export const adaptNodeToForceGraph = (node: GraphNode): ForceGraphNode => ({
  id: node.id,
  name: node.name,
  module: node.module,
  exported: node.exported,
  color: node.color,
  size: node.size,
  dependencyCount: node.dependencyCount,
});

export const adaptLinkToForceGraph = (link: GraphLink): ForceGraphLink => ({
  source: link.source,
  target: link.target,
});

export const adaptDataToForceGraph = (data: GraphData): ForceGraphData => ({
  nodes: data.nodes.map(adaptNodeToForceGraph),
  links: data.links.map(adaptLinkToForceGraph),
});

export const adaptNodeFromForceGraph = (node: ForceGraphNode): GraphNode => ({
  id: String(node.id),
  name: node.name,
  module: node.module || 'no module',
  exported: node.exported || false,
  color: node.color,
  size: node.size,
  dependencyCount: node.dependencyCount,
});
