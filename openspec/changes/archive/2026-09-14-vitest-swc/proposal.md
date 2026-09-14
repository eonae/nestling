## Why

Тесты репозитория гоняет jest с ts-jest под `NODE_OPTIONS=--experimental-vm-modules`.
Прогон `@nestlingjs/app` занимает 14.7 с, `@nestlingjs/transport.http` — 10.1 с.

Половина `jest.config.base.js` существует только ради самого jest: второй
tsconfig внутри конфига, таблица `moduleNameMapper` из девяти правил и
setup-файл `.config/jest.setup.disposable.cjs`, который доопределяет
`Symbol.asyncDispose`. Последний нужен потому, что jest исполняет тест в
отдельном vm-реалме, куда символы Node не попадают.

Замеры 2026-09-13 на этом же коде: vitest 5 со swc-трансформом даёт те же
тесты один в один — `@nestlingjs/app` 70 файлов и 990 тестов за 2.5 с,
`@nestlingjs/transport.http` 12 и 179 за 2.9 с. Зелёными идут все 19
пакетов с тестами, это около 2264 тестов, включая снапшоты, фейковые
таймеры, живые сокеты и `await using`.

Запись `ideas.md` под этим решением одна, и она давняя: открытый вопрос
«Включение `"testing"`-condition в vitest/jest из коробки» записи
[ideas.md [2026-07-10]](../../../docs/decisions/ideas.md) «Пакет
тестирования». Сам переход решён обсуждением 2026-09-13.

## What Changes

**Раннер и трансформ.**

- Тесты репозитория гоняет `vitest`. Скрипт пакета — `vitest run`, без
  `NODE_OPTIONS`.
- TypeScript компилирует swc через `unplugin-swc` с
  `decoratorVersion: '2022-03'`. Дефолтный esbuild не годится: он знает
  только legacy-декораторы и падает `SyntaxError` на первом `@Component`.
  В `@nestlingjs/app` это ровно 20 спек-файлов из 70.
- Условие резолва `testing` включается полем `resolve.conditions`.
  `moduleNameMapper` переезжает в `resolve.alias` правило в правило.

**Конфигурация пакета.**

- `jest.config.js` пакета заменяется на `vitest.config.js`, общая часть —
  `createVitestConfig(import.meta.url)` вместо `createJestConfig`.
  Расширение `.js` то же, что у остальных конфигов пакета.
- Пакету без тестов нужен `passWithNoTests`: `common.graphs`,
  `common.static-server` и `viz` иначе выходят с кодом 1.
- Отдельный прогон e2e примера `microservice` остаётся отдельным
  конфигом.

**Тексты тестов.**

- Импорт `@jest/globals` заменяется на `vitest` в 150 файлах. Вместе с ним
  `jest` становится `vi`: это 15 вызовов `jest.fn`, 3 `jest.spyOn` и две
  пары `useFakeTimers`/`useRealTimers`.
- Ещё 61 файл живёт на глобалах, которые подставлял jest. Каждый
  получает явный импорт: глобалы vitest включаются опцией, но «explicit
  over implicit» здесь весомее экономии строк.
- Три снапшот-файла перегенерируются: у vitest другой заголовок и другой
  формат ключей, свои записи он дописывает рядом с jest'овыми.

**Зависимости.** Уходят `jest`, `ts-jest`, `@types/jest`, `@jest/globals`
и `jest-mock-extended` — последний числится в `devDependencies`, а в коде
не используется. Приходят `vitest`, `@swc/core`, `unplugin-swc`.

**Проверка того, что прогон эквивалентен.** Сверка одна на пакет: число
файлов и число тестов под vitest совпадает с числом под jest. Цифры jest
снимаются до правок.

## Capabilities

### New Capabilities

- `test-runner`: чем репозиторий гоняет тесты — раннер, трансформ
  декораторов, изоляция файла, резолв соседних пакетов на исходники,
  состав конфига пакета.

### Modified Capabilities

- `testing-subpath-convention`: условие `testing` в репозитории включает
  конфиг vitest, а не `customExportConditions` jest. Требование о README
  и главе гайда получает третий способ включения — `resolve.conditions`.
- `examples-layout`: пример ссылается на общий конфиг тестов новым именем.
- `package-publication`: тарбол не содержит конфиг тестов под новым именем.
- `agent-skill-package`: общий набор конфигов пакета назван новым именем.

## Non-goals

- **Содержание скилла для внешних агентов** (`agent-skill-content`,
  `references/testing.md`). Скилл говорит о проекте пользователя, а не о
  нашем репозитории; jest и `node:test` остаются его вариантами. Открытый
  вопрос той записи — про `node:test`, и этот change его не закрывает.
- **Bun.** Прогон под bun и джоба совместимости — отдельный разговор,
  сюда не входят.
- **`type-budget`.** Бюджет типов остаётся на `tsx type-tests/bench/run.ts`.
- **Снятие диагностик типов.** `type-tests/diagnostics.spec.ts` работает
  как работал: меняется только формат снапшота.
- **`vitest --typecheck`.** Проверку типов спек делает таргет `typecheck`
  пакета, и так и остаётся.
- **Правка самих тестов.** Меняются импорты и снапшоты, а не то, что
  тесты проверяют.

## Impact

- `jest.config.base.js` → `vitest.config.base.js`;
  `.config/jest.setup.disposable.cjs` удаляется.
- 29 конфигов пакетов и примеров, около 192 файлов спек, из них 130 с
  импортом `@jest/globals`.
- Скрипт `test` в 29 манифестах; `yarn verify` не меняется.
- `nx.json`: `dependsOn: ["^build"]` у таргета `test` — проверить, нужен
  ли он после переезда, и снять, если нет.
- `CLAUDE.md`, раздел «Конфигурация пакетов»: строка таблицы про
  `jest.config.js`.
- Документация парой языков: `docs/design/testing.md`,
  `docs/guide/08-testing.md`, `docs/guide/18-testing-features.md`,
  `docs/guide/20-split.md`, `docs/recipes/extending.md` и README пары
  `@nestlingjs/testing`.
- Открытый вопрос на решение в design: заменить таблицу `resolve.alias`
  условием экспорта `source` в манифестах пакетов.
