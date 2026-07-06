# transport-hardening

## Why

Аудит (2026-07-06) выявил, что HTTP-стек небезопасен для любого публичного окружения: захардкоженный `isDevelopment = true` в `packages/nestling.pipeline/src/core/pipeline.ts` отдаёт stack trace и текст внутренних ошибок клиенту в теле каждого 500-ответа, а `parseJson` в `@nestling/transport.http` собирает тело запроса в память без ограничения размера (DoS одним запросом). Это самые дешёвые и срочные исправления из списка доработок — они не зависят от целевого дизайна pipeline v2 (см. `docs/decisions/ideas.md`) и должны выйти раньше него.

## What Changes

- Убрать `const isDevelopment = true` из `errorToResponse` (`nestling.pipeline`): раскрытие деталей внутренних ошибок становится конфигурируемым; **по умолчанию** для `INTERNAL_ERROR` клиенту уходит только generic-сообщение, без stack trace и `error.message`.
- `HttpTransportOptions` расширяется: `maxBodySize` (лимит тела; превышение → `413 Payload Too Large`), `requestTimeout`, `headersTimeout`, `keepAliveTimeout` (прокидываются на `node:http` сервер с безопасными дефолтами).
- Ошибки парсинга JSON и конфликты ключей в `mergePayload(body, query, params)` возвращают `400 Bad Request` (сейчас — `500`).
- `close()` дренирует активные соединения с таймаутом (`closeTimeout`) вместо голого `server.close()`, который ждёт keep-alive соединения бесконечно.
- Тесты на всё перечисленное: юнит для error-ответов, интеграционные для транспорта на реальном `node:http`-сервере.

Не-**BREAKING** для API приложений; поведенчески меняется формат тела 500-ответа (детали больше не утекают) — это осознанное security-исправление.

## Capabilities

### New Capabilities

- `http-transport-limits`: лимиты и таймауты HTTP-транспорта (размер тела, таймауты сервера, дренаж соединений при остановке).
- `error-response-safety`: политика раскрытия деталей ошибок в ответах (generic 500 по умолчанию, конфигурируемое раскрытие для разработки).
- `http-request-validation-errors`: корректные статусы для некорректного входа (битый JSON, конфликты ключей источников payload → 400).

### Modified Capabilities

<!-- существующих спеков в openspec/specs/ пока нет — это первый change -->

## Impact

- `packages/nestling.pipeline/src/core/pipeline.ts` (`errorToResponse`, `executeWithHandler`) — новая опция политики ошибок; способ её прокидывания (параметр executeWithHandler / поле EndpointMeta) решается в design.md.
- `packages/nestling.transport.http/src/transport.ts` — `HttpTransportOptions`, применение таймаутов, дренаж в `close()`, маппинг новых ошибок на 400/413.
- `packages/nestling.transport.http/src/parser.ts` — лимит размера при чтении тела, оборачивание ошибок JSON-парсинга в типизированную ошибку.
- `packages/nestling.transport.http/src/merge.ts` — типизированная ошибка конфликта ключей (сейчас голый `Error`).
- Новые тесты в `nestling.transport.http` (сейчас покрыт только `merge.spec.ts`) и `nestling.pipeline`.
- Зависимости: новых нет.

## Non-goals

- CORS, rate limiting, сжатие, проверка `Content-Type` (отдельные changes при необходимости).
- Pipeline v2 (фазы, слои, `compose`) — отдельный change, см. `docs/decisions/ideas.md`.
- CLI-транспорт: не трогаем (у него нет сетевой поверхности).
- Изменение формата успешных ответов и контрактов endpoint'ов.
