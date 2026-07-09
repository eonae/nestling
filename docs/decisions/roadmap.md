# Roadmap доработок до целевого состояния

План работ по приведению кода к целевому дизайну из [ideas.md](./ideas.md).
Каждая строка — отдельный OpenSpec change (`openspec/changes/<имя>/`);
статус обновляется по ходу (это живой документ, в отличие от append-only
журнала решений).

Составлен 2026-07-06 по итогам аудита и серии архитектурных сессий;
дополнен 2026-07-08 (changes 8–13) по сессии модульного монолита —
логика в [discussions/05](../history/discussions/05-modular-monolith-features-ports.md).

| # | Change | Суть | Размер | Статус |
|---|---|---|---|---|
| 1 | `transport-hardening` | утечка stack trace в 500-ответах, лимит body, таймауты, 400 вместо 500 для ошибок входа, дренаж `close()` | S | **done** — [архив](../../openspec/changes/archive/2026-07-07-transport-hardening/) |
| 2 | `container-fixes` | module-метаданные функциональных провайдеров, накопление lifecycle-метаданных per-instance, JSDoc `get()` | S | **done** — [архив](../../openspec/changes/archive/2026-07-07-container-fixes/) |
| 3 | `abort-signal` | `meta.signal` (AbortSignal) насквозь: транспорт (дисконнект) + App (shutdown) | S–M | **done** — [архив](../../openspec/changes/archive/2026-07-07-abort-signal/) |
| 4 | `pipeline-v2` | фазы `.pre/.ok/.catch/.after/.finally`, `makePipeline`, слои + `compose`, `TNeeds`, рантайм-тесты ядра | L, breaking | **implemented** — [артефакты](../../openspec/changes/pipeline-v2/), готов к archive |
| 5 | `token-families` | `makeTokenFamily`, `.auto`, `familyProvider`; опционально `strictExports`. **Покрывает и конфиг (`Config(key)`), и on-demand-клиенты (`GrpcClient(server)` + unbound properties)** — см. [discussions/05 §15](../history/discussions/05-modular-monolith-features-ports.md#15) | M | **proposed** — [артефакты](../../openspec/changes/token-families/), готов к apply |
| 6 | `streaming-v2` | `stream` ≠ `events`, item-цепочки на io-декларации, `Topic`, `summary`, SSE | L | не начат |
| 7 | `subscriptions-registry` | пакет реестра подписок поверх signal + finish-хуков (dogfooding публичных примитивов) | M | не начат |
| 8 | `endpoint-discovery` | эндпоинты и транспорты — дискавери из дерева зарегистрированных модулей вместо глобального registry (чинит протечку глобального `Set` при любом импорте). Предпосылка фич | S | **spec-ready** — [d/05 §1](../history/discussions/05-modular-monolith-features-ports.md) |
| 9 | `config-module` | `makeConfig('prefix', schema)` + `from`; источники = объекты `ConfigSource` в одной приватной читалке (env — база, координаты из примордиального env); приватность (инжект только владельцем → ошибка на `build()`); привязка в корне плоским списком `config: [[src, targets]]`; reloadable (`Topic`/`AbortSignal`, живой хэндл); on-demand/unbound + доки из реестра (тег фичи+флаг). Поверх `token-families` (5) | M–L | **spec-ready** — [d/05 §11,§15](../history/discussions/05-modular-monolith-features-ports.md) |
| 10 | `features` | `makeFeature`/`select`/`assemble`; `@OnStart`/go-live (гарантия `dispatch`: `serve(dispatch, signal)` вместо `listen()`); транспорты как провайдеры; capability = DI + fail-fast | L | design — [d/05 §2,§7–§10](../history/discussions/05-modular-monolith-features-ports.md) |
| 11 | `ports` | `makeContract` (request/command/event), `Port`/`Emitter`, `IMessageBus`, `InProcessBus`, dispatch-policy; local/remote-биндинг на сборке (co-located, L3) | L | design — [d/05 §3](../history/discussions/05-modular-monolith-features-ports.md) |
| 12 | `transport.nats` | NATS как inbound+outbound транспорт; queue-groups для реплик; remote-биндинг портов; JetStream для `durable` (split, L4) | M | design — [d/05 §3](../history/discussions/05-modular-monolith-features-ports.md) |
| 13 | `plugins` | cross-cutting: инфра = параметризованные модули (конвенция, нового примитива нет); pipeline-слои + startup policy-check вместо ambient middleware; feature-scoped инфра едет с фичей | S | design — [d/05 §16](../history/discussions/05-modular-monolith-features-ports.md) |

## Порядок и зависимости

```
базовая ветка (pipeline/streaming):
  1 transport-hardening ─┐
  2 container-fixes ─────┼─ независимы, можно сразу
  3 abort-signal ────────┴─→ 6 streaming-v2 ─→ 7 subscriptions-registry
  4 pipeline-v2 ────────────↗
  5 token-families — после 4 (или параллельно)

ветка «модульный монолит» (сессия 2026-07-08):
  8 endpoint-discovery ─┐
                        ├─→ 10 features ─→ 11 ports ─→ 12 transport.nats
  5 token-families ─→ 9 config-module ─┘        │
  4 pipeline-v2 ────────────────────────────────┼─→ 13 plugins
  6 streaming-v2 (Topic) ── переиспользуется 11 (InProcessBus) и 9 (reloadable)
```

Базовая ветка:

- 1 и 2 — быстрые исправления, не зависят от целевого дизайна.
- 3 — маленькая предпосылка для 6 (и полезна сама по себе: чинит вечный
  `close()` на живых соединениях).
- 4 — самый большой и ломающий; см. миграционную сложность в ideas.md.
- 6 требует 3 (signal) и 4 (item-цепочки описаны в терминах новой модели).
- 7 — последний: тест того, что публичных примитивов достаточно.

Ветка «модульный монолит»:

- **8 `endpoint-discovery`** — независим, S; предпосылка для 10 и баг-фикс сам по
  себе. Делаем первым.
- **9 `config-module`** — поверх 5 (token-families); детально спроектирован
  (spec-ready). Может идти параллельно 8/10; нужен `assemble` для полной картины.
- **10 `features`** — после 8 (дискавери) и 9 (конфиг в `assemble`); включает
  `@OnStart`/go-live и транспорты-провайдеры.
- **11 `ports`** — после 10 (биндинг по топологии/`select`) и 4 (endpoints);
  `InProcessBus` переиспользует `Topic` из 6.
- **12 `transport.nats`** — после 11 (remote-биндинг, queue-groups, JetStream).
- **13 `plugins`** — после 10 (feature-scoped инфра) и 4 (pipeline-слои);
  startup policy-check — из отложенного в pipeline-v2.
- Рекомендуемый вход в ветку: **8 → 9 → 10 → 11 → 12**, `13` — параллельно после 10.

## Как работать

Новый change: `/opsx:propose "<имя>: <описание со scope и non-goals>"`,
контекст для агента уже настроен в `openspec/config.yaml`.
Реализация: `/opsx:apply <имя>`. Завершение: `/opsx:archive <имя>`
(вливает дельта-спеки в `openspec/specs/`). После archive — обновить
статус в этой таблице.
