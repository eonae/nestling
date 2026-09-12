/**
 * Сверка блоков кода скилла с файлами `snippets/` и сборка приложения,
 * которое эти файлы составляют.
 *
 * Файлы сниппетов компилируются вместе с пакетом, поэтому расхождение
 * блока с файлом означает, что текст скилла отстал от API. Компиляция
 * проверяет каждый файл по отдельности; сборка проверяет их как одно
 * приложение — политику корня, слои endpoint'ов, рёбра между фичами.
 */
import { checkSnippets } from '../scripts/snippets.mjs';
import { app } from '../snippets/app.js';

import { describe, expect, it } from '@jest/globals';
import { RootLogger$ } from '@nestlingjs/app';
import { assembleTest, spyLogger, vars } from '@nestlingjs/testing';

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
    await using assembled = await assembleTest(app, {
      config: vars({ API_TOKEN: 'test-token' }),
      overrides: [[RootLogger$, spyLogger().logger]],
    });

    expect(assembled).toBeDefined();
  });
});
