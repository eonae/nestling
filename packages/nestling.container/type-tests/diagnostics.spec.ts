/**
 * Snapshot-тесты текстов диагностик ролей класса.
 *
 * Проверяют не *факт* ошибки компиляции (это делают `@ts-expect-error`
 * в `src/providers/role.decorators.spec.ts`), а её **читаемость**: диф
 * снапшота ловит деградацию сообщения при обновлении TypeScript или
 * рефакторинге типов — до того, как её увидит пользователь.
 *
 * Обновление снапшотов — осознанное действие: `yarn test -u` и глазами
 * по каждому дифу.
 */

import { compileFixtures, fixtureNames } from './support/compile.js';

// Одна программа компилятора на весь каталог: компиляция идёт в теле
// модуля, вне таймаута отдельного теста.
const diagnostics = compileFixtures();

describe('class role type diagnostics', () => {
  it('every fixture produces diagnostics', () => {
    const silent = [...diagnostics].filter(
      ([, text]) => text === '(no diagnostics)',
    );

    // Фикстура без диагностики — сломанная фикстура: она перестала
    // проверять то, ради чего заведена.
    expect(silent.map(([name]) => name)).toEqual([]);
  });

  for (const name of fixtureNames()) {
    it(`${name}`, () => {
      expect(diagnostics.get(name)).toMatchSnapshot();
    });
  }
});
