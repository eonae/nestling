import type { ForceGraphData } from '../types/graph3d';

interface GraphConfig {
  width: number;
  height: number;
  graphData: ForceGraphData;
  numDimensions: 1 | 2 | 3;
  cooldownTime: number;
  cooldownTicks: number;
  enableNodeDrag: boolean;
  backgroundColor: string;
}

export function createGraphConfig(
  graphData: ForceGraphData,
  container: HTMLElement,
): GraphConfig {
  return {
    width: container.clientWidth,
    height: container.clientHeight,
    graphData,
    numDimensions: 3,
    cooldownTime: 15000,
    cooldownTicks: 100,
    enableNodeDrag: false,
    backgroundColor: '#0a0a0a',
  };
}

export function calculateOptimalCameraDistance(nodeCount: number): number {
  // Слегка увеличенное базовое расстояние
  const baseDistance = 400;

  // Более консервативное масштабирование
  const scaleFactor = Math.log10(nodeCount + 1) * 0.8;

  return Math.max(baseDistance, baseDistance * scaleFactor);
}

/**
 * Вычисляет оптимальное расстояние камеры при фокусировке на модуле
 * @param moduleNodeCount - Количество узлов в модуле
 * @returns Оптимальное расстояние для фокусировки
 */
export function calculateModuleFocusDistance(moduleNodeCount: number): number {
  // Базовое расстояние для фокусировки
  const baseDistance = 200;

  // Для модулей используем более консервативное масштабирование
  const scaleFactor = Math.sqrt(moduleNodeCount) * 1.2;

  // Минимальное и максимальное расстояние для фокусировки
  const minDistance = 150;
  const maxDistance = 800;

  const calculatedDistance = baseDistance + scaleFactor * 30;

  return Math.max(minDistance, Math.min(maxDistance, calculatedDistance));
}
