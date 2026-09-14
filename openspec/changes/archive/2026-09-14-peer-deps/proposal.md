## Why

Сторонняя библиотека, объявленная в `dependencies` пакета фреймворка,
становится у потребителя второй копией рядом с его собственной. Путь
отказа в коде уже есть: `describeConfig({ converters: [zodConverter()] })`
сводит схемы секций, написанные копией `zod` внутри `@nestlingjs/app`, с
конвертером из `@nestlingjs/schema.zod`, где `zod` объявлен peer, то есть
копией приложения. У сателлита телеметрии то же самое видно в сигнатуре:
`SpanExporter` и `PushMetricExporter` — поля `OtelOptions`, а экспортёр
приложение создаёт своей копией SDK.

Решение и список исключений — запись [ideas.md [2026-09-14]](../../../docs/decisions/ideas.md)
«Зависимости пакетов: свой пакет в `dependencies`, библиотека в
`peerDependencies`», строка 111 [roadmap.md](../../../docs/decisions/roadmap.md).

## What Changes

- Правило раскладки манифеста записывается требованием: свой пакет
  `@nestlingjs/*` — в `dependencies`, сторонняя библиотека — в
  `peerDependencies` рядом с `devDependencies` того же манифеста.
  Необязательное дополнение остаётся необязательным peer, как
  `@nestlingjs/inbox` и `@nestlingjs/outbox` у `drizzle.pg`.
- **BREAKING** `zod` переезжает в `peerDependencies` у девяти пакетов:
  `app`, `config.vault`, `drizzle.pg`, `inbox`, `mcp`, `outbox`,
  `subscriptions`, `transport.http`, `transport.nats`. Приложение
  объявляет `zod` само.
- **BREAKING** `@opentelemetry/api`, `@opentelemetry/sdk-trace-base` и
  `@opentelemetry/sdk-metrics` переезжают в `peerDependencies`
  `@nestlingjs/otel`. `@opentelemetry/resources` и
  `@opentelemetry/semantic-conventions` остаются зависимостями.
- Список исключений заводится поимённо: `busboy`, `find-my-way`,
  `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`,
  `@standard-schema/spec`. У каждого имени записана причина.
- Инвариант `yarn verify` читает манифесты и печатает расхождение:
  внешнее имя в `dependencies` публикуемого пакета обязано стоять в
  списке исключений. Приватный пакет с `bin` не проверяется.
- Раздел «Установка» README затронутых пакетов называет, что приложение
  ставит рядом, на обоих языках. То же говорит заметка о выпуске 0.4.0.

## Capabilities

### New Capabilities

Новых capability нет: правило дополняет раскладку пакетов.

### Modified Capabilities

- `packages-layout`: добавляется требование о виде объявления внешней
  зависимости, список исключений и автоматическая проверка манифестов.
- `otel-package`: требование «Границы пакета названы зависимостями»
  делит пять имён OpenTelemetry на peer и обычные.
- `docs-package-readme`: раздел «Установка» называет peer-зависимости
  пакета.

## Impact

- Манифесты десяти пакетов: `nestling.app`, `nestling.config.vault`,
  `nestling.drizzle.pg`, `nestling.inbox`, `nestling.mcp`,
  `nestling.outbox`, `nestling.subscriptions`, `nestling.transport.http`,
  `nestling.transport.nats`, `nestling.otel`.
- Новая проверка в `scripts/boundary/`, вызов из `yarn verify` рядом с
  `public-api-validator.mjs`.
- README затронутых пакетов на обоих языках; глава установки гайда;
  `docs/design/` — там, где названа раскладка зависимостей.
- Примеры правок не требуют: `zod` объявлен у всех трёх,
  `@opentelemetry/api` и `sdk-trace-base` — у двух, которым они нужны.
  Проверяется прогоном `yarn install` без предупреждений о peer.

## Non-goals

- Выбор `zod` внутренним валидатором не пересматривается: правило
  «Standard Schema на границе, zod внутри» остаётся в силе.
- Диапазоны версий не меняются: `zod@^4.0.0` и диапазоны OpenTelemetry
  переезжают как есть.
- `@nestlingjs/viz` не публикуется и правилом не затрагивается: у него
  `bin` и своя статика, а не барель.
- `@modelcontextprotocol/sdk` остаётся в `devDependencies`
  `@nestlingjs/mcp`: он нужен проверке типов, а не рантайму.
- Заметка о выпуске 0.4.0 пишется отдельно; здесь — только текст про
  установку в README и в главе.
