# @nestlingjs/otel

Экспорт телеметрии приложения по OpenTelemetry. Вход один — `otel(…)`, —
и он отдаёт две части: слой пайплайна, который пишет участок трассы, и
плагин, который отправляет метрики по OTLP. Накопленного у пакета своего
нет: участок собирается из переменной `Trace` ядра, точки метрик — из
снимка `MetricsStore$`.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/container.md`](../../docs/design/container.md),
> раздел «Метрики ядра», и
> [`docs/design/pipeline.md`](../../docs/design/pipeline.md) §3.
> Глава гайда: [23. Увидеть, где запрос провёл время](../../docs/guide/23-tracing.md).

## Установка

```bash
npm install @nestlingjs/otel @opentelemetry/exporter-trace-otlp-http
```

## Минимальный пример

```typescript
import { compose, everyEndpoint, makeApp, makePipeline, withTracing } from '@nestlingjs/app';
import { otel, Span } from '@nestlingjs/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { http, server } from '@nestlingjs/transport.http';

const api = server();

export const telemetry = otel({
  service: 'orders',
  version: '1.0.0',
  traces: new OTLPTraceExporter(),
});

export const traced = compose(
  makePipeline().pre(withTracing()),
  telemetry.spans,
);

export const app = makeApp({
  features: [OrdersFeature],
  plugins: [telemetry.plugin],
  transports: [http({ server: api })],
  policies: [everyEndpoint().hasVar(Span, 'span')],
});
```

Слой композируется в слой наблюдаемости приложения, плагин уходит в
`plugins:`. Политика требует переменную участка: endpoint, забывший слой,
отклоняет сборку, а не пропадает из трассы молча.

Опций у входа пять:

| Опция | Что задаёт |
|---|---|
| `service` | Атрибут ресурса `service.name`; обязательна |
| `version` | Атрибут ресурса `service.version` |
| `traces` | Куда уходят участки; без неё слой не отправляет ничего |
| `metrics` | Куда уходят метрики; без неё подписки на store не возникает |
| `intervalMs` | Интервал отправки метрик; по умолчанию 60000 |

## Экспорты

- **Вход** ([design](../../docs/design/container.md)) — `otel`, `Otel`,
  `OtelOptions`, `SpansLayer`.
- **Переменная участка** — `Span`, `OtelSpan`: её читает `Ctx(Span)`, и
  сервис дописывает атрибут или событие на текущем участке.

## Границы пакета

Идентификаторы участок берёт из переменной `Trace` — той самой, которую
ядро увозит соседу заголовком `traceparent`. Поэтому участки соседних
процессов сходятся в одно дерево, а не ссылаются на родителя, которого в
экспорте нет. Имя участка — шаблон маршрута из декларации, атрибуты —
`transport`, `pattern` и `outcome`, статус выводится из исхода: уход
клиента остаётся `UNSET`, потому что это не отказ сервиса.

Поверхность участка — два метода, `setAttribute` и `addEvent`. Метода
закрытия наружу нет: закрывает участок слой, и второй закрыватель дал бы
два участка с одним идентификатором.

Слой требует `trace` во внешнем контексте, поэтому композиция без
`withTracing()` выше не компилируется. У endpoint'а с потоковым выходом
участок уходит после закрытия итератора: длительность покрывает доставку
целиком.

Плагин объявляет ресурс, зависящий от `MetricsStore$`: раз в `intervalMs`
он читает `snapshot()` и отправляет его экспортёру. Освобождение ресурса
снимает таймер, досылает последний снимок и закрывает экспортёров.
Инструментов SDK пакет не заводит: агрегат уже посчитан store, а корзины,
`help` и `unit` приходят из объявления метрики. Поэтому push и экспозиция
`@nestlingjs/prometheus` показывают одно и то же.

Экспортёров пакет не оборачивает: `SpanExporter` и `PushMetricExporter`
приходят опциями готовыми значениями, поэтому протокол выбирает
приложение. Значения собираются формами SDK — `ReadableSpan` и
`ResourceMetrics`, — и любой готовый экспортёр работает без переходника.

Своего endpoint'а пакет не объявляет, и зависимости от
`@nestlingjs/transport.http` у него нет. Формат экспозиции Prometheus
живёт в своём пакете.
