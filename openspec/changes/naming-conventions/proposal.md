## Why

Имя значения не называет его вид. В `examples/microservice` плагин
документации назван `appOpenapi`, в `examples/modular-app` плагины приёма и
отправки — `appInbox` и `appOutbox`. Префикс `app` не значит ничего: он
появился, чтобы разойтись с фабрикой пакета, которая заняла существительное
(`openapi()`, `inbox()`, `outbox()`). Слой наблюдаемости назван
существительным `observability` и занимает имя понятия, хотя соседние слои —
причастия `authed` и `tracked`. Двухпозиционный переключатель `Docs` в
`Docs.when(appOpenapi)` читается хуже, чем условие.

Запись [ideas.md [2026-09-13]](../../../docs/decisions/ideas.md) «Именование:
суффиксы `Plugin` и `Layer`, переключатели предикатом» закрывала это двумя
суффиксами. Решение пересмотрено 2026-09-14: суффиксы отменены. Вид значения
называет часть речи — плагин существительным, слой причастием, — а
существительное освобождает префикс `make` у фабрики плагина. Заодно
решается [deferred.md [2026-09-13]](../../../docs/decisions/deferred.md)
«Фабрики пакетов: `make*` или голые существительные»: его триггером и был
занятый идентификатор.

## What Changes

- **BREAKING**: фабрика, возвращающая плагин, называется `make*`.
  `openapi()` → `makeOpenapi()`, `inbox()` → `makeInbox()`, `outbox()` →
  `makeOutbox()`, `subscriptions()` → `makeSubscriptions()`, `drizzlePg()` →
  `makeDrizzlePg()`, `pgOutboxStore()` → `makePgOutboxStore()`,
  `pgInboxStore()` → `makePgInboxStore()`, `httpProbes()` →
  `makeHttpProbes()`. Граница проходит по виду результата: фабрика
  транспорта и сервера остаётся существительным — `http()`, `nats()`,
  `mcp()`, `cli()`, `server()`.
- **BREAKING**: экземпляр плагина называется существительным без префикса и
  без суффикса: `openapi`, `inbox`, `outbox`, `subscriptions`, `db`, `ops`.
  Префикс `app` исчезает из примеров, гайдов и сниппетов скилла агента.
- **BREAKING**: слой называется причастием. Слой наблюдаемости —
  `traced` вместо `observability`; слой транзакции без проверки Bearer-токена —
  `signed` вместо `observed`; базовый слой `modular-app` — `traced` вместо
  `base`. `authed`, `transactional`, `tracked` и `outboxed` остаются:
  правило уже описывает их.
- Двухпозиционный переключатель называется предикатом: `DocsEnabled`,
  `AuditEnabled`, `DebugEnabled`, `MetricsEnabled`. Строковое имя
  (`'docs'`, `'audit'`) не меняется.
- `docs/conventions.md` и английская пара переписывают разделы «Плагины» и
  «Пайплайн» и получают правило о фабриках. Раздел «Переключатели»
  остаётся: предикаты в нём уже записаны.
- Журналы: запись ideas [2026-09-13] помечается superseded новой записью
  [2026-09-14]; запись deferred [2026-09-13] «Фабрики пакетов» получает
  пометку о сработавшем триггере с принятым решением.

## Non-goals

- Правило линтера для имён. Механическая проверка имён экспортов — change
  `eslint-rules` (#96): у него уже есть два правила, и третье пишется там
  же, а не здесь.
- Фабрики транспортов и `server()`. Имя `server()` выбрано change'ом
  `servers-implicit` (#88) сутки назад, а транспорт живёт инлайном в
  `transports:` и существительного под экземпляр не занимает.
- `pinoLogger()` и `makeClient()`. Первая возвращает логгер, вторая уже
  названа по правилу; вид результата у них не плагин.
- Имена endpoint'ов, операций, схем, отказов, DI-токенов, хендлеров и
  файлов. Эти разделы `conventions.md` не меняются.

## Capabilities

### New Capabilities

Новых спек нет: change переименовывает публичные фабрики, поведение не
меняет.

### Modified Capabilities

- `openapi-document`: плагин документа объявляется `makeOpenapi(options)`.
- `transactional-inbox`: плагин приёма объявляется `makeInbox(options)`.
- `transactional-outbox`: плагин отправки объявляется `makeOutbox(options)`.
- `subscription-registry`: модуль реестра объявляется
  `makeSubscriptions(options)`; слой `tracked` имя сохраняет.
- `database-connections`: соединение объявляется `makeDrizzlePg(options)`.
- `sql-outbox-store`: хранилища объявляются `makePgOutboxStore(db)` и
  `makePgInboxStore(db)`.
- `http-probes`: плагин проб объявляется `makeHttpProbes(options)`.

## Impact

- Пакеты: `@nestlingjs/openapi`, `@nestlingjs/inbox`, `@nestlingjs/outbox`,
  `@nestlingjs/subscriptions`, `@nestlingjs/drizzle.pg`,
  `@nestlingjs/transport.http` — переименованные экспорты, спеки, README
  обоих языков. `@nestlingjs/agent-skill` — сниппеты и справочники скилла.
- Примеры: `microservice`, `modular-app`, `cli` — имена плагинов, слоёв и
  переключателей.
- Документация: `docs/conventions.md`, `docs/design/*`, главы `guide/` и
  рецепты `recipes/` вместе с английскими парами. Журналы `decisions/`
  правятся пометками, `history/` не трогается.
- Публичный API ломается у восьми фабрик. Пользователей нет, обёрток и
  алиасов не остаётся.
