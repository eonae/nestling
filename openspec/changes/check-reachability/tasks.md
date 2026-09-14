## 1. Природа шины — данное объявления

- [ ] 1.1 Добавить обязательное поле `remote: boolean` в `BusDeclaration`
  (`packages/nestling.app/src/transport/declaration.ts`) с JSDoc по образцу
  `capabilities`: данное объявления, потому что читает его фаза BUILD
- [ ] 1.2 Провести поле через перегрузку `transportValue(token, instance, { bus: true, remote })`
  и через `makeTransportDeclaration`
- [ ] 1.3 Объявить `remote: true` в `nats()`
  (`packages/nestling.transport.nats/src/transport.ts`)
- [ ] 1.4 Сузить возврат `resolveIntercom` в `packages/nestling.app/src/root/plan.ts`
  до `BusDeclaration`, чтобы корень читал признак без приведения типа

## 2. Признак приходит в kernel-модуль портов

- [ ] 2.1 Добавить опцию `remote` в `PortsKernelOptions` рядом с
  `rootSuppliesBus` и объяснить в JSDoc, чем два признака отличаются
- [ ] 2.2 Передать `spec.intercom?.remote === true` из `BuiltApp` в
  `portsKernel({ … })` (`packages/nestling.app/src/root/app.ts`)
- [ ] 2.3 Убрать `MessageBus$` из `invokerDeps` и удалить `isRemote`:
  `bindsRemote` получает природу шины из опций kernel-модуля

## 3. Проверки переезжают в рецепт семейства

- [ ] 3.1 Поднять `requireOperation`, проверку вида операции и
  `assertReachable` из тел `buildPort`/`buildEmitter` в тела рецептов
  `familyProvider(PortFamily, …)` и `familyProvider(EmitterFamily, …)`,
  сохранив порядок отказов
- [ ] 3.2 Оставить в фабриках только построение вызывателя: `patterns` и
  решение `bindsRemote` считаются один раз, там же где сейчас
- [ ] 3.3 Переписать комментарии, ссылающиеся на прежнюю фазу: шапка
  `bindsRemote` (пункт 2) и комментарий про «решение принимается при
  создании узла»

## 4. Тесты

- [ ] 4.1 `packages/nestling.app/src/ports/kernel.spec.ts`: отказ приходит на
  BUILD — до `run()`, текстом прежней формы
- [ ] 4.2 `packages/nestling.app/src/root/check.spec.ts`: `check()` падает на
  недостижимой операции; отчёта с `implemented: false, called: true` без
  интеркома не существует
- [ ] 4.3 `packages/nestling.app/src/root/ports.spec.ts`: вызов без местного
  владельца при назначенном интеркоме проходит `check()` и биндится remote
- [ ] 4.4 `packages/nestling.testing/src/topologies.spec.ts`: топология без
  владельца попадает в список несобравшихся матрицы
- [ ] 4.5 `packages/nestling.testing/src/stub.spec.ts`: стаб снимает проверку —
  обновить комментарий про «первое действие фабрики» на рецепт семейства
- [ ] 4.6 Проверки типов: bus-объявление без `remote` не компилируется
  (`*.type-test.ts` пакета `@nestlingjs/app`)

## 5. Признак уходит у экземпляра

- [ ] 5.1 Удалить `remote` из `IMessageBus`
  (`packages/nestling.app/src/ports/bus.ts`), оставив `durable`
- [ ] 5.2 Удалить `remote` у `InProcessBus` и у `NatsBus`
- [ ] 5.3 Прогнать `yarn verify:fresh` и убедиться, что ни один пакет не
  читает признак у экземпляра

## 6. Документация

- [ ] 6.1 `docs/design/transports.md` и его английская пара: строка о поле
  `remote` объявления шины — рядом с правилом про `capabilities`
- [ ] 6.2 README пакетов `@nestlingjs/app`, `@nestlingjs/transport.nats`,
  `@nestlingjs/testing` — включая плашки статуса
- [ ] 6.3 Пересверить главы `docs/guide/18-testing-features.md`,
  `19-select.md`, `20-split.md` и их английские пары: фаза отказа названа
  верно, дата в плашке «сверено с кодом» обновлена
- [ ] 6.4 Поправить Purpose спек `message-bus` и `nats-transport` при
  переносе дельт: `remote` перестал быть способностью экземпляра
- [ ] 6.5 Прогнать `node .claude/skills/docs-style/scripts/lint.mjs` по
  изменённым текстам — 0 запрещённых слов

## 7. Definition of Done

- [ ] 7.1 Все задачи выше отмечены
- [ ] 7.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` +
  `type-budget` по всем пакетам)
- [ ] 7.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 7.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`;
  запись `ideas.md [2026-09-14]` «Разбор отчёта об обновлении до 0.3.0»,
  пункт 5, несёт пометку «РЕАЛИЗОВАНО» с тем, что вышло целиком, что уехало
  дальше и чем реализация уточнила решение
- [ ] 7.5 `yarn docs:audit` — 0 ERROR
- [ ] 7.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с
  обновлённой датой в плашке «сверено с кодом»
- [ ] 7.7 Коммиты осмысленные, `main` не тронут: слияние делает Merger после
  `/opsx:archive`
