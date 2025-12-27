import { ModuleFocusedEventData, ZoomUpdateEventData } from '../types';

/**
 * Type guard для проверки что объект является ModuleFocusedEventData
 */
export function isModuleFocusedEventData(
  data: unknown,
): data is ModuleFocusedEventData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;
  return (
    'moduleName' in obj &&
    'moduleNode' in obj &&
    'moduleNodes' in obj &&
    typeof obj.moduleName === 'string' &&
    Array.isArray(obj.moduleNodes)
  );
}

/**
 * Type guard для проверки что объект является ZoomUpdateEventData
 */
export function isZoomUpdateEventData(
  data: unknown,
): data is ZoomUpdateEventData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;
  return (
    'level' in obj &&
    'distance' in obj &&
    typeof obj.level === 'number' &&
    typeof obj.distance === 'number'
  );
}

/**
 * Безопасное получение данных события с type guard
 */
export function safeGetEventData<T>(
  data: unknown,
  typeGuard: (data: unknown) => data is T,
): T | null {
  return typeGuard(data) ? data : null;
}
