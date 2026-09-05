## 1. Аудит и экспорт байтовых частей

- [x] 1.1 Свести список текущих экспортов `index.ts` (`parser.ts`,
      `adapter.ts`, `binding.ts`, `errors.ts`, `router.ts`, `token.ts`,
      `config.ts`) с перечнем байтовых частей `transports.md §4.1`: разбор
      тела по форме io, чтение bind-карты, таблица статусов, кадрирование
      NDJSON и SSE
- [x] 1.2 Экспортировать значение способностей HTTP-транспорта из
      `index.ts`; `HttpTransport.capabilities` использует тот же экспорт
      вместо приватного литерала в `transport.ts`
- [x] 1.3 Поправить таблицу «Экспорты» README пакета: убрать
      несуществующий `ChunkTooLargeError`, добавить новый экспорт
      способностей

## 2. Satellite-транспорт: доказательство границы

- [x] 2.1 Написать `packages/nestling.transport.http/src/satellite.integration.spec.ts`:
      независимый `node:http`-сервер (не `HttpTransport`), `ITransport`
      поверх него, собранный только из публичных экспортов пакета
- [x] 2.2 Обслужить через satellite endpoint `GET` с JSON-ответом и
      endpoint `POST` с телом; сверить ответы с ответами того же
      `dispatch` через `HttpTransport`
- [x] 2.3 Если сборка satellite упирается в неэкспортированную часть —
      добавить экспорт в `index.ts`, а не обходной код в тесте
- [x] 2.4 `yarn test` пакета `@nestling/transport.http` зелёный с новым
      спеком

## 3. README «Границы пакета»

- [x] 3.1 Переписать раздел «Границы пакета» README: обещания (HTTP/1.1,
      JSON/NDJSON/SSE/multipart, `rawBody`, лимиты тела и файлов, таймауты
      `node:http`, дренаж, адрес из конфиг-секции) и исключения (HTTP/2,
      WebSocket, TLS-терминация) — одна-две строки на пункт, без
      аргументов
- [x] 3.2 Плашка статуса README сверена с фактическим состоянием пакета
- [x] 3.3 Линтер `docs-style` по README пакета — 0 запрещённых слов

## 4. Бенчмарк относительно Fastify

- [x] 4.1 `fastify` и `autocannon` — devDependencies корневого
      `package.json`, не пакета `transport.http`
- [x] 4.2 `scripts/bench/http-vs-fastify.ts`: одинаковая пара endpoint'ов
      на обоих серверах — `GET /users/:id` (JSON-ответ без валидации
      входа), `POST /users` (тело, проверенное zod-схемой на обеих
      сторонах)
- [x] 4.3 Скрипт запуска в `package.json` корня (например `bench:http`),
      вне `yarn verify`
- [x] 4.4 Прогнать бенчмарк локально, зафиксировать условия замера (Node,
      ОС, дата)
- [x] 4.5 Дополнить запись `docs/decisions/ideas.md` [2026-09-04] новым
      абзацем с результатом и условиями замера (append к записи, без
      правки существующего текста)

## 5. Проверка

- [x] 5.1 `yarn verify` зелёный по `@nestling/transport.http` и
      зависящим пакетам
- [x] 5.2 Линтер `docs-style` по изменённым текстам (README пакета) — 0
      запрещённых слов
- [x] 5.3 `yarn docs:audit` — 0 ERROR

## 6. Definition of Done

- [x] 6.1 Все задачи выше отмечены
- [x] 6.2 `yarn verify` зелёный (build + typecheck + lint + test +
      type-budget)
- [x] 6.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 6.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [x] 6.5 `yarn docs:audit` — 0 ERROR
- [x] 6.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены
      с обновлённой датой в плашке «сверено с кодом» (если change их
      коснулся)
- [x] 6.7 Линтер стиля по изменённым текстам — 0 запрещённых слов
- [ ] 6.8 Коммиты осмысленные, ветка запушена
