import type { z } from 'zod';

/**
 * Объединённые источники входных данных
 */
export interface InputSources {
  /**
   * Payload - объединённые данные пользователя (body + query + params)
   * При совпадении имён между источниками выбрасывается ошибка
   */
  payload: Record<string, unknown>;

  /**
   * Metadata - транспорт-специфичные данные (headers, auth, tracing и т.п.)
   */
  metadata: Record<string, unknown>;
}

/**
 * Выводит domain-тип из zod-схемы
 */
export type DomainType<S extends z.ZodType<any, any, any>> = z.infer<S>;
