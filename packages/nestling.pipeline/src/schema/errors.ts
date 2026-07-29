import type { StandardSchemaV1 } from '@common/misc';

/**
 * Нормализованный issue валидации.
 *
 * Форма ограничена тем, что гарантирует Standard Schema v1: сообщение и
 * (опционально) путь. Вендорских полей (`code`, `expected`, `received` …)
 * здесь нет — спека их не обещает.
 */
export interface SchemaIssue {
  readonly message: string;
  readonly path?: readonly (string | number)[];
}

/**
 * Приводит сегмент пути спеки к JSON-сериализуемому виду.
 *
 * Спека допускает сегмент-объект `{ key }` и ключ-символ; `issues` уезжают
 * в тело HTTP-ответа, поэтому форма провода не должна зависеть от того, как
 * вендор упаковал путь.
 */
function normalizeSegment(
  segment: PropertyKey | StandardSchemaV1.PathSegment,
): string | number {
  const key =
    typeof segment === 'object' && segment !== null && 'key' in segment
      ? segment.key
      : segment;

  return typeof key === 'number' ? key : String(key);
}

/**
 * Нормализует issue'ы валидатора: разворачивает сегменты-объекты,
 * приводит символы к строкам, сохраняет числовые индексы массивов.
 */
export function normalizeIssues(
  issues: readonly StandardSchemaV1.Issue[],
): readonly SchemaIssue[] {
  return issues.map((issue) => ({
    message: issue.message,
    ...(issue.path === undefined
      ? {}
      : { path: issue.path.map(normalizeSegment) }),
  }));
}

/**
 * Отказ валидации: значение не прошло схему.
 *
 * Это ошибка входа — транспорты отдают на неё 400.
 */
export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: readonly SchemaIssue[],
  ) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

/**
 * Схема вернула Promise из `~standard.validate`.
 *
 * Это ошибка конфигурации приложения (async-refinement в схеме endpoint'а),
 * а не ошибка входа — поэтому класс намеренно **не** наследует
 * {@link SchemaValidationError}: транспорт отдаёт на неё 500, а не 400.
 */
export class AsyncSchemaNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AsyncSchemaNotSupportedError';
  }
}

/**
 * Объект, переданный как схема, не реализует Standard Schema v1.
 *
 * Тоже ошибка конфигурации приложения, а не входа — не наследует
 * {@link SchemaValidationError}.
 */
export class NotAStandardSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotAStandardSchemaError';
  }
}
