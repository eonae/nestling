import { focusState, graphState } from '../core/app-state.js';
import { eventBus, EVENTS } from '../core/event-bus.js';
import {
  highlightModulesSoftly,
  highlightSingleNodeSoftly,
} from './highlight-system.js';
import type {
  Graph3D,
  ForceGraphNode,
  ForceGraphData,
  CameraPosition,
} from '../types/graph3d.js';
import { adaptNodeFromForceGraph } from '../types/graph3d.js';
import { calculateModuleFocusDistance } from '../core/graph-config.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface EventData {
  moduleNodes: ForceGraphNode[];
}
/**
 * Улучшенная фокусировка на модуле
 * @param graph - Экземпляр 3D графа
 * @param clickedNode - Узел, по которому кликнули
 * @param graphData - Данные графа
 * @param eventData - Дополнительные данные события
 */
export function focusOnModuleImproved(
  graph: Graph3D,
  clickedNode: ForceGraphNode,
  graphData: ForceGraphData,
  eventData: EventData | null = null,
): void {
  const moduleName = clickedNode.module;

  console.log(
    '🎯 Улучшенная фокусировка на узле:',
    clickedNode.id,
    'модуль:',
    moduleName,
  );

  // Находим все узлы этого модуля
  const moduleNodes = eventData
    ? eventData.moduleNodes
    : graphData.nodes.filter((node) => node.module === moduleName);

  // Устанавливаем состояние фокуса
  if (moduleName) {
    focusState.setModule(
      moduleName,
      adaptNodeFromForceGraph(clickedNode),
      moduleNodes.map(adaptNodeFromForceGraph),
    );
  } else {
    focusState.setModule('No Module', adaptNodeFromForceGraph(clickedNode), [
      adaptNodeFromForceGraph(clickedNode),
    ]);
  }

  // Функция для выполнения фокусировки
  const performFocus = () => {
    if (!moduleName) {
      // Если узел без модуля, используем мягкую фокусировку
      console.log('📍 Мягкая фокусировка на одиночной ноде без модуля');
      softFocusOnNode(graph, clickedNode);
      return;
    }

    console.log(
      `🔍 Фокусировка на модуле "${moduleName}", узлов: ${moduleNodes.length}`,
    );
    try {
      const currentNodeData = graph
        .graphData()
        .nodes.find((n) => n.id === clickedNode.id) as ForceGraphNode;

      if (currentNodeData && typeof currentNodeData.x !== 'undefined') {
        // Если координаты доступны, используем оптимальное расстояние
        const distance = calculateModuleFocusDistance(moduleNodes.length);

        // Вычисляем центр модуля
        const moduleCenter = calculateModuleCenterFromCurrentNodes(
          graph,
          moduleNodes,
        );

        graph.cameraPosition(
          {
            x: moduleCenter.x + distance * 0.7,
            y: moduleCenter.y + distance * 0.5,
            z: moduleCenter.z + distance,
          },
          moduleCenter,
          2000,
        );

        console.log('✅ Фокусировка выполнена на центре модуля:', moduleCenter);

        // Мягкая подсветка через манипуляцию THREE.js объектов
        sleep(100).then(() => {
          highlightModulesSoftlyLocal(graph, moduleNodes);
          // Завершаем лоадинг через событие
          eventBus.emit(EVENTS.FOCUS_LOADING_END);
        });
      } else {
        // Если координаты недоступны, используем fallback
        console.log('⚠️ Координаты недоступны, используем мягкую фокусировку');
        softFocusOnNode(graph, clickedNode);
      }
    } catch (error) {
      console.error('❌ Ошибка при фокусировке:', error);
      softFocusOnNode(graph, clickedNode);
    }
  };

  // Проверяем, готов ли граф
  if (graphState.isStabilized()) {
    console.log('📊 Граф стабилизирован, выполняем фокусировку сразу');
    performFocus();
  } else {
    console.log('⏳ Граф ещё не стабилизирован, ждём...');
    setTimeout(performFocus, graphState.isStabilized() ? 0 : 1000);
  }
}

