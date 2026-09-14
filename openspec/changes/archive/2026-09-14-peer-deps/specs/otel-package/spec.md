## MODIFIED Requirements

### Requirement: Границы пакета названы зависимостями

Манифест пакета SHALL объявлять `@opentelemetry/api`,
`@opentelemetry/sdk-trace-base` и `@opentelemetry/sdk-metrics`
peer-зависимостями и одновременно `devDependencies`. Экспортёр трасс и
экспортёр метрик приложение создаёт своей копией SDK и передаёт опциями
`traces` и `metrics`, поэтому копия SDK у приложения и у сателлита SHALL
быть одна. `@opentelemetry/api` объявляют peer-зависимостью и сами пакеты
SDK, и приложение уже держит его у себя.

`@opentelemetry/resources` и `@opentelemetry/semantic-conventions` SHALL
оставаться в `dependencies`: `Resource` собирается внутри слоя, а из
семантических соглашений берутся строковые константы имён. Оба имени
SHALL быть названы в списке исключений раскладки зависимостей
(capability `packages-layout`).

Внутренние `@nestlingjs/app` и `@nestlingjs/container` SHALL стоять в
`dependencies`.

Зависимости от `@nestlingjs/transport.http` SHALL NOT быть: своего endpoint'а
пакет не объявляет. Зависимости от `@opentelemetry/exporter-prometheus` SHALL
NOT быть: формат экспозиции живёт в `@nestlingjs/prometheus` и OpenTelemetry
не требует.

Обёрток над экспортёрами SDK пакет SHALL NOT экспортировать: экспортёры
трасс и метрик приходят опциями готовыми значениями.

Тест границы пакета SHALL перечислять фактические импорты `dist`, как у
остальных пакетов (capability `packages-layout`).

#### Scenario: Приложение выбирает экспортёры само

- **WHEN** приложению нужен OTLP по HTTP
- **THEN** оно импортирует `OTLPTraceExporter` и `OTLPMetricExporter` из
  пакетов SDK и передаёт их опциями `traces` и `metrics`

#### Scenario: Манифест совпадает с импортами

- **WHEN** прогоняется инвариант синхронизации зависимостей
- **THEN** множество объявленных зависимостей совпадает с множеством
  импортируемых

#### Scenario: Копия SDK одна

- **WHEN** прочитан манифест `@nestlingjs/otel`
- **THEN** `@opentelemetry/sdk-trace-base` и `@opentelemetry/sdk-metrics`
  стоят в `peerDependencies`, а не в `dependencies`

#### Scenario: Константы и ресурс остаются зависимостями

- **WHEN** прогоняется проверка раскладки зависимостей
- **THEN** `@opentelemetry/resources` и
  `@opentelemetry/semantic-conventions` расхождения не дают: оба имени
  стоят в списке исключений
