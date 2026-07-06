# transport-hardening — design

## Context

Текущее состояние (сверено с кодом 2026-07-07):

- `Pipeline.errorToResponse` (`nestling.pipeline/src/core/pipeline.ts:200-237`) при
  не-`Fail` ошибке кладёт в тело ответа `error.message` и `error.stack` под
  захардкоженным `const isDevelopment = true`.
- Второе место утечки: верхний `catch` в `HttpTransport.handle`
  (`transport.ts:300-310`) отдаёт `error.message` в JSON 500 — для любых ошибок
  парсинга/роутинга/pipeline.
- `parseJson`/`parseRaw`/text-ветка читают тело в память без лимита; multipart
  (busboy) — без `limits`; NDJSON-стрим — без ограничения длины строки.
- `HttpTransportOptions = { port?, host? }`; таймауты `node:http` не настраиваются.
- `close()` — голый `server.close()`: ждёт keep-alive соединения бесконечно.
- Ошибки `JSON.parse` и конфликта ключей `mergePayload` (голый `Error`) улетают
  в общий catch → 500 вместо 400.

Ограничение: сохранить контракты endpoint'ов и `ResponseContext` неизменными;
pipeline v2 (см. `docs/decisions/ideas.md`) сюда не тащить.

## Goals / Non-Goals

**Goals:**

- Утечка внутренних деталей ошибок закрыта по умолчанию в обоих местах.
- Лимиты на входные байты (buffered body, файл в multipart, строка NDJSON).
- Конфигурируемые таймауты сервера; graceful close с дренажом.
- Правильная классификация ошибок входа: 400/413 вместо 500.
- Транспорт получает интеграционные тесты на реальном `node:http`.

**Non-Goals:** CORS, rate limiting, сжатие, проверка `Content-Type`,
per-route таймауты, изменения CLI-транспорта сверх прокидывания флага.

## Decisions

**D1. Политика раскрытия ошибок — опция вызова `executeWithHandler`, а не поле Pipeline.**
`executeWithHandler(handler, ctx, opts?: { exposeErrorDetails?: boolean })`,
дефолт `false`: для не-`Fail` ошибок тело = `{ error: 'Internal server error' }`,
без message и stack. `Fail` не меняется — его message/details автор бросил
осознанно.
*Почему не поле Pipeline*: pipeline — переиспользуемая константа, общая для
многих endpoint'ов и транспортов; политика раскрытия — свойство окружения
(транспорт/приложение), а не цепочки обработки. *Почему не env-переменная*:
неявность против философии проекта.
`HttpTransport` берёт значение из `HttpTransportOptions.exposeErrorDetails`
(дефолт `false`), `CliTransport` передаёт `true` (локальный инструмент, stack
в терминале полезен). Верхний catch транспорта использует ту же политику.

**D2. Типизированные ошибки входа в `transport.http` + маппинг в catch.**
Новые классы: `JsonParseError`, `PayloadConflictError` (замена голого `Error`
в `merge.ts`), `PayloadTooLargeError`, `ChunkTooLargeError`. Верхний catch
`handle()` маппит: `JsonParseError | PayloadConflictError |
SchemaValidationError → 400`, `PayloadTooLargeError | ChunkTooLargeError → 413`,
остальное → 500 (по D1). Статусы ставятся транспортом напрямую на `res` —
словарь `ProcessingStatus` pipeline не расширяем (413/парсинг — домен
транспорта, до pipeline дело не доходит).

**D3. Лимиты — общий `readBody(req, maxBytes)` + limits busboy + лимит строки NDJSON.**
`maxBodySize` (дефолт 1 MiB) применяется: в `parseJson`/`parseRaw`/text через
общий помощник с ранним прерыванием (считаем байты по мере чтения, не после);
в multipart — `busboy({ limits: { fileSize: maxBodySize } })` + обработка
события `limit`; в NDJSON — максимальная длина строки (`maxBodySize`,
применяется к одной строке). Превышение → `PayloadTooLargeError` /
`ChunkTooLargeError`. `0` отключает лимит явно.
*Альтернатива отвергнута*: один глобальный счётчик на всё соединение — ломает
легитимные длинные стримы, у которых нет верхней границы by design.

**D4. Таймауты — прокидывание на `node:http` с дефолтами Node.**
`HttpTransportOptions` получает `requestTimeout?`, `headersTimeout?`,
`keepAliveTimeout?` — присваиваются серверу после `createServer`. Дефолты не
переопределяем (у Node они разумные: 300s/60s/5s) — ценность в явной
конфигурируемости. Известное ограничение: `requestTimeout` глобален для
сервера; долгие streaming-endpoint'ы требуют его увеличения/отключения целиком
(per-route таймауты — материал pipeline v2, см. Open Questions).

**D5. Graceful close через `closeIdleConnections`/`closeAllConnections`.**
`close({ timeout } = { timeout: closeTimeout })`: `server.close()` (перестаём
принимать) → сразу `closeIdleConnections()` (убираем висящие keep-alive) →
ждём завершения in-flight до `closeTimeout` (дефолт 10s) →
`closeAllConnections()` для остатка. Node ≥ 18.2, уже в engine-диапазоне.
*Альтернатива отвергнута*: ручной трекинг сокетов через событие `connection` —
переизобретение стандартного API.

## Risks / Trade-offs

- [Смена формата тела 500-ответа сломает тесты/клиентов, полагавшихся на
  `error.message`] → это и есть цель; в e2e примеров проверить и поправить
  ожидания; отметить в decisions-логе.
- [Лимит 1 MiB по умолчанию отсечёт легитимные большие JSON у ранних
  пользователей] → значение конфигурируемо, ошибка 413 с внятным телом
  подсказывает `maxBodySize`.
- [`fileSize`-limit busboy срабатывает per-file, а не на сумму] → осознанно:
  сумма ограничивается косвенно; честную сумму делать в отдельном change,
  если понадобится.
- [`closeAllConnections` рубит активные SSE/NDJSON при shutdown] → это
  ожидаемая семантика таймаута дренажа; корректное завершение подписок —
  задача `abort-signal` change (meta.signal), не этого.

## Migration Plan

Изменения обратно совместимы по API (новые опции — опциональные). Поведенческая
миграция: кто хочет прежние подробные 500 в dev — включает
`exposeErrorDetails: true` в опциях транспорта. Откат — revert коммита.

## Open Questions

- Нужен ли `App`-уровневый дефолт `exposeErrorDetails` (прокидывание в все
  транспорты разом)? Пока нет — опция per-transport; пересмотреть при
  появлении конфига App.
- Per-route таймауты и лимиты — кандидат в опции endpoint'а в pipeline v2.
