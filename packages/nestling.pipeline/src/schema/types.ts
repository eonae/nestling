import type { StandardSchemaV1 } from '@common/misc';

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
 * Выводит domain-тип из схемы — выход `~standard.types.output`
 */
export type DomainType<S extends StandardSchemaV1> =
  StandardSchemaV1.InferOutput<S>;
