# health

## Why

Пробы liveness и readiness в репозитории описаны двумя несовместимыми
дизайнами. Запись [deferred [2026-07-14]](../../../docs/decisions/deferred.md)
выводила оба сигнала из фазы и относила поверхность проб к байтовому уровню
HTTP-транспорта. Гайд и пример `app-with-http` делают пробу обычным
endpoint'ом с `detached` и `doc.hidden` (главы 10 и 24). В коде нет ни того,
ни другого: ни узла ядра, ни семейства вкладов.

Выбранный дизайн зафиксирован записью
[ideas.md [2026-09-06] «Пробы: `HealthCheck$` и `Health$` в ядре, транспорты
адаптируют»](../../../docs/decisions/ideas.md) и уже описан в
`design/composition.md` §6, `design/transports.md` §4.3 и
`design/container.md`. Change приводит код к этому описанию.

Три причины, по которым старый дизайн не годится. Liveness из фазы не
отличима от «процесс ответил»: если event loop встал, проба не ответит в
любом случае. Readiness обязана становиться ложной на SHUTDOWN, иначе
балансировщик шлёт трафик в дренаж. Состояние зависимостей меняется в RUN —
отвалившаяся база не видна ни одной фазовой проверке.

## What Changes

- Ядро (`@nestling/app`) объявляет семейство `HealthCheck$(name)` с
  интерфейсом `HealthCheck { critical: boolean; check(signal): Promise<HealthStatus> }`.
  Вклад регистрируется обычным провайдером члена:
  `classProvider(HealthCheck$('db'), DbHealthCheck)`.
- Ядро объявляет узел `Health$` с двумя методами. `liveness()` отвечает `ok`
  всегда. `readiness(signal)` возвращает отчёт: фаза, исходы проверок, итог.
  Итог `ready` — только в фазе RUN и только при успехе всех критичных
  проверок; до RUN и на SHUTDOWN итог `not_ready` без запуска проверок.
- Текущая фаза приложения становится наблюдаемой из графа: узел ядра читает
  её значением, а не выводит из своего состояния.
- Проверки выполняются по запросу пробы, каждая со своим таймаутом, результат
  кэшируется на короткий срок. Таймаут и срок кэша задаёт kernel-секция
  `nestlingHealth` (`NESTLING_HEALTH_TIMEOUT`, `NESTLING_HEALTH_CACHE`);
  наружу пакет отдаёт `healthConfigKeys`.
- Контейнер (`@nestling/container`): метод `health(signal)` у класса-ресурса
  и поле `health` у `resourceProvider` регистрируют вклад
  `HealthCheck$(<id узла>)` без отдельного провайдера.
- `@nestling/transport.http` экспортирует плагин `httpProbes()` с двумя
  endpoint'ами: `GET /healthz` и `GET /readyz`. Оба без пайплайна, с
  `detached` и `doc.hidden`. `readyz` отвечает 200 при итоге `ready` и 503
  при `not_ready`, в теле — отчёт.
- **BREAKING** Пример `app-with-http` теряет endpoint `Health` в фиче `ops`:
  пробы подключаются плагином в корне.
- Гайд (главы 9, 10, 22, 24), `docs/glossary.md` и README пакетов
  `@nestling/app`, `@nestling/container`, `@nestling/transport.http`
  описывают пробы одним дизайном.

## Capabilities

### New Capabilities

- `health-probes`: узел `Health$`, семейство вкладов `HealthCheck$`, правила
  итога readiness по фазе и критичности, таймаут и кэш проверок,
  kernel-секция `nestlingHealth`.
- `http-probes`: плагин `httpProbes()` пакета `@nestling/transport.http` —
  два endpoint'а над узлом ядра, коды ответа и тело отчёта.

### Modified Capabilities

- `resource-lifecycle`: метод `health` у класса-ресурса и поле `health` у
  `resourceProvider` регистрируют вклад в пробы под идентификатором узла.
- `lifecycle-phases`: текущая фаза приложения читается из графа значением —
  на это опирается итог readiness.
- `http-transport-boundary`: пробы входят в границу пакета тонким слоем над
  `Health$`; `httpProbes` попадает в перечень публичных экспортов.

## Non-goals

- Отдельное состояние старта (`startupProbe`): провал INIT завершает процесс,
  и отличать «ещё стартует» от «упал» некому.
- Пробы для CLI и NATS: узел ядра общий, адаптеры этих транспортов пишутся
  тогда, когда для них появится потребитель.
- Метрики, трассировка и любой другой формат отдачи состояния: `Health$`
  отдаёт отчёт значением, всё остальное — satellite-пакеты.
- Автоматический вклад для транспортов и серверов: вклад регистрирует ресурс,
  у которого есть `health`, а не сборка по своему решению.
- Формат RFC-совместимого документа состояния (`application/health+json`):
  тело отчёта задаётся этим change'ем и остаётся собственным.

## Impact

- `packages/nestling.app`: новый каталог `src/health` (семейство, узел,
  секция конфига, kernel-модуль), регистрация kernel-модуля и передача фазы
  в `src/root/app.ts`, экспорт из `src/index.ts`.
- `packages/nestling.container`: поле `health` в определении провайдера
  ресурса, чтение метода `health` у класса-ресурса, признак вклада в
  метаданных узла.
- `packages/nestling.transport.http`: модуль плагина `httpProbes()` и его
  экспорт.
- `examples/app-with-http`: удаление `features/ops/health.endpoint.ts`,
  подключение `httpProbes()` в корне.
- Документация: `docs/guide/09-logging.md`, `10-auth.md`, `22-token-families.md`,
  `24-ops.md`, `docs/glossary.md`, README трёх пакетов; `docs/design/*` уже
  описывают целевое состояние и сверяются, а не переписываются.
