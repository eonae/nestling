import { highlightState } from '../core/app-state';
import { eventBus, EVENTS } from '../core/event-bus';
import type { Graph3D, ForceGraphNode } from '../types/graph3d';
import { adaptNodeFromForceGraph } from '../types/graph3d';

/**
 * Принудительное обновление подсветки
 */
function updateHighlight(graph: Graph3D): void {
  graph
    .nodeColor(graph.nodeColor())
    .nodeVal(graph.nodeVal())
    .linkColor(graph.linkColor())
    .linkWidth(graph.linkWidth());
}

/**
 * Контрастная подсветка модуля
 * @param graph - Экземпляр 3D графа
 * @param moduleNodes - Массив узлов модуля для подсветки
 */
export function highlightModulesSoftly(
  graph: Graph3D,
  moduleNodes: ForceGraphNode[],
): boolean {
  try {
    console.log(
      '🌟 Начинаем контрастную подсветку для',
      moduleNodes.length,
      'узлов модуля',
    );

    // Очищаем предыдущую подсветку
    highlightState.clear();

    // Добавляем узлы модуля в подсветку
    const adaptedNodes = moduleNodes.map(adaptNodeFromForceGraph);
    highlightState.add(adaptedNodes);

    // Принудительно обновляем отображение
    updateHighlight(graph);

    // Отправляем событие о подсветке
    eventBus.emit(EVENTS.NODES_HIGHLIGHTED, { nodes: adaptedNodes });

    // Логируем результат
    console.log('✨ Контрастная подсветка применена:');
    console.log(
      `  📍 Подсвечено: ${moduleNodes.length} узлов (оригинальные цвета, увеличены)`,
    );
    console.log(`  🌫️ Приглушено: остальные узлы (серые, уменьшены)`);
    moduleNodes.forEach((node, index) => {
      console.log(`    ${index + 1}. ${node.id} (${node.module})`);
    });

    return true;
  } catch (error) {
    console.error('❌ Ошибка при применении контрастной подсветки:', error);
    return false;
  }
}

/**
 * Сбрасывает подсветку
 * @param graph - Экземпляр 3D графа
 */
export function resetHighlighting(graph: Graph3D): boolean {
  try {
    console.log('🔄 Сброс подсветки - возвращаем оригинальные цвета');

    // Очищаем информацию о подсвеченных узлах
    highlightState.clear();

    // Принудительно обновляем отображение
    updateHighlight(graph);

    // Отправляем событие о сбросе подсветки
    eventBus.emit(EVENTS.HIGHLIGHT_CLEARED);

    console.log('✅ Подсветка сброшена, цвета восстановлены');
    return true;
  } catch (error) {
    console.error('❌ Ошибка при сбросе подсветки:', error);
    return false;
  }
}

/**
 * Мягкая подсветка одного узла
 * @param graph - Экземпляр 3D графа
 * @param targetNode - Целевой узел для подсветки
 */
export function highlightSingleNodeSoftly(
  graph: Graph3D,
  targetNode: ForceGraphNode,
): boolean {
  return highlightModulesSoftly(graph, [targetNode]);
}
