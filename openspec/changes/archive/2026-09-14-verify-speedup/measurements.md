# Замеры yarn verify — 2026-09-14, M1 Max (10 ядер, 32 ГБ), Node 24.10

Рядом лежат профили nx в формате Chrome Tracing: `profile-parallel-3.json` —
прогон с тремя слотами, `profile-parallel-10.json` — с десятью. Открываются в
`chrome://tracing`; из них взяты таблица по таргетам и раскладка задач во
времени.

## Базовая картина (холодный прогон, parallel=3 по умолчанию)

verify:fresh = 170 с: run-many 157 с + smoke 0.6 с + public-api-validator 13 с
CPU-сумма 458 с при 154 с wall → утилизация 2.98x (3 слота заняты полностью)

| таргет      | CPU     | доля  | задач | медиана | максимум     |
|-------------|---------|-------|-------|---------|--------------|
| lint        | 153.2 с | 33.4% | 28    | 4.6 с   | 16.8 с (app) |
| build       | 121.8 с | 26.6% | 28    | 4.0 с   | 8.1 с (viz)  |
| typecheck   | 96.6 с  | 21.1% | 28    | 3.3 с   | 5.6 с        |
| test        | 79.9 с  | 17.4% | 28    | 2.7 с   | 6.6 с (app)  |
| type-budget | 6.9 с   | 1.5%  | 1     | —       | —            |

## Фиксированный оверхед — ~47% CPU

common.graphs (3 файла, 288 строк, 0 спек): lint 2.4 + build 2.4 + typecheck 1.8 + test 1.1 = 7.7 с
28 проектов × 7.7 ≈ 215 с из 458 с. Из них: yarn-обёртка 0.4 с, старт tsc 0.5 с, база ESLint 1.4–2.2 с.

## Кэш nx (все 5 таргетов cache: true)

| сценарий                      | время   |
|-------------------------------|---------|
| холодный прогон               | 171.5 с |
| повтор без правок             | 1.6 с   |
| правка 1 файла в app/src      | 30.1 с  |
| правка 1 файла в examples/cli | 10.0 с  |

Кэш в `.nx/cache` внутри репо → у каждого worktree свой, пустой.
`NX_CACHE_DIRECTORY` проверен, работает.

## Гонка в графе зависимостей (баг)

При `--parallel=10` падают `container/app/transport.http:typecheck` с
`error TS2307: Cannot find module '@nestlingjs/app'`.

Причина: type-tests и часть спек импортируют свой пакет по публичному имени
(`type-tests/support/fixture-kit.ts:8`, `src/pipeline/schema/reexport.spec.ts:10`) → резолв в `dist`.
`typecheck` объявляет `dependsOn: ["^build"]` (`nx.json:36`) — только зависимости, не свой `build`.
Свой `build` начинается с `rm -rf dist`.
Воспроизведено вручную: стёр dist common.graphs → app:typecheck упал.

Фикс проверен — `dependsOn: ["^build","build"]` для typecheck/lint/test:

- parallel=3 с фиксом: 157 с (цена нулевая)
- parallel=6 с фиксом: 112 с, зелёный
- parallel=10 без фикса: 120 с, 3 падения

Масштабирование плохое: CPU-сумма 458 → 1123 с при parallel=10 (каждая задача в 2.4x медленнее).

## skipLibCheck — не включён в 24 из 28 проектов

| пакет          | как есть | --skipLibCheck |
|----------------|----------|----------------|
| app            | 4.3 с    | 2.8 с (−35%)   |
| transport.http | 2.7 с    | 1.6 с (−41%)   |
| container      | 1.9 с    | 1.2 с (−37%)   |
| common.graphs  | 1.3 с    | 0.6 с (−54%)   |

Где уже включён — вынужденно: drizzle.pg без него 70 ошибок из node_modules
(drizzle-orm/gel-core импортирует несуществующий `gel`), viz — битый three-forcegraph.

incremental: app 2.8 → 1.0 с на повторном прогоне.

