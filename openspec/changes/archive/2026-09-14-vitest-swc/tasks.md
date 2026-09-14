## 1. Базовая линия и общий конфиг

- [x] 1.1 Снять цифры jest по каждому пакету и примеру — число файлов и
      число тестов — и записать таблицей в `baseline.md` этого change'а.
      Это единственная сверка «прогон эквивалентен» на весь переход
- [x] 1.2 Добавить в корневые `devDependencies` `vitest`, `@swc/core` и
      `unplugin-swc`
- [x] 1.3 Написать `vitest.config.base.js` с `createVitestConfig(fileUrl,
      overrides)`: swc-плагин (`decoratorVersion: '2022-03'`,
      `useDefineForClassFields`, `target: es2022`), `environment: 'node'`,
      `resolve.conditions` с `testing`, `passWithNoTests`, `include` для
      `src`, `type-tests` и `e2e`
- [x] 1.4 Перенести девять правил `moduleNameMapper` в `resolve.alias` в
      том же порядке: subpath'ы (`./testing`, `./tokens`, `./inbox`,
      `./outbox` и таблицы), затем `common.*`, затем общее правило

## 2. Пилот на `@nestlingjs/container`

- [x] 2.1 Завести `packages/nestling.container/vitest.config.js` и
      заменить скрипт `test` на `vitest run`
- [x] 2.2 Перевести импорты спек пакета на `vitest`, включая `jest` → `vi`
- [x] 2.3 Удалить снапшот `type-tests/__snapshots__/diagnostics.spec.ts.snap`
      и снять заново; проверить, что jest'овых ключей в файле не осталось
- [x] 2.4 Сверить с базовой линией: 19 файлов, 214 тестов

## 3. Остальные пакеты

- [x] 3.1 Завести `vitest.config.js` в каждом пакете `packages/*` взамен
      `jest.config.js`; скрипты `test` — `vitest run` без `NODE_OPTIONS`
- [x] 3.2 Заменить `from '@jest/globals'` на `from 'vitest'` во всех
      спеках; `jest.fn`, `jest.spyOn`, `jest.useFakeTimers`,
      `jest.advanceTimersByTime`, `jest.useRealTimers` — на `vi.*`
- [x] 3.3 Дописать импорт из `vitest` в файлы, которые жили на глобалах
      jest: без импорта прогон падает `describe is not defined`
- [x] 3.4 Перегенерировать снапшоты `@nestlingjs/app` и
      `@nestlingjs/transport.http` тем же порядком, что в 2.3
- [x] 3.5 Сверить каждый пакет с базовой линией; расхождение в числе
      тестов разбирать до конца, а не списывать на раннер

## 4. Примеры

- [x] 4.1 Завести `vitest.config.js` в каждом примере `examples/*`;
      относительный путь — `../../vitest.config.base.js`
- [x] 4.2 Перевести отдельный прогон e2e примера `microservice`; решить
      по открытому вопросу 3 `design.md` — свой файл или `include`
      уточнением базы
- [x] 4.3 Перевести импорты спек примеров и скрипты `test`; сверить с
      базовой линией

## 5. Удаление jest

- [x] 5.1 Убрать из `devDependencies` `jest`, `ts-jest`, `@types/jest`,
      `@jest/globals` и `jest-mock-extended`
- [x] 5.2 Удалить `jest.config.base.js` и
      `.config/jest.setup.disposable.cjs`
- [x] 5.3 Проверить поиском, что упоминаний jest не осталось нигде, кроме
      `docs/history/`, `docs/decisions/` и этого change'а
- [x] 5.4 Закрыть открытый вопрос 2 `design.md`: проверить, ходит ли
      хоть один тест в `dist` соседа, и снять `dependsOn: ["^build"]` у
      таргета `test` в `nx.json`, если не ходит

## 6. Документация

- [x] 6.1 `CLAUDE.md`, раздел «Конфигурация пакетов»: строка таблицы про
      конфиг тестов и упоминание общего файла
- [x] 6.2 `docs/design/testing.md` и английская пара: чем гоняются тесты,
      `vi.fn()` вместо `jest.fn()`
- [x] 6.3 Главы гайда `08-testing.md`, `18-testing-features.md`,
      `20-split.md` и `recipes/extending.md` парами языков; в плашке
      «сверено с кодом» — новая дата
- [x] 6.4 README `@nestlingjs/testing` парой языков: условие `"testing"`
      включается `resolve.conditions`, рядом остаются формы для Node и
      jest
- [x] 6.5 Прогнать линтер стиля по всем изменённым текстам:
      `node .claude/skills/docs-style/scripts/lint.mjs <пути>` → 0
      запрещённых слов
- [x] 6.6 Добавить строку change'а в главную таблицу
      `docs/decisions/roadmap.md`

## 7. Definition of Done

- [x] 7.1 Все задачи выше отмечены
- [x] 7.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` +
      `type-budget` по всем пакетам)
- [x] 7.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 7.4 `design/` и `decisions/` синхронизированы по правилам
      `CLAUDE.md`. Записи `ideas.md`, порождающей этот change, нет — он
      решён обсуждением; вместо пометки «РЕАЛИЗОВАНО» уточняется открытый
      вопрос записи [2026-07-10] «Пакет тестирования» о включении условия
      `"testing"` в раннере
- [x] 7.5 `yarn docs:audit` → 0 ERROR
- [x] 7.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с
      обновлённой датой в плашке «сверено с кодом»
- [x] 7.7 Коммиты осмысленные, `main` не тронут: слияние делает Merger
      после `/opsx:archive`
