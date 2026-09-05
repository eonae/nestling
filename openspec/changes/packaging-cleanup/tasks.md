## 1. Сборка не выносит тестовый код наружу

- [ ] 1.1 Добавить `src/**/*.type-test.ts` и `src/**/__fixtures__/**` в `exclude` шаблона `tsconfig.build.json`
- [ ] 1.2 Разнести правку по всем пакетам, которые собирает tsc, — набор конфигов у пакетов одинаков по построению
- [ ] 1.3 `yarn clear && yarn build`, проверить: в `packages/nestling.testing/dist` нет `overrides.type-test.*`, `stub.type-test.*` и `__fixtures__`
- [ ] 1.4 Проверить: в `packages/nestling.subscriptions/dist` нет `__fixtures__`
- [ ] 1.5 Проверить, что ни один файл `dist` любого пакета не импортирует пакет из его `devDependencies` (для `testing` это `@nestling/transport.http` и `zod`)
- [ ] 1.6 `yarn verify` зелёный

## 2. Лишние объявления уходят из манифестов

- [ ] 2.1 Убрать `@common/misc` из `dependencies` пакета `@nestling/app`
- [ ] 2.2 Убрать `@common/misc` из `dependencies` пакета `@nestling/transport`
- [ ] 2.3 Убрать `@common/misc` из `dependencies` пакета `@nestling/transport.cli`
- [ ] 2.4 Убрать `@common/misc` из `dependencies` пакета `@nestling/transport.nats`
- [ ] 2.5 Убрать `@nestling/streams` из `dependencies` пакета `@nestling/operations`
- [ ] 2.6 `yarn verify` зелёный после каждой правки

## 3. Недостающее объявление добавляется

- [ ] 3.1 Добавить `@nestling/app` в `dependencies` пакета `@nestling/subscriptions`
- [ ] 3.2 Проверить, что `@nestling/transport.http` у `@nestling/testing` остаётся в `devDependencies`: единственный импорт — из `overrides.type-test.ts`, который после раздела 1 в `dist` не попадает
- [ ] 3.3 `yarn verify` зелёный

## 4. Сверка манифестов со всеми импортами

- [ ] 4.1 Пройти все пакеты: множество объявленных внутренних зависимостей равно множеству импортируемых в `src/` вне `*.spec.ts`, `*.test.ts`, `*.type-test.ts` и `__fixtures__`
- [ ] 4.2 Расхождений не осталось ни в одну сторону

## 5. Тест границы операций

- [ ] 5.1 Убрать `@nestling/streams` из `ALLOW` в `packages/nestling.operations/src/boundary.spec.ts`
- [ ] 5.2 Тест границы зелёный

## 6. Definition of Done

- [ ] 6.1 Все задачи выше отмечены
- [ ] 6.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` + `type-budget` по всем пакетам)
- [ ] 6.3 README пакетов не затронуты: раскладка и экспорты не менялись — зафиксировать это явно
- [ ] 6.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [ ] 6.5 `yarn docs:audit` → 0 ERROR
- [ ] 6.6 `examples/*` и главы гайда не затронуты: публичный API не менялся — зафиксировать это явно
- [ ] 6.7 Коммиты осмысленные, ветка запушена
