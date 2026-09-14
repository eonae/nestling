/**
 * Сверка блоков кода скилла с файлами `snippets/` и сборка приложения,
 * которое эти файлы составляют.
 *
 * Файлы сниппетов компилируются вместе с пакетом, поэтому расхождение
 * блока с файлом означает, что текст скилла отстал от API. Компиляция
 * проверяет каждый файл по отдельности; сборка проверяет их как одно
 * приложение — политику корня, слои endpoint'ов, рёбра между фичами.
 */
import {
  checkSnippets,
  regionsOf,
  writeSnippets,
} from '../scripts/snippets.mjs';
import { app } from '../snippets/app.js';

import { bind, RootLogger$ } from '@nestlingjs/app';
import { buildTest, spyLogger, vars } from '@nestlingjs/testing';
import { describe, expect, it } from 'vitest';

describe('сниппеты скилла', () => {
  it('блоки кода совпадают с файлами snippets/ в обе стороны', () => {
    const findings = checkSnippets().map(
      ({ file, line, message }) => `${file}:${line} — ${message}`,
    );

    expect(findings).toEqual([]);
  });

  it('составляют приложение, которое собирается', async () => {
    // Подмен графа нет: смысл проверки в том, что собирается тот же граф,
    // который получит читатель, скопировав сниппеты. Конфигурация —
    // потому что `apiToken` объявлен без умолчания, логгер — потому что
    // иначе сборка пишет в консоль теста
    await using built = await buildTest(app, {
      config: [bind(vars({ API_TOKEN: 'test-token' }))],
      overrides: [[RootLogger$, spyLogger().logger]],
    });

    expect(built).toBeDefined();
  });

  it('перезапись на сошедшихся файлах не меняет ни одного байта', () => {
    expect(writeSnippets()).toEqual([]);
  });
});

describe('участки сниппетов', () => {
  it('отдают тело со снятым общим отступом', () => {
    const { regions, problems } = regionsOf(
      [
        'class A {',
        '  // #region reading',
        '  size(): number {',
        '    return 1;',
        '  }',
        '  // #endregion',
        '}',
      ].join('\n'),
      'a.ts',
    );

    expect(problems).toEqual([]);
    expect(regions.get('reading')).toBe('size(): number {\n  return 1;\n}');
  });

  it('отвергают вложенный участок', () => {
    const { problems } = regionsOf(
      '// #region outer\n// #region inner\n// #endregion\n',
      'a.ts',
    );

    expect(problems[0]?.message).toBe('участок #inner открыт внутри #outer');
  });

  it('отвергают повтор имени участка', () => {
    const { problems } = regionsOf(
      '// #region one\n// #endregion\n// #region one\n// #endregion\n',
      'a.ts',
    );

    expect(problems[0]?.message).toBe('участок #one объявлен второй раз');
  });

  it('отвергают незакрытый участок', () => {
    const { problems } = regionsOf('// #region one\nconst a = 1;\n', 'a.ts');

    expect(problems[0]?.message).toBe('участок #one не закрыт // #endregion');
  });
});
