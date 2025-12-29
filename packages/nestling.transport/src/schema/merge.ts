/**
 * Объединяет body, query и params в единый payload объект
 *
 * @param body - Тело запроса (обычно JSON)
 * @param query - Query параметры из URL
 * @param params - Path параметры из маршрута
 * @returns Объединённый объект payload
 * @throws Error если обнаружены дублирующиеся ключи между источниками
 *
 * @example
 * const payload = mergePayload(
 *   { name: "Alice", email: "alice@example.com" },
 *   { page: "1" },
 *   { id: "123" }
 * );
 * // { name: "Alice", email: "alice@example.com", page: "1", id: "123" }
 */
export function mergePayload(
  body?: unknown,
  query?: unknown,
  params?: unknown,
): Record<string, unknown> {
  const keys = new Set<string>();
  const result: Record<string, unknown> = {};

  // Обрабатываем каждый источник
  for (const source of [body, query, params]) {
    if (!source || typeof source !== 'object') {
      continue;
    }

    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        if (keys.has(key)) {
          throw new Error(
            `Duplicate key "${key}" found in payload sources. ` +
              `Key exists in multiple sources (body, query, or params).`,
          );
        }
        keys.add(key);
        result[key] = (source as Record<string, unknown>)[key];
      }
    }
  }

  return result;
}