/**
 * Вычисляет центр модуля из актуальных позиций узлов в графе
 * @param graph - Экземпляр 3D графа
 * @param moduleNodes - Массив узлов модуля
 * @returns Координаты центра модуля {x, y, z}
 */
export function calculateModuleCenterFromCurrentNodes(
  graph: Graph3D,
  moduleNodes: ForceGraphNode[],
): CameraPosition {
  // Используем кэшированные данные если граф стабилизирован
  let currentGraphData: ForceGraphData;
  if (graphState.isStabilized() && graphState.getData()) {
    currentGraphData = graphState.getData() as ForceGraphData;
    console.log('📦 Используем кэшированные данные графа');
  } else {
    currentGraphData = graph.graphData() as ForceGraphData;
    console.log('🔄 Получаем свежие данные графа');
  }

  const actualNodes = moduleNodes
    .map((node) => currentGraphData.nodes.find((n) => n.id === node.id))
    .filter((node): node is ForceGraphNode => node !== undefined);

  if (actualNodes.length === 0) return { x: 0, y: 0, z: 0 };

  const center = actualNodes.reduce(
    (acc, node) => ({
      x: acc.x + (node.x || 0),
      y: acc.y + (node.y || 0),
      z: acc.z + (node.z || 0),
    }),
    { x: 0, y: 0, z: 0 },
  );

  return {
    x: center.x / actualNodes.length,
    y: center.y / actualNodes.length,
    z: center.z / actualNodes.length,
  };
}

/**
 * Мягкая фокусировка на узле без нарушения симуляции
 * @param graph - Экземпляр 3D графа
 * @param targetNode - Целевой узел
 */
export function softFocusOnNode(
  graph: Graph3D,
  targetNode: ForceGraphNode,
): void {
  console.log('🎯 Мягкая фокусировка на узле:', targetNode.id);

  // Пытаемся получить актуальные координаты
  try {
    const currentNodeData = graph
      .graphData()
      .nodes.find((n) => n.id === targetNode.id) as ForceGraphNode;

    if (
      currentNodeData &&
      typeof currentNodeData.x !== 'undefined' &&
      typeof currentNodeData.y !== 'undefined' &&
      typeof currentNodeData.z !== 'undefined'
    ) {
      // Фокусируемся на конкретном узле
      graph.cameraPosition(
        {
          x: currentNodeData.x + 150,
          y: currentNodeData.y + 100,
          z: currentNodeData.z + 200,
        },
        { x: currentNodeData.x, y: currentNodeData.y, z: currentNodeData.z },
        1500,
      );

      // Добавляем мягкую подсветку
      sleep(100).then(() => {
        highlightSingleNodeSoftlyLocal(graph, targetNode);
        // Завершаем лоадинг через событие
        eventBus.emit(EVENTS.FOCUS_LOADING_END);
      });

      return;
    }
  } catch (error) {
    console.warn(
      '⚠️ Не удалось получить координаты для мягкой фокусировки:',
      error,
    );
  }

  // Fallback: простая фокусировка с фиксированным расстоянием
  graph.cameraPosition({ x: 300, y: 200, z: 400 }, { x: 0, y: 0, z: 0 }, 1500);

  // В fallback случае завершаем лоадинг через небольшую задержку
  setTimeout(() => {
    eventBus.emit(EVENTS.FOCUS_LOADING_END);
  }, 200);
}

/**
 * Мягкая подсветка модуля
 * @param graph - Экземпляр 3D графа
 * @param moduleNodes - Массив узлов модуля
 */
function highlightModulesSoftlyLocal(
  graph: Graph3D,
  moduleNodes: ForceGraphNode[],
): void {
  highlightModulesSoftly(graph, moduleNodes);
}

/**
 * Мягкая подсветка одного узла
 * @param graph - Экземпляр 3D графа
 * @param targetNode - Целевой узел
 */
function highlightSingleNodeSoftlyLocal(
  graph: Graph3D,
  targetNode: ForceGraphNode,
): void {
  highlightSingleNodeSoftly(graph, targetNode);
}