## Тайпчек выполняется 4 раза (≈280 из 458 с CPU)

1. `typecheck` — tsc -p tsconfig.json (96.6 с)
2. `build` — tsc -p tsconfig.build.json, ~92% времени тайпчек (121.8 с)
3. `lint` — typescript-eslint строит третью программу (~50 с из 153 с)
4. `public-api-validator` — ~20 программ над dist/index.d.ts (13 с)

Эмит почти бесплатен: `tsc --emitDeclarationOnly` 2.2 с против полного build 2.4 с
→ swc вместо tsc сэкономит 0.2 с, тайпчек ради d.ts никуда не денется.

## ESLint: type-aware не используется вообще

Подключены `tslint.configs.strict` и `stylistic` (`.config/eslint.config.js:89-90`) — наборы БЕЗ type-checking.
Ни одного type-aware правила. При этом `parserOptions.project` задан (строка 171).

Снятие project: app 14.1 → 12.7 с, http 8.7 → 8.0 с, graphs 1.9 → 1.6 с.
Находки идентичны: 120 = 120, пофайлово и построчно, ничего не потеряно.

Один процесс на монорепу (`projectService: true`): 27 с, пиковая память 1.87 ГБ.
Сейчас: 2.04 ГБ на app, 2.02 ГБ на transport.http — на КАЖДЫЙ из 28 процессов.
Память при объединении не растёт (projectService грузит проекты лениво и делит lib.d.ts).

Если включить strictTypeCheckedOnly на app: 602 находки.
require-await 254, restrict-template-expressions 63, no-unnecessary-type-assertion 43,
no-unsafe-assignment 38, no-confusing-void-expression 36, no-unnecessary-condition 19.
**no-floating-promises 0, no-misused-promises 0, await-thenable 0** ← код по промисам чист.

## tsgo (@typescript/native-preview 7.0.0-dev.20260707.2)

app:typecheck 4.3 → 1.6 с; с `--skipLibCheck` → 0.3 с (9x).

17 расхождений: 11 × TS2769 + 6 × TS2578, попарно, все в файлах с точечным `@ts-expect-error`
(endpoint-detached.spec.ts:108, endpoint-errors.spec.ts:227/236/291/310, implement.spec.ts:198 и др.).
Причина: tsc привязывает диагностику неудачной перегрузки к конкретному свойству,
tsgo — к вызову целиком → директива «не использована», ошибка всплывает.
Из 91 `@ts-expect-error` в app задето 17.

## oxlint 1.82.0

4.1 с на весь репозиторий против 153 с CPU у ESLint.
Type-aware правил нет (в разработке через tsgolint).
Кастомные JS-плагины не поддерживаются → `@nestlingjs/eslint-plugin` (import-through-barrel,
dependency-list, endpoint-has-layer) на него не переедет.

## isolatedDeclarations — готовность кода

| пакет          | ошибок |
|----------------|--------|
| nestling.app   | 33     |
| operations     | 8      |
| transport.http | 7      |
| container      | 1      |
| common.misc    | 0      |

Распределение по app: TS9010 × 22, TS9013 × 7, TS9038 × 2, TS9023 × 2.

Проверено экспериментально:

- `export const X: Token<T> = makeToken('id')` — дженерик выводится из левой аннотации, ID доволен
- `export type S = typeof CONST` НЕ помогает — нужна аннотация на самой константе
- аннотация нужна на КАЖДОМ экспортируемом значении, не один раз на цепочке
- TS9038 (вычисляемые имена методов класса) лечится только declaration merging +
  реализацией через `static {}` на прототипе; проверено, `.d.ts` сохраняет контракт

Конкретные места:
`src/config/section.ts:221,244` (makeConfig/reloadable),
`src/metrics/kernel-group.ts:47,54` (REQUEST_ATTRIBUTES/CALL_ATTRIBUTES),
`src/root/app.ts:697,750` (CHECK_SEAM/TEST_SEAM, символы объявлены в `src/root/plan.ts:715`).
