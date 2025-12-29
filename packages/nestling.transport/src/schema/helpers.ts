import type { RequestContext } from '../core/interfaces.js';

import { parsePayload } from './parse.js';
import type { DomainType, InputSources } from './types.js';

import type { z } from 'zod';

/**
 * Создаёт InputSources из RequestContext
 *
 * Извлекает payload и metadata из контекста
 *
 * @param ctx - Контекст запроса
 * @returns Объект InputSources с payload и metadata
 */
export function createInputSources(ctx: RequestContext): InputSources {
  // Payload уже объединён в транспорте
  const payload = (ctx.payload as Record<string, unknown>) || {};

  // Metadata уже содержит headers и meta
  const metadata = ctx.metadata || {};

  return {
    payload,
    metadata,
  };
}

/**
 * Извлекает описания полей из схемы для генерации документации
 *
 * @param schema - Zod схема для извлечения описаний
 * @returns Объект с описаниями полей
 *
 * @example
 * const descriptions = extractDescription(UserSchema);
 * // { name: "Имя пользователя", email: "Email адрес" }
 */
export function extractDescription<S extends z.ZodType<any, any, any>>(
  schema: S,
): Record<string, string | undefined> {
  const descriptions: Record<string, string | undefined> = {};

  // Для ZodObject проходим по shape
  if ('shape' in schema && schema.shape) {
    for (const [key, fieldSchema] of Object.entries(schema.shape)) {
      if (
        fieldSchema &&
        typeof fieldSchema === 'object' &&
        '_def' in fieldSchema
      ) {
        descriptions[key] = (
          fieldSchema as { _def?: { description?: string } }
        )._def?.description;
      }
    }
  }

  return descriptions;
}

/**
 * Валидирует данные согласно схеме и выбрасывает понятную ошибку
 *
 * @deprecated Используйте parsePayload или parseMetadata напрямую
 * @param schema - Zod схема для валидации
 * @param data - Данные для валидации
 * @returns Валидированные данные
 * @throws SchemaValidationError если валидация не прошла
 */
export function validateOrThrow<S extends z.ZodType<any, any, any>>(
  schema: S,
  data: unknown,
): DomainType<S> {
  // Эта функция оставлена для обратной совместимости
  // Рекомендуется использовать parsePayload или parseMetadata
  const sources: InputSources = {
    payload: data as Record<string, unknown>,
    metadata: {},
  };

  return parsePayload(schema, sources);
}
