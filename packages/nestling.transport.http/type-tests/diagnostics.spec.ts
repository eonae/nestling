/**
 * Snapshot-тесты текстов диагностик.
 *
 * Проверяют не *факт* ошибки компиляции (это делают `@ts-expect-error`
 * в спеках пакета), а её **читаемость**: диф снапшота ловит деградацию
 * сообщения при обновлении TypeScript или рефакторинге типов — до того,
 * как её увидит пользователь.
 *
 * Обратный случай проверяет каталог `valid/`: верная декларация обязана
 * компилироваться молча. Снапшот неверной декларации ложной ошибки на
 * верном коде не поймает.
 *
 * Обновление снапшотов — осознанное действие: `yarn test -u` и глазами
 * по каждому дифу.
 */

import {
  compileFixtures,
  fixtureNames,
  validNames,
} from './support/compile.js';

// Одна программа компилятора на оба каталога (design D7): компиляция
// идёт в теле describe, вне таймаута отдельного теста.
const { fixtures, valid } = compileFixtures();

describe('httpEndpoint type diagnostics', () => {
  it('every fixture produces diagnostics', () => {
    const silent = [...fixtures].filter(
      ([, text]) => text === '(no diagnostics)',
    );

    // Фикстура без диагностики — сломанная фикстура: она перестала
    // проверять то, ради чего заведена.
    expect(silent.map(([name]) => name)).toEqual([]);
  });

  for (const name of fixtureNames()) {
    it(`${name}`, () => {
      expect(fixtures.get(name)).toMatchSnapshot();
    });
  }
});

describe('верные декларации компилируются молча', () => {
  for (const name of validNames()) {
    it(`${name}`, () => {
      expect(valid.get(name)).toBe('(no diagnostics)');
    });
  }
});
