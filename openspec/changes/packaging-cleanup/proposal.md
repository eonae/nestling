# packaging-cleanup

## Why

Два дефекта упаковки, найденные при разборе графа зависимостей
([ideas.md [2026-09-05]](../../../docs/decisions/ideas.md) «Раскладка
монорепы»).

Первый: сборка выносит наружу тестовый код. Шаблон `tsconfig.build.json`
исключает `*.spec.ts` и `*.test.ts`, но не `*.type-test.ts` и не
`__fixtures__`. В `dist` пакета `@nestling/testing` лежат
`overrides.type-test.js`, `stub.type-test.js` и каталог фикстур, причём
первый импортирует `@nestling/transport.http` и `zod` — обе зависимости
объявлены только в `devDependencies`. У установившего пакет их нет, и
импорт не разрешится. Сейчас это не рвётся лишь потому, что `index.js`
эти файлы не тянет.

Второй: у семи пакетов объявленные зависимости расходятся с
импортируемыми. Лишнее объявление заставляет ставить пакет, который не
нужен; недостающее работает только потому, что пакет оказался в дереве
по другой причине.

Оба дефекта искажают и картину графа: ложное ребро `testing` →
`transport.http` существует только из-за первого.

## What Changes

- Шаблон `tsconfig.build.json` исключает из сборки `*.type-test.ts` и
  `__fixtures__` наравне со спеками. Из `dist` пакета
  `@nestling/testing` уходят `overrides.type-test.*`, `stub.type-test.*`
  и `__fixtures__`, из `dist` пакета `@nestling/subscriptions` —
  `__fixtures__`.
- Лишние объявления уходят из `package.json`: `@common/misc` у `app`,
  `transport`, `transport.cli` и `transport.nats`; `@nestling/streams` у
  `operations`.
- Недостающее объявление добавляется: `@nestling/app` у
  `subscriptions`.
- Список разрешённых импортов в тесте границы `@nestling/operations`
  теряет `@nestling/streams`: пакет его не импортирует.

## Non-goals

- **Судьба скоупа `@common`.** `@common/graphs`, `@common/misc` и
  `@common/static-server` остаются отдельными пакетами под своими
  именами. Публикация в реестр упрётся в чужой скоуп, но вопрос
  публикации решается отдельно и в этот change не входит.
- **Слияние пакетов ядра.** Это #42 `package-consolidation`.
- **Перенос `@nestling/transport.http` в `dependencies` пакета
  `@nestling/testing`.** Единственный импорт живёт в файле проверки
  типов; после исключения этого файла из сборки зависимость остаётся
  тестовой, где ей и место.

## Capabilities

### New Capabilities

- `packages-layout`: что попадает в опубликованный пакет и что нет.
  Сборка выносит только исходники; объявленные зависимости совпадают с
  импортируемыми.

### Modified Capabilities

Нет: границы `@nestling/operations` change не меняет — из списка
разрешённых импортов уходит имя, которого в импортах и не было.

## Impact

- **Конфигурация сборки:** `tsconfig.build.json` пакетов, которые
  собирает tsc.
- **Манифесты:** `package.json` шести пакетов — `app`, `operations`,
  `subscriptions`, `transport`, `transport.cli`, `transport.nats`.
- **Тесты:** `packages/nestling.operations/src/boundary.spec.ts` —
  список `ALLOW`.
- **Содержимое `dist`:** уходят шесть файлов у `@nestling/testing` и
  каталог фикстур у `@nestling/subscriptions`.
- **Публичный API:** не меняется. Ни один экспорт, доступный через
  `index.ts`, не затронут.
- **Документация:** README пакетов и `docs/` не затронуты — раскладка
  пакетов не меняется.
