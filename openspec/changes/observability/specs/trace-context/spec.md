## ADDED Requirements

### Requirement: Переменная `Trace` — well-known и провозимая

`@nestlingjs/app` SHALL экспортировать well-known ambient-переменную
`Trace: ContextVar<TraceContext, 'trace'>` и тип `TraceContext` с полями
`traceId: string`, `spanId: string`, `parentSpanId?: string` и
`sampled: boolean`.

Переменная SHALL быть объявлена `{ propagate: true }`, поэтому вызыватель
порта SHALL класть её значение в конверт шины, а получатель SHALL класть
его в `ctx.raw.attributes` (capability `context-propagation`).

Идентификаторы SHALL следовать формату W3C trace-context: `traceId` — 32
шестнадцатеричных знака, `spanId` — 16.

#### Scenario: Чтение из глубины графа

- **WHEN** сервис объявил `Ctx(Trace)` в списке зависимостей, а пайплайн
  запроса содержит `withTracing()`
- **THEN** `get()` возвращает `TraceContext` этого запроса

#### Scenario: Значение едет конвертом шины

- **WHEN** обработчик с трассой в контексте зовёт порт с remote-биндингом
- **THEN** значение `Trace` находится в конверте рядом с `timeoutMs`, а на
  приёме — в `ctx.raw.attributes`

### Requirement: `withTracing()` — pre-юнит, продолжающий или начинающий трассу

`@nestlingjs/app` SHALL экспортировать `withTracing()`, возвращающий
pre-юнит `PreUnitFn<EmptyInput, { trace: TraceContext }>`. Юнит SHALL быть
реализован через `Trace.provide(…)`, поэтому политика
`everyEndpoint(…).hasVar(Trace)` SHALL засчитывать его.

Родительский контекст SHALL читаться из `ctx.raw.attributes` в порядке:
поле `trace` (значение с шины), затем заголовок `traceparent` (HTTP). При
отсутствии обоих SHALL начинаться новая трасса с новым `traceId`.

Юнит SHALL создавать новый `spanId` на каждый запрос и SHALL класть прежний
идентификатор участка в `parentSpanId`. Флаг `sampled` SHALL переноситься
из родительского контекста; у новой трассы он SHALL быть `true`.

Разбор `traceparent` SHALL быть снисходительным: значение неизвестного вида
SHALL игнорироваться, и трасса SHALL начинаться заново. Отказа SHALL NOT
возникать — значение приходит из-за границы доверия и схемы не имеет.

Автоматической подстановки юнита в пайплайн SHALL NOT происходить:
трассировка объявляется композицией, как `withRequestId()`.

#### Scenario: Продолжение трассы по HTTP

- **WHEN** запрос приходит с заголовком
  `traceparent: 00-<32 знака>-<16 знаков>-01`, а пайплайн содержит
  `withTracing()`
- **THEN** `Ctx(Trace)` несёт тот же `traceId`, `parentSpanId` равен
  идентификатору участка из заголовка, `spanId` — новый, `sampled` — `true`

#### Scenario: Продолжение трассы по шине

- **WHEN** сервис A с трассой в контексте зовёт порт, реализованный в
  процессе B, а пайплайн реализации содержит `withTracing()`
- **THEN** контекст в процессе B несёт тот же `traceId`, а `parentSpanId`
  равен `spanId` процесса A

#### Scenario: Новая трасса без входящего контекста

- **WHEN** запрос приходит без `traceparent`
- **THEN** `Ctx(Trace)` несёт новый `traceId`, `parentSpanId` отсутствует,
  `sampled` равен `true`

#### Scenario: Непонятный заголовок не отказ

- **WHEN** запрос приходит с `traceparent: garbage`
- **THEN** запрос обрабатывается, а трасса начинается заново с новым
  `traceId`

#### Scenario: Присутствие проверяется на сборке

- **WHEN** объявлена политика `everyEndpoint(…).hasVar(Trace)`, а пайплайн
  endpoint'а `withTracing()` не содержит
- **THEN** сборка падает на проверке политик

### Requirement: Граница провоза трассы — шина и HTTP

Трасса SHALL переноситься шиной (конвертом) и HTTP (заголовком
`traceparent`). Переноса через CLI-транспорт SHALL NOT появляться в рамках
этой capability.

#### Scenario: CLI трассу не переносит

- **WHEN** команда CLI исполняется в приложении с `withTracing()`
- **THEN** трасса начинается заново: переносить её команде нечем
