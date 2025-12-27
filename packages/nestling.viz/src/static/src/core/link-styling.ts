import { highlightState, graphState } from './app-state';
import {
  LINK_ARROW_COLOR,
  LINK_DEFAULT_COLOR,
  LINK_HIGHLIGHTED_COLOR,
  LINK_DIMMED_COLOR,
  hexToRgba,
} from './colors';
import type { ForceGraphLink, ForceGraphNode } from '../types/graph3d';
import type { LinkObject, NodeObject } from '3d-force-graph';

/**
 * Извлекает ID из узла, который может быть объектом или строкой
 * @param node - Узел (объект или строка)
 * @returns ID узла как строка
 */
function getNodeId(node: string | number | NodeObject | undefined): string {
  if (!node) return '';
  return typeof node === 'object'
    ? String((node as NodeObject).id)
    : String(node);
}

/**
 * Получает цвет узла по его ID
 * @param nodeId - ID узла
 * @returns Цвет узла или null если не найден
 */
function getNodeColor(nodeId: string): string | null {
  const graphData = graphState.getData();
  if (!graphData) return null;

  const node = graphData.nodes.find((n) => String(n.id) === nodeId) as
    | ForceGraphNode
    | undefined;
  return node?.color || null;
}

interface LinkStyling {
  linkDirectionalArrowLength: number;
  linkDirectionalArrowRelPos: number;
  linkDirectionalArrowColor: string | ((link: LinkObject) => string);
  linkColor: string | ((link: LinkObject) => string);
  linkWidth: number | ((link: LinkObject) => number);
  linkDirectionalParticles: number | ((link: LinkObject) => number);
  linkDirectionalParticleSpeed: number;
  linkDirectionalParticleWidth: number | ((link: LinkObject) => number);
  linkDirectionalParticleColor: string | ((link: LinkObject) => string);
}

