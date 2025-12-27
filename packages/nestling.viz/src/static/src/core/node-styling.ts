import { highlightState } from './app-state';
import { DIMMED_NODE_COLOR } from './colors';
import type { ForceGraphNode } from '../types/graph3d';
import type { NodeObject } from '3d-force-graph';

interface NodeStyling {
  nodeColor: string | ((node: NodeObject) => string);
  nodeVal: number | ((node: NodeObject) => number);
  nodeLabel: string | ((node: NodeObject) => string);
}

export function createNodeStyling(): NodeStyling {
  return {
    nodeColor: (node: NodeObject) => {
      const graphNode = node as ForceGraphNode;
      const nodeId = String(graphNode.id);

      const highlighted = highlightState.has(nodeId);
      const hovered = highlightState.getHovered()?.id === nodeId;
      const hasAnyHighlighted = highlightState.hasAny();

      // Если узел подсвечен или под курсором - показываем его оригинальный цвет
      if (highlighted || hovered) {
        return graphNode.color || '#ffffff';
      }

      // Если есть подсвеченные узлы, но этот не подсвечен - приглушаем
      if (hasAnyHighlighted) {
        return DIMMED_NODE_COLOR;
      }

      // Если нет фокуса/подсветки - показываем оригинальные цвета модулей
      return graphNode.color || '#ffffff';
    },

    nodeVal: (node: NodeObject) => {
      const graphNode = node as ForceGraphNode;
      const nodeId = String(graphNode.id);

      const highlighted = highlightState.has(nodeId);
      const hovered = highlightState.getHovered()?.id === nodeId;
      const hasAnyHighlighted = highlightState.hasAny();

      // Если узел подсвечен или под курсором - увеличиваем
      if (highlighted || hovered) {
        return (graphNode.size || 4) * 1.2;
      }

      // Если есть подсветка, но этот узел не подсвечен - уменьшаем
      if (hasAnyHighlighted) {
        return (graphNode.size || 4) * 0.8;
      }

      // Если нет фокуса/подсветки - нормальный размер
      return graphNode.size || 4;
    },

    nodeLabel: (node: NodeObject) => {
      const graphNode = node as ForceGraphNode;
      return graphNode.name || String(graphNode.id);
    },
  };
}
