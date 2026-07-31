import type { SchemaIssue } from '@common/misc';

/** Одно проваленное поле секции */
export interface ConfigFieldFailure {
  /** Имя поля в рекорде */
  readonly field: string;
  /** Имя ключа, который читался */
  readonly key: string;
  /** Нормализованные issues схемы поля */
  readonly issues: readonly SchemaIssue[];
}

/**
 * Секция не прошла валидацию.
 *
 * Отказ одного поля не прекращает проверку остальных: ошибка несёт **все**
 * проваленные поля секции разом — чинить конфиг по одному полю за перезапуск
 * не должно быть нужно. Перечень опрошенных источников назван здесь же:
 * «ключ не найден» без ответа на «где искали» бесполезно.
 */
export class ConfigValidationError extends Error {
  constructor(
    /** Префикс секции */
    readonly section: string,
    /** Проваленные поля в порядке объявления */
    readonly failures: readonly ConfigFieldFailure[],
    /** Источники, опрошенные читалкой, в порядке приоритета */
    readonly sources: readonly string[],
  ) {
    super(
      `Config section '${section}' is invalid:\n` +
        failures
          .map(
            (failure) =>
              `  - ${failure.key} (field '${failure.field}'): ` +
              failure.issues.map((issue) => issue.message).join('; '),
          )
          .join('\n') +
        `\nSources consulted, in priority order: ${sources.join(', ')}`,
    );
    this.name = 'ConfigValidationError';
  }
}
