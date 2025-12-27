import * as THREE from 'three';
import ForceGraph3D, { NodeObject } from '3d-force-graph';
import { transformData } from '../core/data-transformer';
import { focusState, highlightState, graphState } from '../core/app-state';
import { eventBus, EVENTS } from '../core/event-bus';
import { focusOnModuleImproved } from '../interactions/focus-system';
import { resetHighlighting } from '../interactions/highlight-system';
import type { Graph3D, ForceGraphNode, ForceGraphData } from '../types/graph3d';
import type { GraphNode } from '../types';
import { adaptNodeFromForceGraph } from '../types/graph3d';
import {
  calculateOptimalCameraDistance,
  createGraphConfig,
} from '../core/graph-config';
import { createNodeStyling } from '../core/node-styling';
import { createLinkStyling } from '../core/link-styling';
import { initializeZoomTracking } from '../core/zoom-tracking';

interface ModuleFocusData {
  moduleName: string;
  moduleNode: GraphNode;
  moduleNodes: GraphNode[];
}

/**
 * Основная функция рендеринга 3D графа
 * @param jsonPath - Путь к JSON файлу с данными графа
 */
export async function render(jsonPath: string): Promise<void> {
  try {
    console.log('🎨 Загрузка данных графа:', jsonPath);

    // Загружаем данные
    const response = await fetch(jsonPath);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const exportedGraph = await response.json();
    console.log('📊 Данные загружены:', exportedGraph);

    const graphData = transformData(exportedGraph);
    console.log('🔄 Данные преобразованы для 3D графа:', graphData);

    // Вычисляем оптимальное расстояние камеры
    const nodeCount = graphData.nodes.length;
    const optimalDistance = calculateOptimalCameraDistance(nodeCount);
    console.log(
      `📷 Вычислено оптимальное расстояние камеры: ${optimalDistance} (узлов: ${nodeCount})`,
    );

    // Создаём 3D граф
    const container = document.getElementById('graph-container');
    if (!container) {
      throw new Error('Container element not found');
    }

    renderGraphInContainer(container, graphData, optimalDistance);
  } catch (error) {
    console.error('❌ Ошибка загрузки данных графа:', error);
    // Ошибка теперь обрабатывается в React компоненте GraphRenderer
    throw error;
  }
}

/**
 * Рендеринг 3D графа в указанном контейнере
 * @param container - DOM элемент контейнера
 * @param graphData - Преобразованные данные графа
 * @param optimalDistance - Оптимальное расстояние камеры
 */
export function renderGraphInContainer(
  container: HTMLElement,
  graphData: ForceGraphData,
  optimalDistance: number,
): void {
  const config = createGraphConfig(graphData, container);
  const nodeStyling = createNodeStyling();
  const linkStyling = createLinkStyling();

  const Graph = new ForceGraph3D(container)
    .width(config.width)
    .height(config.height)
    .graphData(config.graphData)
    .numDimensions(config.numDimensions)
    .cooldownTime(config.cooldownTime)
    .cooldownTicks(config.cooldownTicks)
    .enableNodeDrag(config.enableNodeDrag)
    .backgroundColor(config.backgroundColor)
    .nodeColor(nodeStyling.nodeColor)
    .nodeVal(nodeStyling.nodeVal)
    .nodeLabel(nodeStyling.nodeLabel)
    .linkDirectionalArrowLength(linkStyling.linkDirectionalArrowLength)
    .linkDirectionalArrowRelPos(linkStyling.linkDirectionalArrowRelPos)
    .linkDirectionalArrowColor(linkStyling.linkDirectionalArrowColor)
    .linkColor(linkStyling.linkColor)
    .linkWidth(linkStyling.linkWidth)
    .linkDirectionalParticles(linkStyling.linkDirectionalParticles)
    .linkDirectionalParticleSpeed(linkStyling.linkDirectionalParticleSpeed)
    .linkDirectionalParticleWidth(linkStyling.linkDirectionalParticleWidth)
    .linkDirectionalParticleColor(linkStyling.linkDirectionalParticleColor)
    .onBackgroundClick(handleBackgroundClick)
    .onNodeClick(handleNodeClick)
    .onNodeHover(handleNodeHover);

  Graph.cameraPosition({ x: 0, y: 0, z: optimalDistance });

  // Сохраняем граф в состоянии
  graphState.setGraph(Graph, graphData);
  graphState.setOptimalCameraDistance(optimalDistance);

  // Инициализируем отслеживание зума
  initializeZoomTracking(Graph, optimalDistance);

  // Очищаем состояние подсветки
  highlightState.clear();

  // Настраиваем слушатели событий
  setupEventListeners(Graph, graphData);

  // Настраиваем освещение и постобработку
  setupLighting(Graph);

  // Настраиваем обработку изменения размера окна
  setupResizeHandler(Graph);

  console.log('✅ 3D граф отрендерен');
}

/**
 * Обработчик клика по узлу
 * @param node - Узел
 */
