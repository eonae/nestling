# Roadmap доработок до целевого состояния

План работ по приведению кода к целевому дизайну из [ideas.md](./ideas.md).
Каждая строка — отдельный OpenSpec change (`openspec/changes/<имя>/`);
статус обновляется по ходу (это живой документ, в отличие от append-only
журнала решений).

Составлен 2026-07-06 по итогам аудита и серии архитектурных сессий.

| # | Change | Суть | Размер | Статус |
|---|---|---|---|---|
| 1 | `transport-hardening` | утечка stack trace в 500-ответах, лимит body, таймауты, 400 вместо 500 для ошибок входа, дренаж `close()` | S | **proposed** — [артефакты](../../openspec/changes/transport-hardening/), готов к apply |
| 2 | `container-fixes` | module-метаданные функциональных провайдеров, накопление lifecycle-метаданных per-instance, JSDoc `get()` | S | не начат |
| 3 | `abort-signal` | `meta.signal` (AbortSignal) насквозь: транспорт (дисконнект) + App (shutdown) | S–M | не начат |
| 4 | `pipeline-v2` | фазы `.pre/.ok/.catch/.after/.finally`, `makePipeline`, слои + `compose`, `TNeeds`, рантайм-тесты ядра | L, breaking | не начат |
| 5 | `token-families` | `makeTokenFamily`, `.auto`, `familyProvider`; опционально `strictExports` | M | не начат |
| 6 | `streaming-v2` | `stream` ≠ `events`, item-цепочки на io-декларации, `Topic`, `summary`, SSE | L | не начат |
| 7 | `subscriptions-registry` | пакет реестра подписок поверх signal + finish-хуков (dogfooding публичных примитивов) | M | не начат |

## Порядок и зависимости

```
1 transport-hardening ─┐
2 container-fixes ─────┼─ независимы, можно сразу
                       │
3 abort-signal ────────┴─→ 6 streaming-v2 ─→ 7 subscriptions-registry
4 pipeline-v2 ────────────↗
5 token-families — после 4 (или параллельно: контейнер почти не пересекается)
```

- 1 и 2 — быстрые исправления, не зависят от целевого дизайна.
- 3 — маленькая предпосылка для 6 (и полезна сама по себе: чинит вечный
  `close()` на живых соединениях).
- 4 — самый большой и ломающий; см. миграционную сложность в ideas.md
  (словарь `.pre/.ok/...`, `compose`, отказ от `definePipeline().use()`).
- 6 требует 3 (signal) и 4 (item-цепочки описаны в терминах новой модели).
- 7 — последний: тест того, что публичных примитивов достаточно.

## Как работать

Новый change: `/opsx:propose "<имя>: <описание со scope и non-goals>"`,
контекст для агента уже настроен в `openspec/config.yaml`.
Реализация: `/opsx:apply <имя>`. Завершение: `/opsx:archive <имя>`
(вливает дельта-спеки в `openspec/specs/`). После archive — обновить
статус в этой таблице.
