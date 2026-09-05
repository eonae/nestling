## 1. `@common/graphs` внутрь контейнера

- [ ] 1.1 Перенести `packages/common.graphs/src/dag.class.ts` и `interfaces.ts` в `packages/nestling.container/src/graph/`, включить их в `graph/index.ts`
- [ ] 1.2 Переписать импорты `@common/graphs` в `graph/node.class.ts`, `graph/graph.class.ts` и `builder/container.built.ts` на относительные
- [ ] 1.3 Убрать `@common/graphs` из `dependencies` пакета `@nestling/container`
- [ ] 1.4 Проверить, что `DAG` не появился в барреле пакета: экспорт из `src/index.ts` не добавляется
- [ ] 1.5 `yarn verify` зелёный

## 2. `@common/misc` внутрь операций

- [ ] 2.1 Перенести `errors.ts`, `types.ts`, `validate.ts` и `validate.spec.ts` из `packages/common.misc/src/` в `packages/nestling.operations/src/`
- [ ] 2.2 Реэкспортировать из `packages/nestling.operations/src/index.ts` десять символов: `Schema`, `StandardSchemaV1`, `Infer`, `DomainType`, `validateSync`, `assertStandardSchema`, `SchemaValidationError`, `SchemaIssue`, `Constructor`, `Optional`
- [ ] 2.3 Переписать импорты внутри самого `@nestling/operations` на относительные
- [ ] 2.4 `yarn verify` зелёный

## 3. Потребители переключаются на новый источник

- [ ] 3.1 `@nestling/pipeline`: импорты `@common/misc` → `@nestling/operations` (в `src/` и спеках)
- [ ] 3.2 `@nestling/ports`: то же
- [ ] 3.3 `@nestling/config`: то же; добавить `@nestling/operations` в `dependencies`
- [ ] 3.4 `@nestling/subscriptions`: `StandardSchemaV1` в `src/` — прямо из `@standard-schema/spec` (D4); `Constructor` в спеках — из `@nestling/operations`
- [ ] 3.5 `@nestling/transport.http`: импорт `Schema` в спеке → `@nestling/operations`
- [ ] 3.6 Проверить, что импортов `@common/misc` в репозитории не осталось
- [ ] 3.7 `yarn verify` зелёный

## 4. Удаление пакетов и карта jest

- [ ] 4.1 Удалить каталоги `packages/common.graphs` и `packages/common.misc` целиком, вместе с `dist`
- [ ] 4.2 Проверить, что строка `^@common/(.*)$` в `jest.config.base.js` остаётся: `@common/static-server` ею пользуется
- [ ] 4.3 `yarn clear && yarn verify` зелёный

## 5. `@common/static-server` перестаёт публиковаться

- [ ] 5.1 Добавить `"private": true` в `packages/common.static-server/package.json`
- [ ] 5.2 Проверить, что `yarn workspace @nestling/viz build` собирает `dist/cli.js` как прежде
- [ ] 5.3 Проверить `lerna publish --dry-run`: пакетов скоупа `@common` в списке нет

## 6. Зависимости совпадают с импортами

- [ ] 6.1 Убрать `@common/misc` из `dependencies` у `app`, `transport`, `transport.cli`, `transport.nats`
- [ ] 6.2 Убрать `@nestling/streams` из `dependencies` у `operations`
- [ ] 6.3 Добавить `@nestling/app` в `dependencies` у `subscriptions`
- [ ] 6.4 Проверить, что `@nestling/transport.http` у `testing` остаётся в `devDependencies`: единственный импорт — из `overrides.type-test.ts`, который после раздела 7 не попадает в `dist`
- [ ] 6.5 Сверить остальные пакеты: объявленное множество равно импортируемому вне спеков

## 7. Сборка не выносит тестовый код наружу

- [ ] 7.1 Добавить `src/**/*.type-test.ts` и `src/**/__fixtures__/**` в `exclude` шаблона `tsconfig.build.json`; применить ко всем пакетам, которые собирает tsc
- [ ] 7.2 Пересобрать и убедиться, что из `packages/nestling.testing/dist` пропали `overrides.type-test.*`, `stub.type-test.*` и `__fixtures__`, а из `packages/nestling.subscriptions/dist` — `__fixtures__`
- [ ] 7.3 Проверить, что ни один файл в `dist` любого пакета не импортирует `@nestling/transport.http` или `zod`, объявленные только в `devDependencies`
- [ ] 7.4 `yarn clear && yarn verify` зелёный

## 8. Тест границы операций

- [ ] 8.1 Убрать `@common/misc` и `@nestling/streams` из `ALLOW` в `packages/nestling.operations/src/boundary.spec.ts`; оставить `@nestling/container/tokens` и `@standard-schema/spec`
- [ ] 8.2 Обновить комментарий над `ALLOW`: слой Standard Schema теперь внутри пакета
- [ ] 8.3 Тест границы зелёный

## 9. Документация

- [ ] 9.1 README `@nestling/operations`: таблица экспортов пополняется слоем Standard Schema
- [ ] 9.2 README `@nestling/container`: упоминание `@common/graphs` убрать, если есть
- [ ] 9.3 `docs/README.md`: таблицы пакетов сверить с фактическим составом `packages/`
- [ ] 9.4 `docs/design/composition.md` и прочие доки: упоминаний `@common/graphs` и `@common/misc` не остаётся
- [ ] 9.5 Запись в `docs/decisions/archlog.md` после архивации change'а; статус строки 41 в `roadmap.md`

## 10. Definition of Done

- [ ] 10.1 Все задачи выше отмечены
- [ ] 10.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` + `type-budget` по всем пакетам)
- [ ] 10.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 10.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [ ] 10.5 `yarn docs:audit` → 0 ERROR
- [ ] 10.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с обновлённой датой в плашке «сверено с кодом» — либо зафиксировано, что примеры и главы не затронуты (публичный API не менялся)
- [ ] 10.7 Коммиты осмысленные, ветка запушена
