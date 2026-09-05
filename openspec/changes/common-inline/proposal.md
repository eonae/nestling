# common-inline

## Why

Скоуп `@common` в npm чужой, а `private: true` не стоит ни на одном из трёх
пакетов `packages/common.*`: первый же `lerna publish` попытается выложить
`@common/misc` под именем, которое репозиторию не принадлежит. Имя `misc`
вдобавок неверно — 419 строк пакета это слой Standard Schema, а не сборная
солянка.

Change второй в серии «Раскладка монорепы»
([ideas.md [2026-09-05]](../../../docs/decisions/ideas.md) «Раскладка
монорепы», roadmap #41). Он снимает блокер публикации и уменьшает
поверхность перед основным слиянием, чтобы #42 `package-consolidation` шёл
по чистому дереву.

## What Changes

- `@common/graphs` (264 строки) растворяется в `@nestling/container`.
  Потребитель у него один: `DAG`, `INode`, `VisitCallback` и `VisitOptions`
  используются только билдером графа контейнера. Пакет `packages/common.graphs`
  удаляется.
- `@common/misc` (419 строк) растворяется в `@nestling/operations`. Пакет
  `packages/common.misc` удаляется, а десять символов, которые из него берут
  (`Schema`, `Infer`, `DomainType`, `StandardSchemaV1`, `validateSync`,
  `assertStandardSchema`, `SchemaValidationError`, `SchemaIssue`,
  `Constructor`, `Optional`), становятся экспортами `@nestling/operations`.
- `@common/static-server` остаётся отдельным пакетом и получает
  `private: true`. Переносить его в `@nestling/viz` не нужно: `viz` бандлит
  его в `dist/cli.js` через esbuild, где external — только `commander`.
- Объявленные, но не импортируемые зависимости уходят из `package.json`:
  `@common/misc` у `app`, `transport`, `transport.cli` и `transport.nats`,
  `@nestling/streams` у `operations`. Недостающие объявления добавляются:
  `@nestling/app` и `@nestling/transport` у `subscriptions`,
  `@nestling/transport.http` у `testing`.
- Список разрешённых импортов в тесте границы `@nestling/operations`
  теряет `@common/misc` и `@nestling/streams`.

## Non-goals

- **Слияние пакетов ядра.** `container`, `operations`, `app`, `pipeline`,
  `config`, `ports` и `transport` остаются отдельными — это #42
  `package-consolidation`.
- **Судьба `@nestling/models` и `@nestling/subscriptions`.** Решено
  оставить их отдельными пакетами; change их не трогает.
- **Переименование `@nestling/*`.** Ни один публикуемый пакет не меняет
  имени.
- **Публикация в реестр.** Change снимает блокер, но сам ничего не
  публикует.

## Capabilities

### New Capabilities

- `packages-layout`: что репозиторий публикует и что нет. Служебный код
  живёт внутри пакета, который им пользуется; пакет, который остаётся
  отдельным по технической причине, помечен `private: true`. Объявленные
  зависимости совпадают с импортируемыми.

### Modified Capabilities

- `contracts-package-boundary`: граница `@nestling/operations` перестаёт
  пропускать `@common/misc` и `@nestling/streams`; слой Standard Schema
  получает дом в самом пакете операций и становится его публичным
  экспортом.

## Impact

- **Код:** `packages/nestling.container/src/graph/*` и `builder/*` —
  импорты `@common/graphs` становятся внутренними; `packages/nestling.operations/src`
  принимает модули `errors.ts`, `types.ts`, `validate.ts`.
  Пять рантайм-потребителей `@common/misc` (`config`, `operations`,
  `pipeline`, `ports`, `subscriptions`) переключаются на новый источник.
- **Новое ребро графа:** `@nestling/config` начинает зависеть от
  `@nestling/operations`. В целевой раскладке оба входят в `@nestling/app`,
  поэтому ребро временное.
- **Конфигурация:** `package.json` десяти пакетов; корневой
  `tsconfig.json` и `jest.config.base.js` — если в них перечислены пути
  `packages/common.*`.
- **Спеки:** `contracts-package-boundary` — список разрешённых импортов.
- **Документация:** `docs/README.md` (таблицы пакетов), README
  `@nestling/container` и `@nestling/operations` (таблицы экспортов),
  `docs/design/composition.md` — если называет `@common/*`.
- **Публичный API `@nestling/*`:** не меняется, кроме новых экспортов
  в `operations` и `container`.
