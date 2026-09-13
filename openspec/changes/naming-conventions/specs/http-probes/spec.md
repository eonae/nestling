## RENAMED Requirements

- FROM: `### Requirement: \`httpProbes()\` — плагин пакета с двумя endpoint'ами`
- TO: `### Requirement: \`makeHttpProbes()\` — плагин пакета с двумя endpoint'ами`

## MODIFIED Requirements

### Requirement: `makeHttpProbes()` — плагин пакета с двумя endpoint'ами

`@nestlingjs/transport.http` SHALL экспортировать `makeHttpProbes(options?)`,
возвращающий `Plugin` с двумя HTTP-декларациями: `GET /healthz` (liveness) и
`GET /readyz` (readiness). Пути SHALL задаваться опциями `liveness` и
`readiness`; без опций SHALL действовать умолчания.

Хендлеры SHALL читать узел ядра `Health$` и SHALL NOT содержать собственной
логики проверок: итог, кэш и таймаут принадлежат ядру (capability
`health-probes`).

Плагин SHALL NOT регистрировать провайдеров: узел ядра уже в графе.

#### Scenario: Подключение плагина

- **WHEN** корень объявляет `plugins: [makeHttpProbes()]`
- **THEN** приложение обслуживает `GET /healthz` и `GET /readyz`

#### Scenario: Свои пути проб

- **WHEN** объявлено `makeHttpProbes({ liveness: '/live', readiness: '/ready' })`
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
  `authed`» и подключает `makeHttpProbes()`
- **THEN** сборка проходит, а отчёт `check()` содержит обе пробы с причиной
  вывода из-под политик

#### Scenario: Проб нет в документе OpenAPI

- **WHEN** приложение с `makeHttpProbes()` строит документ OpenAPI
- **THEN** путей проб в документе нет
