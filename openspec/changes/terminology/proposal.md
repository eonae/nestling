## Why

Три термина словаря Nestling читаются хуже, чем должны: «юнит» — калька,
особенно в форме «pre-юнит»; «член семейства» звучит плохо без слова
«семья» рядом; `assemble` менее привычен, чем `build`. Решение зафиксировано
в [ideas.md [2026-09-13]](../../../docs/decisions/ideas.md) «Термины: шаг,
токен семейства, `build`». Change идёт первым в серии d/15, потому что
каждая следующая строка кода и документации поверх старых имён дорожает:
`assemble` уже стоит в 127 файлах кода и 139 документах, «юнит» — в 75
документах, 69 спеков в `openspec/specs/` называют одно из трёх.

## What Changes

- **BREAKING.** `assemble` становится `build` в публичном API
  `@nestlingjs/app`: `app.build(args)`, `BuildArgs`, `BuiltApp`. Фаза
  жизненного цикла `1 ASSEMBLE` становится `1 BUILD`, вместе с текстами
  отказов «on ASSEMBLE».
- **BREAKING.** `assembleTest` из `@nestlingjs/testing` становится
  `buildTest`.
- **BREAKING.** `assemblePayload` из `@nestlingjs/transport.http`
  становится `buildPayload`: слово `assemble` уходит из публичного API
  целиком, одним словарём.
- **BREAKING.** Идентификаторы `*Unit*` переименовываются в `*Step*`:
  `PreUnitFn` → `PreStepFn`, `FinallyUnitFn` → `FinallyStepFn`,
  `DeferredPreUnitFn` → `DeferredPreStepFn`, `UnitResolver` →
  `StepResolver`, `InboxClaimUnit` → `InboxClaimStep`.
- **BREAKING.** `testUnit`/`TestUnitOptions` из `@nestlingjs/testing`
  становятся `testBundle`/`TestBundleOptions`: функция поднимает фичу или
  плагин, а не шаг пайплайна, и имя берётся из типа параметра `Bundle`.
- Термин «юнит» заменяется на «шаг» (англ. step) в глоссарии обоих языков,
  design-доках, гайдах, README пакетов и скилле агента. «pre-юнит»
  становится «pre-шагом», по-английски `pre-step`. «Юнит» переходит в
  колонку запрещённых синонимов глоссария.
- Термин «член семейства» заменяется на «токен семейства»:
  `Logger$('orders')` и есть DI-токен. Английское member остаётся —
  глоссарий допускает нелитеральную пару.
- Четыре capability переименовываются вслед за словарём:
  `pipeline-unit-forms` → `pipeline-step-forms`, `transport-pipeline-units`
  → `transport-pipeline-steps`, `synchronous-assembly` →
  `synchronous-build`, `assembly-policies` → `build-policies`.
- Русское «сборка» не меняется: меняется имя в коде, не слово в прозе.

## Capabilities

### New Capabilities

Новых нет: change переименовывает словарь, поведение остаётся прежним.

### Modified Capabilities

- `docs-terminology`: «юнит» переходит в запрещённые синонимы, термином
  становится «шаг»; «член семейства» заменяется на «токен семейства»;
  пара для `build` в обоих глоссариях.
- `composition-root`: метод декларации называется `build`, аргумент —
  `BuildArgs`, результат — `BuiltApp`.
- `test-composition-root`: тестовая сборка называется `buildTest`.
- `lifecycle-phases`: вторая фаза называется `1 BUILD`, отказы фазы
  называют её тем же именем.
- `pipeline-step-forms` (был `pipeline-unit-forms`): формы шага пайплайна,
  типы `PreStepFn` и соседи.
- `transport-pipeline-steps` (был `transport-pipeline-units`): штатные шаги
  транспорта.
- `synchronous-build` (был `synchronous-assembly`): сборка синхронна, имя
  фазы и метода новое.
- `build-policies` (был `assembly-policies`): политики проверяются на фазе
  BUILD.
- `token-families`: член семейства называется токеном семейства.

## Non-goals

- **Никакого изменения поведения.** Ни одна проверка, фаза или сигнатура
  не меняет семантики — меняются имена.
- **Никаких алиасов и обёрток.** Старые имена удаляются целиком, без
  deprecated-экспортов: обратной совместимости у проекта нет.
- **Русское слово «сборка» остаётся.** Change не переводит прозу на
  «билд».
- **Остальные переименования серии d/15 не входят.** Суффиксы `Plugin` и
  `Layer` (change 87), `server()` (88), опция `logging` (93) идут своими
  change'ами.
- **Архивы не правятся.** `openspec/changes/archive/` и
  `docs/history/` — журнал: там старые имена остаются как след решения.

## Impact

- **Код.** `@nestlingjs/app` (31 файл с `*Unit*`, 42 с `assemble`),
  `@nestlingjs/testing` (публичные `assembleTest`, `testUnit`),
  `@nestlingjs/transport.http` (`assemblePayload`, штатные шаги),
  `@nestlingjs/inbox` (`InboxClaimUnit`), `@nestlingjs/openapi`,
  `@nestlingjs/subscriptions`, `@nestlingjs/outbox`, `@nestlingjs/mcp`,
  `@nestlingjs/drizzle.pg`, `@nestlingjs/container`,
  `@nestlingjs/transport.cli`, `@nestlingjs/transport.nats`,
  `@nestlingjs/client`, `@nestlingjs/operations`,
  `@nestlingjs/eslint-plugin`, `@nestlingjs/agent-skill`.
- **Примеры.** Все шесть: `app-with-http`, `container`, `simple-cli`,
  `simple-http-server`, `split-nats`, `users-service`.
- **Документация.** `docs/glossary.md` и `docs/en/glossary.md`,
  `docs/design/*`, 22 главы гайда и их английские пары,
  `docs/guarantees.md`, `docs/conventions.md`, `docs/index.md`, README
  пакетов в обеих языковых половинах, словарь линтера
  `.claude/skills/docs-style/scripts/lint.mjs`.
- **Спеки.** `openspec/specs/`: четыре переименованных каталога и
  словарный проход по остальным.