function handleNodeClick(node: NodeObject): void {
  if (!node || !node.id) return;

  const forceNode = node as ForceGraphNode;
  console.log('🎯 Клик по узлу в графе:', forceNode);

  // Проверяем, был ли клик по тому же узлу что и в прошлый раз
  const lastClicked = graphState.getLastClickedNode();
  if (lastClicked && lastClicked.id === node.id) {
    console.log('🔄 Повторный клик по тому же узлу - сброс фокуса');
    eventBus.emit(EVENTS.FOCUS_RESET);
    graphState.setLastClickedNode(null);
    return;
  }

  // Проверяем, находится ли модуль уже в фокусе
  const currentFocus = focusState.getState();
  const moduleName = forceNode.module || 'No Module';

  if (currentFocus.focusedModule === moduleName) {
    console.log('🎯 Модуль уже в фокусе - ничего не делаем:', moduleName);
    return;
  }

  // Сохраняем текущий узел
  graphState.setLastClickedNode(adaptNodeFromForceGraph(forceNode));

  // Debounce кликов
  if (graphState.getClickTimeout()) {
    return;
  }

  const timeout = setTimeout(() => {
    graphState.setClickTimeout(null);
  }, 800);
  graphState.setClickTimeout(timeout);

  // Устанавливаем фокус через событие
  const graphData = graphState.getData();
  if (!graphData) return;

  const moduleNodes = graphData.nodes.filter(
    (n) => n.module === forceNode.module,
  );

  setTimeout(() => {
    eventBus.emit(EVENTS.MODULE_FOCUSED, {
      moduleName,
      moduleNode: adaptNodeFromForceGraph(forceNode),
      moduleNodes: moduleNodes.map(adaptNodeFromForceGraph),
    });
  }, 500);
}

/**
 * Обработчик клика по фону
 */
function handleBackgroundClick(): void {
  console.log('🎯 Клик по фону - сброс фокуса');
  eventBus.emit(EVENTS.FOCUS_RESET);
}

/**
 * Обработчик hover на узле
 * @param node - Узел под курсором или null
 */
function handleNodeHover(node: NodeObject | null): void {
  console.log('🎯 Hover на узле:', node ? node.id : 'null');

  // Устанавливаем узел под курсором
  highlightState.setHovered(node as ForceGraphNode | null);

  // Управляем курсором через API библиотеки
  const graph = graphState.getGraph();
  if (graph) {
    graph.showPointerCursor(node !== null);
    graph.nodeColor(graph.nodeColor()).nodeVal(graph.nodeVal());
  }
}

/**
 * Настраивает слушатели событий
 * @param graph - Экземпляр 3D графа
 * @param graphData - Данные графа
 */
function setupEventListeners(graph: Graph3D, graphData: ForceGraphData): void {
  // Слушатель событий фокуса
  eventBus.on(EVENTS.MODULE_FOCUSED, (data?: unknown) => {
    if (data && typeof data === 'object') {
      const moduleData = data as ModuleFocusData;
      console.log('📡 Граф получил событие фокуса:', moduleData);
      focusOnModuleImproved(graph, moduleData.moduleNode, graphData, {
        moduleNodes: moduleData.moduleNodes,
      });
    }
  });

  eventBus.on(EVENTS.FOCUS_RESET, () => {
    console.log('📡 Граф получил событие сброса фокуса');
    focusState.reset();
    resetHighlighting(graph);
    resetCameraToPanorama(graph);
  });

  // Слушатель стабилизации графа
  let stabilizationTimer: NodeJS.Timeout;
  let stabilizationCount = 0;
  let lastStabilizationTime = Date.now();

  graph.onEngineStop(() => {
    stabilizationCount++;
    const now = Date.now();
    const timeSinceLastStabilization = now - lastStabilizationTime;
    lastStabilizationTime = now;

    clearTimeout(stabilizationTimer);

    stabilizationTimer = setTimeout(() => {
      if (!graphState.isStabilized()) {
        graphState.setStabilized(true);
        console.log(
          `🔄 Граф стабилизирован (событие #${stabilizationCount}), фокусировка готова к работе`,
        );
        eventBus.emit(EVENTS.GRAPH_STABILIZED);
      } else if (timeSinceLastStabilization > 5000) {
        console.log(
          `🔄 Периодическая стабилизация графа (событие #${stabilizationCount}) - это нормально`,
        );
      }
    }, 1500);
  });
}

/**
 * Настройка освещения
 * @param graph - Экземпляр 3D графа
 */
function setupLighting(graph: Graph3D): void {
  const scene = graph.scene();

  // Добавляем ambient light
  const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
  scene.add(ambientLight);

  // Добавляем directional light
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);

  scene.add(directionalLight);
}

/**
 * Настройка обработки изменения размера окна
 * @param graph - Экземпляр 3D графа
 */
function setupResizeHandler(graph: Graph3D): void {
  const updateGraphSize = () => {
    const container = document.getElementById('graph-container');
    if (container && graph) {
      graph.width(container.clientWidth).height(container.clientHeight);
    }
  };

  window.addEventListener('resize', updateGraphSize);
  setTimeout(updateGraphSize, 100);
}

/**
 * Возвращает камеру в панорамный вид
 * @param graph - Экземпляр 3D графа
 */
export function resetCameraToPanorama(graph: Graph3D): void {
  if (!graph) return;

  const optimalDistance = graphState.getOptimalCameraDistance();

  graph.cameraPosition(
    { x: 0, y: 0, z: optimalDistance },
    { x: 0, y: 0, z: 0 },
    2000,
  );

  console.log(
    `📷 Камера возвращена в панорамный вид (расстояние: ${optimalDistance})`,
  );
}

/**
 * Очищает граф и освобождает ресурсы
 */
export function cleanupGraph(): void {
  const graph = graphState.getGraph();
  if (graph) {
    // Очищаем контейнер
    const container = document.getElementById('graph-container');
    if (container) {
      container.innerHTML = '';
    }

    // Очищаем состояние
    graphState.clear();
    highlightState.clear();
    focusState.clear();

    console.log('🧹 Граф очищен');
  }
}
