## ADDED Requirements

### Requirement: `@nestlingjs/otel` — один вход, три части

Репозиторий SHALL содержать пакет `@nestlingjs/otel`, экспортирующий функцию
`otel(options: OtelOptions): Otel`.

Значение `Otel` SHALL нести ровно три поля:

| Поле | Тип | Куда идёт |
| --- | --- | --- |
| `metrics` | `Metrics` | опция `makeApp({ metrics })` |
| `spans` | слой пайплайна | композиция слоя наблюдаемости приложения |
| `plugin` | `Plugin` | список `plugins:` корня |

`OtelOptions` SHALL нести поля `service: string`, `version?: string`,
`path?: string`, `traces?: SpanExporter` и `readers?: readonly MetricReader[]`.
Умолчание `path` SHALL быть `/metrics`.

Три части SHALL смотреть в один провайдер метрик и один экспортёр участков:
второго вызова `otel(…)` для их связывания SHALL NOT требоваться.

Отдельных фабрик под корень, слой и плагин SHALL NOT существовать: сшивать их
руками — обязанность, которую пакет и снимает.

#### Scenario: Приложение подключает сателлит целиком

- **WHEN** написано `const telemetry = otel({ service: 'users' })`, значение
  `telemetry.metrics` передано опцией `metrics`, `telemetry.plugin` — в
  `plugins:`, а `telemetry.spans` композирован в слой
- **THEN** приложение собирается, записи ядра уходят в провайдер метрик, а
  endpoint экспозиции отдаёт те же числа

#### Scenario: Метрики без трасс

- **WHEN** приложение подключило `metrics` и `plugin`, но слой участков в
  пайплайны не композировало
- **THEN** метрики работают, участки никуда не уходят, сборка проходит

### Requirement: Корень метрик — настоящая реализация поверх OTel SDK

Поле `metrics` SHALL быть реализацией интерфейса `Metrics` поверх
`MeterProvider` из `@opentelemetry/sdk-metrics`.

`counter(name, value, attributes)` SHALL писать в инструмент `Counter` с тем же
именем, `histogram(name, value, attributes)` — в `Histogram`. Инструменты SHALL
кэшироваться по имени: повторная запись SHALL NOT создавать второй инструмент.

Атрибуты записи SHALL уходить атрибутами точки измерения без переименования:
имена ядра (`transport`, `pattern`, `outcome`, `operation`, `kind`, `binding`,
`scope`) SHALL сохраняться.

Ресурс провайдера SHALL нести `service.name` из опции `service` и
`service.version` из опции `version`, если она задана.

Точки в именах метрик ядра (`nestling.requests`) SHALL передаваться в SDK как
есть: перевод в форму экспозиции — дело формата, а не корня.

#### Scenario: Счётчик ядра попадает в провайдер

- **WHEN** приложение с `telemetry.metrics` обработало `GET /users`
- **THEN** провайдер метрик несёт точку инструмента `nestling.requests` с
  атрибутами `transport`, `pattern` и `outcome`

#### Scenario: Второй записи хватает одного инструмента

- **WHEN** `counter('orders.created')` вызван дважды
- **THEN** создан один инструмент, и его значение равно двум

#### Scenario: Область токена семейства становится атрибутом

- **WHEN** класс с `Metrics$.auto` пишет `counter('created')`
- **THEN** точка несёт атрибут `scope` с именем класса

### Requirement: Плагин отдаёт экспозицию на сокете приложения

Поле `plugin` SHALL объявлять HTTP-endpoint по адресу из опции `path` с
`output: 'text'` и пометкой `detached`, текст которой называет снятие метрик
сборщиком.

Ответ SHALL быть форматом экспозиции Prometheus: чтение SHALL собирать
накопленное `MetricReader`-ом и сериализовать его
`PrometheusSerializer`-ом из `@opentelemetry/exporter-prometheus`.

Своего HTTP-сервера пакет SHALL NOT поднимать: `PrometheusExporter` SHALL
создаваться с `preventServerStart`. Второго сокета в приложении SHALL NOT
появляться.

Endpoint экспозиции SHALL NOT попадать в документ OpenAPI и SHALL NOT
проверяться политиками сборки — это следует из `detached`.

#### Scenario: Экспозиция на сокете приложения

- **WHEN** приложение поднято и запрошен `GET /metrics`
- **THEN** ответ — текст формата Prometheus со строками `nestling_requests`, и
  второго открытого порта в процессе нет

#### Scenario: Свой адрес экспозиции

- **WHEN** сателлит создан как `otel({ service: 'users', path: '/internal/metrics' })`
- **THEN** экспозиция отвечает по `/internal/metrics`, а по `/metrics` —
  `404`

#### Scenario: Экспозиции нет в документе

- **WHEN** построен документ OpenAPI приложения с плагином сателлита
- **THEN** адреса экспозиции в документе нет

### Requirement: Накопленное сбрасывается на остановке

Плагин SHALL объявлять ресурс, чьё освобождение SHALL вызывать `forceFlush()`
и `shutdown()` у провайдера метрик и у экспортёра участков, если он задан.

Ресурс SHALL приходить вместе с плагином: отдельного объявления в приложении
SHALL NOT требоваться.

Ошибка сброса SHALL NOT срывать остановку приложения: она SHALL уходить в
логгер и SHALL NOT всплывать из фазы остановки.

#### Scenario: Последний интервал не теряется

- **WHEN** приложение с OTLP-пушем остановлено между отправками
- **THEN** накопленные записи уходят экспортёру до завершения процесса

#### Scenario: Коллектор недоступен на остановке

- **WHEN** сброс на остановке отказал
- **THEN** приложение останавливается, а причина уходит записью логгера

### Requirement: Границы пакета названы зависимостями

Манифест пакета SHALL объявлять зависимости `@opentelemetry/api`,
`@opentelemetry/sdk-metrics`, `@opentelemetry/exporter-prometheus`,
`@opentelemetry/sdk-trace-base`, `@opentelemetry/resources`,
`@opentelemetry/semantic-conventions` и внутренние `@nestlingjs/app`,
`@nestlingjs/container`, `@nestlingjs/transport.http`.

Обёрток над экспортёрами SDK пакет SHALL NOT экспортировать: экспортёр
участков и читалки метрик приходят опциями готовыми значениями.

Тест границы пакета SHALL перечислять фактические импорты `dist`, как у
остальных пакетов (capability `packages-layout`).

#### Scenario: Приложение выбирает экспортёр само

- **WHEN** приложению нужен OTLP по HTTP
- **THEN** оно импортирует `OTLPTraceExporter` из
  `@opentelemetry/exporter-trace-otlp-http` и передаёт его опцией `traces`

#### Scenario: Манифест совпадает с импортами

- **WHEN** прогоняется инвариант синхронизации зависимостей
- **THEN** множество объявленных зависимостей совпадает с множеством
  импортируемых
