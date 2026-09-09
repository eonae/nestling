# http-probes

## Purpose

`httpProbes()` — плагин `@nestling/transport.http`, отдающий состояние
приложения по HTTP: `GET /healthz` для liveness и `GET /readyz` для
readiness. Плагин ничего не решает сам: хендлеры читают узел ядра `Health$`
и переводят его итог в коды 200 и 503. Обе декларации выведены из-под
пайплайна и политик через `detached` и скрыты из документа OpenAPI через
`doc.hidden` — прикладной слой пробам не нужен. Пакету принадлежат только
адреса и коды ответа.

## Requirements

### Requirement: `httpProbes()` — плагин пакета с двумя endpoint'ами

`@nestling/transport.http` SHALL экспортировать `httpProbes(options?)`,
возвращающий `Plugin` с двумя HTTP-декларациями: `GET /healthz` (liveness) и
`GET /readyz` (readiness). Пути SHALL задаваться опциями `liveness` и
`readiness`; без опций SHALL действовать умолчания.

Хендлеры SHALL читать узел ядра `Health$` и SHALL NOT содержать собственной
логики проверок: итог, кэш и таймаут принадлежат ядру (capability
`health-probes`).

Плагин SHALL NOT регистрировать провайдеров: узел ядра уже в графе.

#### Scenario: Подключение плагина

- **WHEN** корень объявляет `plugins: [httpProbes()]`
- **THEN** приложение обслуживает `GET /healthz` и `GET /readyz`

#### Scenario: Свои пути проб

- **WHEN** объявлено `httpProbes({ liveness: '/live', readiness: '/ready' })`
- **THEN** приложение обслуживает `GET /live` и `GET /ready`, а `/healthz` и
  `/readyz` отвечают 404

### Requirement: Пробы не проходят пайплайн и не попадают в документ

Обе декларации SHALL объявляться без пайплайна, с `detached: '<причина>'` и
`doc: { hidden: '<причина>' }`.

Причина SHALL печататься на старте и SHALL попадать в отчёт `check()` тем же
механизмом, что и у любого detached-endpoint'а (capability
`endpoint-detached-optout`).

#### Scenario: Политика не требует слоя от проб

- **WHEN** приложение объявляет политику «у каждого HTTP-endpoint'а есть слой
  `authed`» и подключает `httpProbes()`
- **THEN** сборка проходит, а отчёт `check()` содержит обе пробы с причиной
  вывода из-под политик

#### Scenario: Проб нет в документе OpenAPI

- **WHEN** приложение с `httpProbes()` строит документ OpenAPI
- **THEN** путей проб в документе нет

### Requirement: Коды ответа проб

`GET /healthz` SHALL отвечать 200 и телом `{ "status": "ok" }` всегда, пока
процесс отвечает.

`GET /readyz` при итоге `ready` SHALL отвечать 200 и телом отчёта. При итоге
`not_ready` SHALL отвечать отказом `service_unavailable:not_ready`, который
транспорт переводит в 503; `details` отказа SHALL нести тот же отчёт.

Отказ SHALL объявляться в `errors:` декларации, поэтому `details` SHALL
отдаваться клиенту независимо от `exposeErrorDetails` (capability
`error-response-safety`).

#### Scenario: Готовое приложение

- **WHEN** приложение в фазе RUN и критичные проверки прошли
- **THEN** `GET /readyz` отвечает 200 и телом
  `{ "status": "ready", "phase": "RUN", "checks": [...] }`

#### Scenario: Дренаж отвечает 503

- **WHEN** приложение получило SIGTERM и перешло в SHUTDOWN
- **THEN** `GET /readyz` отвечает 503, тело несёт `code`
  `service_unavailable:not_ready` и `details` с `phase: 'SHUTDOWN'`

#### Scenario: Живость не зависит от готовности

- **WHEN** критичная проверка `db` вернула `down`
- **THEN** `GET /readyz` отвечает 503, а `GET /healthz` — 200: перезапускать
  процесс не за что
