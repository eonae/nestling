import { useState, useCallback } from 'react';
import { GraphData, GraphLink, GraphNode, Module } from '../types';
import { ExportedGraph } from '../types/graph';
import { getModuleColor } from '../core/colors';

export function useGraphData() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGraphData = useCallback(async (jsonPath: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(jsonPath);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // FIXME: Remove artificial delay - added for testing loading screen
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const rawData = await response.json();

      // Преобразуем данные в нужный формат
      const transformedData = transformData(rawData);
      setGraphData(transformedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { graphData, isLoading, error, loadGraphData };
}

function transformData(rawData: ExportedGraph): GraphData {
  const nodes = rawData.nodes.map((node) => ({
    id: node.id,
    name: node.id,
    module: node.metadata.module || 'no module',
    exported: node.metadata.exported || false,
    color: getModuleColor(node.metadata.module),
    size: Math.max(4, node.dependencies.length + 2),
    dependencyCount: node.dependencies.length,
  }));

  const links: GraphLink[] = [];
  rawData.nodes.forEach((node) => {
    node.dependencies.forEach((depId) => {
      links.push({
        source: node.id,
        target: depId,
      });
    });
  });

  // Группируем компоненты по модулям
  const modulesMap = new Map<string, Module>();
  const componentsWithoutModule: GraphNode[] = [];

  nodes.forEach((node) => {
    if (!node.module) {
      componentsWithoutModule.push(node);
      return;
    }

    if (!modulesMap.has(node.module)) {
      modulesMap.set(node.module, {
        name: node.module,
        color: node.color,
        components: [],
      });
    }

    modulesMap.get(node.module)!.components.push(node);
  });

  // Добавляем группу для компонентов без модуля
  if (componentsWithoutModule.length > 0) {
    modulesMap.set('No Module', {
      name: 'No Module',
      color: '#6b7280',
      components: componentsWithoutModule,
    });
  }

  return {
    nodes,
    links,
    modules: Array.from(modulesMap.values()),
  };
}
