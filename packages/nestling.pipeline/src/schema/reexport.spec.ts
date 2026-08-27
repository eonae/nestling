/**
 * Схемный кернел живёт в `@common/misc`, а `@nestling/pipeline` его
 * реэкспортирует. Тест сторожит именно это: перечень перемещённых имён и
 * их идентичность прямому импорту из нового дома.
 *
 * Без него неполный реэкспорт ломал бы чужие импорты молча — переезд
 * задумывался невидимым для потребителя.
 */

import * as commonMisc from '@common/misc';
import * as pipeline from '@nestling/pipeline';

/** Значения, переехавшие из `@nestling/pipeline/schema` в `@common/misc`. */
const MOVED_VALUES = [
  'validateSync',
  'assertStandardSchema',
  'SchemaValidationError',
  'normalizeIssues',
  'AsyncSchemaNotSupportedError',
  'NotAStandardSchemaError',
] as const;

describe('схемный кернел реэкспортируется из @nestling/pipeline', () => {
  it.each(MOVED_VALUES)('%s — тот же объект, что в @common/misc', (name) => {
    expect(pipeline[name]).toBeDefined();
    expect(pipeline[name]).toBe(commonMisc[name]);
  });

  it('SchemaIssue и DomainType доступны как типы', () => {
    // Типы стираются, поэтому проверка — компиляционная: файл не собрался бы,
    // не будь обоих имён в реэкспорте.
    const issue: pipeline.SchemaIssue = { message: 'boom' };
    const domain: pipeline.DomainType<commonMisc.Schema> = undefined;

    expect(issue.message).toBe('boom');
    expect(domain).toBeUndefined();
  });

  it('ошибка от реэкспортнутой функции ловится классом из @common/misc', () => {
    const schema: commonMisc.Schema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({ issues: [{ message: 'nope' }] }),
      },
    };

    expect(() => pipeline.validateSync(schema, 1, 'failed')).toThrow(
      commonMisc.SchemaValidationError,
    );
  });
});
