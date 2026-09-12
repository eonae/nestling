/**
 * Сверка блоков кода скилла с файлами `snippets/`.
 *
 * Файлы сниппетов компилируются вместе с пакетом, поэтому расхождение
 * блока с файлом означает, что текст скилла отстал от API.
 */
import { checkSnippets } from '../scripts/snippets.mjs';

import { describe, expect, it } from '@jest/globals';

describe('сниппеты скилла', () => {
  it('блоки кода совпадают с файлами snippets/ в обе стороны', () => {
    const findings = checkSnippets().map(
      ({ file, line, message }) => `${file}:${line} — ${message}`,
    );

    expect(findings).toEqual([]);
  });
});
