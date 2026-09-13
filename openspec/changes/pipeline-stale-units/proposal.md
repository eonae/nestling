## Why

`withIdentity`, `withPermissions` и `withRequestLogging`
(`packages/nestling.app/src/pipeline/middlewares/`) остались от домодельной
эпохи `pipeline`: `withIdentity`/`withPermissions` отказывают голым
`throw` вместо `return Fail` по модели `.pre(unit, { errors })`
(`layer-fails`, roadmap #34); `withRequestLogging` не экспортируется из
`src/index.ts` вовсе. Проверка импортов показала: ни один пример,
пакет или гайд их не использует — только собственные спеки, три
type-test фикстуры `@nestlingjs/app` и иллюстративные примеры в
`docs/design/pipeline.md`, `docs/design/testing.md`,
`packages/nestling.app/src/pipeline/core/TYPE-TESTS.md` и в двух
спеках openspec (`kernel-logger`, `pipeline-phase-model`,
`packages-layout`). Решение зафиксировано записью
[ideas.md [2026-09-12]](../../decisions/ideas.md) «Разбор обзоров d/10 и
d/13», п. 6: «выбор — в propose, после проверки, кто их импортирует».

## What Changes

- Удалить `withIdentity`, `withPermissions`, `withRequestLogging` и их
  спеки из `packages/nestling.app/src/pipeline/middlewares/`.
  **BREAKING**: три имени уходят из публичного экспорта
  `@nestlingjs/app`.
- Переписать три type-test фикстуры (`compose-wrong-order.ts`,
  `compose-arity3-inner.ts`, `pre-requires-missing.ts`), которые сейчас
  используют `withIdentity`/`withPermissions` как учебный пример
  двухшаговой зависимости pre-юнитов, на локальные инлайн-юниты с тем же
  типовым эффектом (не публичный API).
- Обновить иллюстративные примеры в `docs/design/pipeline.md`,
  `docs/en/design/pipeline.md`, `docs/design/testing.md`,
  `docs/en/design/testing.md`,
  `packages/nestling.app/src/pipeline/core/TYPE-TESTS.md`, README
  пакета (`packages/nestling.app/README.md` и `README.ru.md`) — убрать
  три имени из списка публичных экспортов.
- Не заводить замену: аутентификация — предмет отдельного change'а
  `auth-layer` (roadmap #78, ещё без дизайна), который введёт
  типизированный `Caller` и не будет опираться на текущие
  `withIdentity`/`withPermissions`.

## Capabilities

### New Capabilities

_(нет)_

### Modified Capabilities

- `kernel-logger`: требование «`withRequestLogging` принимает `Logger`
  ядра» снимается целиком — юнит удалён
- `pipeline-phase-model`: сценарий «Сборка слоя из фаз» ссылается на
  `withIdentity(auth)` в примере композиции — пример меняется на юнит,
  остающийся в публичном экспорте
- `packages-layout`: сценарий «У имени появился читатель» иллюстрирует
  правило гипотетическим импортом `withRequestLogging` — после удаления
  юнита нужен другой пример имени без читателя

## Impact

- `packages/nestling.app/src/pipeline/middlewares/` — три файла юнитов и
  их спеки удалены целиком
- `packages/nestling.app/src/index.ts` — три экспорта убраны (у
  `withRequestLogging` экспорта и так не было)
- `packages/nestling.app/type-tests/fixtures/` — три фикстуры переписаны
  на инлайн-юниты
- `packages/nestling.app/README.md`, `README.ru.md` — список экспортов
- `docs/design/pipeline.md`, `docs/en/design/pipeline.md`,
  `docs/design/testing.md`, `docs/en/design/testing.md`,
  `packages/nestling.app/src/pipeline/core/TYPE-TESTS.md` — примеры
- `openspec/specs/kernel-logger/spec.md`,
  `openspec/specs/pipeline-phase-model/spec.md`,
  `openspec/specs/packages-layout/spec.md` — дельта-спеки
- Зависимостей от других пакетов нет: три юнита нигде за пределами
  `@nestlingjs/app` не импортировались