export function createLinkStyling(): LinkStyling {
  return {
    linkDirectionalArrowLength: 4,
    linkDirectionalArrowRelPos: 0.8,
    linkDirectionalArrowColor: (link: LinkObject) => {
      const graphLink = link as ForceGraphLink;
      const sourceId = getNodeId(graphLink.source);
      const targetId = getNodeId(graphLink.target);

      const sourceHighlighted = highlightState.has(sourceId);
      const targetHighlighted = highlightState.has(targetId);
      const hasAnyHighlighted = highlightState.hasAny();

      // Если оба узла подсвечены - используем цвет модуля для стрелки (внутри модуля)
      if (sourceHighlighted && targetHighlighted) {
        const sourceColor = getNodeColor(sourceId);
        if (sourceColor) {
          return sourceColor; // Полный цвет модуля для стрелки
        }
        return LINK_ARROW_COLOR;
      }

      // Если один из узлов подсвечен - белая стрелка (связь с модулем)
      if (sourceHighlighted || targetHighlighted) {
        return '#ffffff';
      }

      // Если есть подсветка, но эта связь не связана с подсвеченными узлами - приглушенная стрелка
      if (hasAnyHighlighted) {
        return 'rgba(100, 100, 100, 0.7)';
      }

      // При hover на узле - приглушаем не связанные стрелки
      if (highlightState.getHovered()) {
        return 'rgba(100, 100, 100, 0.7)';
      }

      // Если нет фокуса - обычный цвет стрелки
      return LINK_ARROW_COLOR;
    },

    linkColor: (link: LinkObject) => {
      const graphLink = link as ForceGraphLink;
      const sourceId = getNodeId(graphLink.source);
      const targetId = getNodeId(graphLink.target);

      const sourceHighlighted = highlightState.has(sourceId);
      const targetHighlighted = highlightState.has(targetId);
      const hasAnyHighlighted = highlightState.hasAny();

      // Если оба узла подсвечены - используем яркий цвет модуля (внутри модуля)
      if (sourceHighlighted && targetHighlighted) {
        const sourceColor = getNodeColor(sourceId);
        if (sourceColor) {
          return hexToRgba(sourceColor, 1.0); // Полностью непрозрачный цвет модуля
        }
        return LINK_HIGHLIGHTED_COLOR; // Fallback на зелёный
      }

      // Если один из узлов подсвечен - яркий белый цвет (связь с модулем)
      if (sourceHighlighted || targetHighlighted) {
        return 'rgba(255, 255, 255, 1.0)'; // Полностью белый
      }

      // Если есть подсветка, но эта связь не связана с подсвеченными узлами - приглушаем
      if (hasAnyHighlighted) {
        return LINK_DIMMED_COLOR;
      }

      // При hover на узле - приглушаем не связанные связи
      if (highlightState.getHovered()) {
        return LINK_DIMMED_COLOR;
      }

      // Если нет фокуса - обычный цвет
      return LINK_DEFAULT_COLOR;
    },

    linkWidth: (link: LinkObject) => {
      const graphLink = link as ForceGraphLink;
      const sourceId = getNodeId(graphLink.source);
      const targetId = getNodeId(graphLink.target);

      const sourceHighlighted = highlightState.has(sourceId);
      const targetHighlighted = highlightState.has(targetId);
      const hasAnyHighlighted = highlightState.hasAny();

      // Если оба узла подсвечены - очень толстая связь (внутри модуля)
      if (sourceHighlighted && targetHighlighted) {
        return 3;
      }

      // Если один из узлов подсвечен - толстая ширина (связь с модулем)
      if (sourceHighlighted || targetHighlighted) {
        return 2;
      }

      // Если есть подсветка, но эта связь не связана с подсвеченными узлами - тонкая
      if (hasAnyHighlighted) {
        return 0.8;
      }

      // При hover на узле - тонкие не связанные связи
      if (highlightState.getHovered()) {
        return 0.8;
      }

      // Если нет фокуса - обычная ширина
      return 1;
    },

    // Анимированные частицы для связей внутри модуля
    linkDirectionalParticles: (link: LinkObject) => {
      const graphLink = link as ForceGraphLink;
      const sourceId = getNodeId(graphLink.source);
      const targetId = getNodeId(graphLink.target);

      const sourceHighlighted = highlightState.has(sourceId);
      const targetHighlighted = highlightState.has(targetId);

      // Анимированные частицы для связей внутри модуля и связей с модулем
      if (sourceHighlighted && targetHighlighted) {
        return 3; // 3 частицы для связей внутри модуля
      }

      if (sourceHighlighted || targetHighlighted) {
        return 2; // 2 частицы для связей с модулем
      }

      return 0; // Нет частиц для остальных связей
    },

    // Скорость частиц
    linkDirectionalParticleSpeed: 0.006,

    // Ширина частиц
    linkDirectionalParticleWidth: (link: LinkObject) => {
      const graphLink = link as ForceGraphLink;
      const sourceId = getNodeId(graphLink.source);
      const targetId = getNodeId(graphLink.target);

      const sourceHighlighted = highlightState.has(sourceId);
      const targetHighlighted = highlightState.has(targetId);

      // Ширина частиц в зависимости от типа связи
      if (sourceHighlighted && targetHighlighted) {
        return 2; // Толстые частицы для связей внутри модуля
      }

      if (sourceHighlighted || targetHighlighted) {
        return 1.5; // Средние частицы для связей с модулем
      }

      return 1;
    },

    // Цвет частиц
    linkDirectionalParticleColor: (link: LinkObject) => {
      const graphLink = link as ForceGraphLink;
      const sourceId = getNodeId(graphLink.source);
      const targetId = getNodeId(graphLink.target);

      const sourceHighlighted = highlightState.has(sourceId);
      const targetHighlighted = highlightState.has(targetId);

      // Цвет частиц в зависимости от типа связи
      if (sourceHighlighted && targetHighlighted) {
        const sourceColor = getNodeColor(sourceId);
        if (sourceColor) {
          return sourceColor; // Цвет модуля для частиц внутри модуля
        }
        return LINK_ARROW_COLOR;
      }

      if (sourceHighlighted || targetHighlighted) {
        return '#ffffff'; // Белые частицы для связей с модулем
      }

      return LINK_ARROW_COLOR;
    },
  };
}
