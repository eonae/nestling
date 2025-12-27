import { getModuleColor } from './colors';
import type { ExportedGraph } from '../types/graph';
import type { GraphData, GraphLink } from '../types';
import { adaptDataToForceGraph, type ForceGraphData } from '../types/graph3d';

/**
 * Преобразует экспортированные данные в формат для 3d-force-graph
 * @param exportedGraph - Исходные данные графа
 * @returns Данные в формате для 3d-force-graph
 */
export const transformData = (exportedGraph: ExportedGraph): ForceGraphData => {
  // Сначала создаем наши доменные данные
  const graphData: GraphData = transformToGraphData(exportedGraph);

  // Затем адаптируем для библиотеки
  return adaptDataToForceGraph(graphData);
};

/**
 * Преобразует в наш доменный формат
 */
const transformToGraphData = (exportedGraph: ExportedGraph): GraphData => {
  const nodes = exportedGraph.nodes.map((node) => ({
    id: node.id,
    name: node.id,
    module: node.metadata.module || 'no module',
    exported: node.metadata.exported || false,
    color: getModuleColor(node.metadata.module),
    size: Math.max(4, node.dependencies.length + 2), // Размер зависит от количества зависимостей
    dependencyCount: node.dependencies.length, // Сохраняем реальное количество зависимостей
  }));

  const links: GraphLink[] = [];
  exportedGraph.nodes.forEach((node) => {
    node.dependencies.forEach((depId) => {
      links.push({
        source: node.id,
        target: depId,
      });
    });
  });

  // Группируем узлы по модулям
  const modulesMap = new Map();
  nodes.forEach((node) => {
    if (!modulesMap.has(node.module)) {
      modulesMap.set(node.module, {
        name: node.module,
        color: node.color,
        components: [],
      });
    }
    modulesMap.get(node.module).components.push(node);
  });

  return {
    nodes,
    links,
    modules: Array.from(modulesMap.values()),
  };
};
