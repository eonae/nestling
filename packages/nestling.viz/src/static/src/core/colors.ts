// Цвета для разных модулей - отсортированы по радуге 🌈
const MODULE_COLORS = [
  // 🔴 Красные
  '#ef4444',
  '#dc2626',
  '#b91c1c',
  '#db2777',
  '#ec4899',

  // 🟠 Оранжевые
  '#ff6b35',
  '#f97316',
  '#ea580c',

  // 🟡 Жёлтые
  '#f59e0b',
  '#eab308',
  '#ca8a04',

  // 🟢 Зелёные
  '#00ff88',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#16a34a',
  '#059669',
  '#65a30d',

  // 🔵 Голубые/Циан
  '#00d4ff',
  '#06b6d4',
  '#0ea5e9',
  '#0891b2',
  '#0284c7',

  // 🔷 Синие
  '#6366f1',
  '#4f46e5',

  // 🟣 Фиолетовые
  '#8b5cf6',
  '#a855f7',
  '#7c3aed',
  '#9333ea',
  '#6d28d9',
] as const;

// Цвета для компонентов без модуля
export const NO_MODULE_COLOR = '#6b7280';

// Цвета для подсветки узлов
export const DIMMED_NODE_COLOR = '#404040'; // Серый для остальных при активной подсветке
export const HOVERED_NODE_BRIGHTNESS = 1.3; // Множитель яркости для hover

// Цвета для связей
export const LINK_ARROW_COLOR = '#00d4ff'; // Цвет стрелок связей
export const LINK_DEFAULT_COLOR = 'rgba(0, 212, 255, 0.6)'; // Оригинальный цвет связей
export const LINK_HIGHLIGHTED_COLOR = 'rgba(0, 255, 136, 0.8)'; // Ярко-зелёный между подсвеченными
export const LINK_SEMI_HIGHLIGHTED_COLOR = 'rgba(0, 255, 136, 0.4)'; // Средний для связей с подсвеченными
export const LINK_DIMMED_COLOR = 'rgba(100, 100, 100, 0.5)'; // Приглушённый для остальных

// Цвет фона 3D сцены
export const SCENE_BACKGROUND_COLOR = '#0a0a0a';

// Карта модулей к цветам
const moduleColorMap = new Map<string, string>();
let colorIndex = 0;

/**
 * Получает цвет для модуля
 * @param moduleName - Название модуля
 * @returns HEX цвет для модуля
 */
export function getModuleColor(moduleName?: string): string {
  if (!moduleName) {
    return NO_MODULE_COLOR;
  }

  if (!moduleColorMap.has(moduleName)) {
    moduleColorMap.set(
      moduleName,
      MODULE_COLORS[colorIndex % MODULE_COLORS.length],
    );
    colorIndex++;
  }

  return moduleColorMap.get(moduleName)!;
}

/**
 * Осветляет цвет для hover эффекта
 * @param color - HEX цвет
 * @param factor - Множитель яркости (по умолчанию HOVERED_NODE_BRIGHTNESS)
 * @returns Осветлённый HEX цвет
 */
export function brightenColor(
  color: string,
  factor: number = HOVERED_NODE_BRIGHTNESS,
): string {
  // Конвертируем HEX в RGB
  const hex = color.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  // Осветляем каждый компонент
  const newR = Math.min(255, Math.round(r * factor));
  const newG = Math.min(255, Math.round(g * factor));
  const newB = Math.min(255, Math.round(b * factor));

  // Конвертируем обратно в HEX
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

/**
 * Конвертирует HEX цвет в rgba с заданной прозрачностью
 * @param hexColor - HEX цвет (например, '#00d4ff')
 * @param alpha - Прозрачность от 0 до 1 (например, 0.7)
 * @returns rgba строка (например, 'rgba(0, 212, 255, 0.7)')
 */
export function hexToRgba(hexColor: string, alpha: number): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
