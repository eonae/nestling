# transport-hardening — tasks

## 1. Политика раскрытия ошибок (nestling.pipeline)

- [ ] 1.1 Добавить `ExecuteOptions { exposeErrorDetails?: boolean }` третьим параметром `Pipeline.executeWithHandler`; убрать `const isDevelopment = true` из `errorToResponse`, дефолт — не раскрывать (generic `Internal server error`, без stack)
- [ ] 1.2 Рантайм-тесты `errorToResponse`: Fail сохраняет message/details; не-Fail без опции — generic без stack; с `exposeErrorDetails: true` — message+stack (первые рантайм-тесты `executeWithHandler` — заодно каркас для остальных)

## 2. Типизированные ошибки входа (nestling.transport.http)

- [ ] 2.1 Создать `src/errors.ts`: `JsonParseError`, `PayloadConflictError`, `PayloadTooLargeError`, `ChunkTooLargeError`
- [ ] 2.2 `merge.ts`: бросать `PayloadConflictError` (с именем ключа) вместо голого `Error`; обновить `merge.spec.ts`
- [ ] 2.3 `parser.ts`: оборачивать ошибку `JSON.parse` в `JsonParseError`
- [ ] 2.4 Верхний catch `HttpTransport.handle`: маппинг `JsonParseError | PayloadConflictError | SchemaValidationError → 400`, `PayloadTooLargeError | ChunkTooLargeError → 413`, остальное → 500 c учётом `exposeErrorDetails` (убрать утечку `error.message`)

## 3. Лимиты размера (nestling.transport.http)

- [ ] 3.1 Общий помощник `readBody(req, maxBytes)` с ранним прерыванием; использовать в `parseJson`, `parseRaw`, text-ветке; `maxBodySize` в `HttpTransportOptions` (дефолт 1 MiB, `0` = без лимита)
- [ ] 3.2 Multipart: прокинуть `limits: { fileSize: maxBodySize }` в busboy, обработать событие `limit` → `PayloadTooLargeError`, дренаж остатка
- [ ] 3.3 NDJSON: лимит длины строки в `parseStream` → `ChunkTooLargeError`

## 4. Таймауты и graceful close (nestling.transport.http)

- [ ] 4.1 `HttpTransportOptions`: `requestTimeout?`, `headersTimeout?`, `keepAliveTimeout?`, `closeTimeout?`, `exposeErrorDetails?`; применить таймауты к серверу в `listen()`
- [ ] 4.2 `close()`: `server.close()` + `closeIdleConnections()` сразу, `closeAllConnections()` по истечении `closeTimeout` (дефолт 10s)
- [ ] 4.3 `CliTransport`: передавать `exposeErrorDetails: true` в `executeWithHandler`

## 5. Интеграционные тесты транспорта (реальный node:http)

- [ ] 5.1 Тестовый каркас: поднять `HttpTransport` на эфемерном порту, helper для запросов (`fetch`)
- [ ] 5.2 Тесты error-response-safety: generic 500 без деталей; 500 с деталями при opt-in; `Fail.badRequest` → 400 с details
- [ ] 5.3 Тесты validation-errors: битый JSON → 400 `Invalid JSON body`; конфликт ключей body/query → 400 с именем ключа; невалидный payload в fallback-ветке (без pipeline) → 400
- [ ] 5.4 Тесты limits: JSON больше лимита → 413 (память не растёт — прерывание чтения); `maxBodySize: 0` — без лимита; NDJSON-строка больше лимита → 413
- [ ] 5.5 Тесты timeouts/close: применённые значения на сервере; `close()` с висящим keep-alive завершается быстро; `close()` с зависшим запросом завершается по `closeTimeout`

## 6. Финализация

- [ ] 6.1 Прогнать e2e в `examples.app-with-http` (`e2e/`), поправить ожидания, если они полагались на детали 500-ответов
- [ ] 6.2 Обновить README `nestling.transport.http` (убрать «not production-hardened yet», описать новые опции) и `docs/design/transports.md` (статус-плашку)
- [ ] 6.3 Запись в `docs/decisions/archlog.md`: поведенческое изменение 500-ответов (детали скрыты по умолчанию)
