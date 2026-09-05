## 1. Сборка не выносит тестовый код наружу

- [x] 1.1 Добавить `src/**/*.type-test.ts` и `src/**/__fixtures__/**` в `exclude` шаблона `tsconfig.build.json`
- [x] 1.2 Разнести правку по всем пакетам, которые собирает tsc, — набор конфигов у пакетов одинаков по построению
- [x] 1.3 `yarn clear && yarn build`, проверить: в `packages/nestling.testing/dist` нет `overrides.type-test.*`, `stub.type-test.*` и `__fixtures__`
- [x] 1.4 Проверить: в `packages/nestling.subscriptions/dist` нет `__fixtures__`
- [x] 1.5 Проверить, что ни один файл `dist` любого пакета не импортирует пакет из его `devDependencies` (для `testing` это `@nestling/transport.http` и `zod`)
- [x] 1.6 `yarn verify` зелёный

## 2. Лишние объявления уходят из манифестов

- [x] 2.1 Убрать `@common/misc` из `dependencies` пакета `@nestling/app`
- [x] 2.2 Убрать `@common/misc` из `dependencies` пакета `@nestling/transport`
- [x] 2.3 Убрать `@common/misc` из `dependencies` пакета `@nestling/transport.cli`
- [x] 2.4 Убрать `@common/misc` из `dependencies` пакета `@nestling/transport.nats`
- [x] 2.5 Убрать `@nestling/streams` из `dependencies` пакета `@nestling/operations`
- [x] 2.6 `yarn verify` зелёный после каждой правки

## 3. Недостающее объявление добавляется

- [x] 3.1 Добавить `@nestling/app` в `dependencies` пакета `@nestling/subscriptions`
- [x] 3.2 Проверить, что `@nestling/transport.http` у `@nestling/testing` остаётся в `devDependencies`: единственный импорт — из `overrides.type-test.ts`, который после раздела 1 в `dist` не попадает
- [x] 3.3 `yarn verify` зелёный

## 4. Сверка манифестов со всеми импортами

- [x] 4.1 Пройти все пакеты: множество объявленных внутренних зависимостей равно множеству импортируемых в `src/` вне `*.spec.ts`, `*.test.ts`, `*.type-test.ts` и `__fixtures__`
- [x] 4.2 Расхождений не осталось ни в одну сторону
- [x] 4.3 Сверка нашла восьмое расхождение: `@common/misc` у `@nestling/transport.http` импортируется только из `transport.integration.spec.ts` — объявление переехало в `devDependencies`
- [x] 4.4 Сверка нашла девятое: `zod` у `@nestling/transport.nats` импортируется из `src/config.ts` как значение, а объявлен был в `devDependencies` — объявление переехало в `dependencies`
- [x] 4.5 Та же сверка по `examples/*`: `@nestling/transport` у `@examples/split-nats` не импортируется и объявление убрано, у `@examples/app-with-http` импортируется только из `e2e/helpers/create-test-app.ts` и объявление переехало в `devDependencies`

## 5. Тест границы операций

- [x] 5.1 Убрать `@nestling/streams` из `ALLOW` в `packages/nestling.operations/src/boundary.spec.ts`
- [x] 5.2 Тест границы зелёный

## 6. Definition of Done

- [ ] 6.1 Все задачи выше отмечены
- [ ] 6.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` + `type-budget` по всем пакетам)
- [x] 6.3 README `@nestling/subscriptions` обновлён: он утверждал, что `@nestling/app` в пакете нет, хотя `src/module.ts` берёт оттуда `makePlugin`. Остальные README не затронуты: раскладка и экспорты не менялись
- [ ] 6.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [ ] 6.5 `yarn docs:audit` → 0 ERROR
- [x] 6.6 Главы гайда не затронуты: публичный API не менялся. В `examples/*` правились только манифесты (задача 4.5), код примеров нетронут
- [ ] 6.7 Коммиты осмысленные, ветка запушена
