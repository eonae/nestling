# http-transport-boundary

## Why

Запись `docs/decisions/ideas.md` [2026-09-04] «Граница `@nestling/transport.http`:
перечень обещаний и satellite-транспорт поверх тех же байтовых частей»
фиксирует решение: транспорт держит байтовый уровень HTTP сам, поверх
`node:http`, `find-my-way` и `busboy`, а не отдаёт его Express или Fastify.
Решение проверяется двумя фактами. Первый: перечень обещаний транспорта
(HTTP/1.1, формы io, лимиты, таймауты) назван рядом с кодом, а не только в
design-доке. Второй: байтовые части пакета действительно доступны снаружи —
альтернативный HTTP-сервер поверх них пишется, не трогая пакет. Оба факта
сейчас не проверены: `transports.md §4.1` описывает целевое состояние, но
README пакета его не повторяет, а экспорт `index.ts` никто не сверял со
списком байтовых частей и не пробовал собрать поверх него satellite-транспорт.

## What Changes

- Аудит экспортов `packages/nestling.transport.http/src/index.ts` против
  списка байтовых частей из `transports.md §4.1`: разбор тела по форме io,
  чтение bind-карты, таблица статусов, кадрирование NDJSON и SSE. Найденный
  пробел (`HTTP_CAPABILITIES` — приватная константа способностей в
  `transport.ts`) закрывается экспортом.
- Минимальный satellite-транспорт в спеке пакета: `ITransport` поверх
  `node:http`-сервера, созданного независимо от `HttpTransport`, собранный
  только из публичных экспортов пакета. Обслуживает endpoint `GET` и
  endpoint `POST`; пакет и ядро не меняются под него.
- README пакета получает полный раздел «Границы пакета»: перечень обещаний
  и исключений из `transports.md §4.1`, одна-две строки на пункт.
- Бенчмарк `@nestling/transport.http` относительно Fastify на одинаковой
  паре endpoint'ов (`GET` с JSON-ответом, `POST` с телом, проверенным
  zod-схемой на обеих сторонах): скрипт в `scripts/bench/`, `fastify` и
  `autocannon` — devDependencies корня, не пакета. Запуск вручную, вне
  `yarn verify`. Результат и условия замера дополняют запись ideas.md
  [2026-09-04] новым абзацем.
- Новая capability `http-transport-boundary`: обещания пакета, публичность
  байтовых частей и гарантия satellite-транспорта — как проверяемые
  требования.

## Capabilities

### New Capabilities
- `http-transport-boundary`: перечень обещаний `@nestling/transport.http`
  (HTTP/1.1, формы io, `rawBody`, лимиты тела и файлов, таймауты
  `node:http`, дренаж соединений, адрес из конфиг-секции) и исключений
  (HTTP/2, WebSocket, TLS-терминация); публичность байтовых частей пакета
  как условие, при котором satellite-транспорт поверх стороннего
  HTTP-сервера пишется без правок пакета.

### Modified Capabilities

Нет: поведение существующих требований (`transport-providers`,
`transport-form-capabilities`, `http-transport-limits`,
`http-streaming-framing`) не меняется. Change расширяет состав публичных
экспортов пакета и документацию, а не проверяемое ими поведение.

## Impact

- `packages/nestling.transport.http/src/index.ts`, `transport.ts` — новый
  экспорт способностей транспорта.
- `packages/nestling.transport.http/src/satellite.integration.spec.ts` —
  новый спек с satellite-транспортом.
- `packages/nestling.transport.http/README.md` — раздел «Границы пакета»,
  правка таблицы экспортов.
- `scripts/bench/` — новый скрипт бенчмарка; `package.json` корня —
  `fastify` и `autocannon` в devDependencies, новый npm-скрипт запуска.
- `docs/decisions/ideas.md` — дополнение записи [2026-09-04] абзацем с
  результатом бенчмарка.
- `openspec/specs/http-transport-boundary/` — новая спека при архивации
  change'а.

## Non-goals

- HTTP/2, WebSocket, TLS-терминация, сжатие и CORS как новые возможности
  транспорта.
- Замена `node:http` под капотом `HttpTransport`.
- Satellite-транспорт как отдельный публикуемый пакет: в этом change'е —
  только проба в спеке пакета, без зависимости на Fastify в самом
  `transport.http`.
- Бенчмарк как порог сборки: результат не блокирует `yarn verify` и не
  проверяется тестом.
- Правка `docs/design/transports.md`: раздел 4.1 уже фиксирует целевое
  состояние, change доводит до него код, README и спеки.
