/**
 * Схемный кернел живёт в `@nestlingjs/common.misc`, а `@nestlingjs/app` его
 * реэкспортирует. Тест сторожит именно это: перечень перемещённых имён и
 * их идентичность прямому импорту из нового дома.
 *
 * Без него неполный реэкспорт ломал бы чужие импорты молча — переезд
 * задумывался невидимым для потребителя.
 */

import * as app from '@nestlingjs/app';
import * as commonMisc from '@nestlingjs/common.misc';

/** Значения, переехавшие из схемного слоя пайплайна в `@nestlingjs/common.misc`. */
const MOVED_VALUES = [
  'validateSync',
  'assertStandardSchema',
  'SchemaValidationError',
  'normalizeIssues',
  'AsyncSchemaNotSupportedError',
  'NotAStandardSchemaError',
] as const;

describe('схемный кернел реэкспортируется из @nestlingjs/app', () => {
  it.each(MOVED_VALUES)(
    '%s — тот же объект, что в @nestlingjs/common.misc',
    (name) => {
      expect(app[name]).toBeDefined();
      expect(app[name]).toBe(commonMisc[name]);
    },
  );

  it('SchemaIssue и DomainType доступны как типы', () => {
    // Типы стираются, поэтому проверка — компиляционная: файл не собрался бы,
    // не будь обоих имён в реэкспорте.
    const issue: app.SchemaIssue = { message: 'boom' };
    const domain: app.DomainType<commonMisc.Schema> = undefined;

    expect(issue.message).toBe('boom');
    expect(domain).toBeUndefined();
  });

  it('ошибка от реэкспортнутой функции ловится классом из @nestlingjs/common.misc', () => {
    const schema: commonMisc.Schema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({ issues: [{ message: 'nope' }] }),
      },
    };

    expect(() => app.validateSync(schema, 1, 'failed')).toThrow(
      commonMisc.SchemaValidationError,
    );
  });
});
