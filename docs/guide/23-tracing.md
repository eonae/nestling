# 23. Увидеть, где запрос провёл время

> Гайд по текущему API; сверено с кодом `9410b106`.
> Целевое описание: [design/pipeline.md](../design/pipeline.md) §3,
> раздел «Штатные шаги наблюдаемости», и
> [design/container.md](../design/container.md), раздел «Метрики ядра».
> Почему так: запись [ideas.md](../decisions/ideas.md) «Разбор обзоров
> d/10 и d/13» [2026-09-12], пункт 2.

Числа из [главы 22](./22-metrics.md) показывают, что запросов стало
больше, а отвечает сервис дольше. Дальше они молчат: какой именно шаг
занял эти полсекунды — работа хендлера, запрос в базу или вызов соседнего
процесса, — по счётчику не видно. Нужны участки: у каждого запроса своё
начало, свой конец и своё место в дереве.

Трассу ядро уже везёт. `withTracing()` из [главы 9](./09-logging.md)
кладёт в контекст переменную `Trace` с полями `traceId`, `spanId` и
`parentSpanId`, заголовок `traceparent` увозит их соседу, а логгер пишет
`traceId` в каждую запись. Интервал — когда участок начался и сколько
шёл — не записывает никто, и показать трассу в Jaeger нечем.

## Сателлит отдаёт слой и плагин

Экспорт телеметрии живёт в пакете `@nestlingjs/otel`. Пакеты SDK
приложение ставит рядом: экспортёр оно создаёт само, и копия SDK у него и
у сателлита обязана быть одна.

```bash
npm install @nestlingjs/otel @opentelemetry/api \
  @opentelemetry/sdk-trace-base @opentelemetry/sdk-metrics \
  @opentelemetry/exporter-trace-otlp-http
```

Вход один:

```typescript
// src/observability.ts
import { otel } from '@nestlingjs/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

export const telemetry = otel({
  service: 'orders',
  version: '1.0.0',
  traces: new OTLPTraceExporter(),
});
```

`service` и `version` становятся атрибутами ресурса `service.name` и
`service.version` — по ним бэкенд отличает трассы одного сервиса от
трасс другого. Экспортёр приходит готовым значением: пакет выбирает не
протокол, а то, что отправлять. `OTLPTraceExporter` берёт адрес
коллектора из переменной окружения `OTEL_EXPORTER_OTLP_ENDPOINT`.

Значение `telemetry` несёт две части. `telemetry.spans` — слой пайплайна,
который пишет участок. `telemetry.plugin` — плагин: он закрывает
экспортёр на остановке приложения и отправляет метрики, если задана опция
`metrics` ([глава 22](./22-metrics.md)).

## Слой участков композируется в слой наблюдаемости

Участок пишется шагами пайплайна: pre-шаг открывает его, `.finally`-шаг
закрывает исходом. Слой добавляется к тому, который уже кладёт
`requestId` и трассу:

```typescript
// src/observability.ts
import { compose, makePipeline, withRequestId, withTracing } from '@nestlingjs/app';

export const traced = compose(
  makePipeline().pre(withRequestId()).pre(withTracing()).finally(AuditOutcome),
  telemetry.spans,
);
```

Порядок обязателен, и его проверяет компилятор: слой требует `trace` во
внешнем контексте. Композиция без `withTracing()` выше не собирается —
диагностика называет недостающее поле.

```typescript
// не компилируется: во внешнем контексте нет `trace`
compose(makePipeline().pre(withRequestId()), telemetry.spans);
```

Своего `withTracing()` слой не содержит намеренно. Продолжение трассы
объявляет приложение — одним шагом и в одном месте, иначе на запрос
пришлось бы два разных `spanId`.

## Политика сборки требует переменную

Слой, забытый на одном endpoint'е, не падает: этот маршрут просто исчезает
из трассы. Чтобы забытый слой стал отказом сборки, объявляется политика:

```typescript
// src/app.ts
import { everyEndpoint, makeApp } from '@nestlingjs/app';
import { Span } from '@nestlingjs/otel';

export const app = makeApp({
  features: [OrdersFeature],
  plugins: [telemetry.plugin],
  transports: [http({ server: api })],
  policies: [everyEndpoint().hasVar(Span, 'span')],
});
```

`hasVar` засчитывает объявление переменной слоем, поэтому перекомпозиция
слоя политику не ломает — в отличие от `hasLayer`, который сравнивает
значение по ссылке ([глава 10](./10-auth.md)). Отказ приходит на фазе
BUILD и называет паттерн endpoint'а и модуль, который его объявил;
сокет при этом не открывается.

Endpoint, которому участок не нужен, помечается `detached` с причиной —
как у любой другой политики.

## Что попадает в участок

Имя участка — шаблон маршрута из декларации: `GET /orders/:id`, а не
`GET /orders/42`. Адреса конкретных запросов в имена не попадают, поэтому
число разных имён в бэкенде конечно.

Атрибуты у участка те же три, что у метрик ядра: `transport`, `pattern` и
`outcome`. Статус участка выводится из исхода:

| Исход | Статус участка |
|---|---|
| `completed` | `OK` |
| `failed` | `ERROR` |
| `aborted` | `ERROR` |
| `disconnected` | `UNSET` |

`disconnected` не красится в `ERROR` намеренно: клиент, закрывший
соединение, — не отказ сервиса, и доля ошибок в дашборде не должна расти
от поведения клиентов. Отобрать такие участки можно по атрибуту
`outcome`.

У endpoint'а с потоковым выходом (`stream`, `events` из
[главы 12](./12-files-and-streams.md)) `.finally`-шаг вызывается после
закрытия итератора. Длительность участка покрывает доставку целиком, а не
работу хендлера.

Идентификаторы участка берутся из переменной `Trace`, а не создаются
заново. Поэтому участок соседнего процесса ссылается родителем на тот
участок, который увёз ему `traceparent`, и дерево сходится.

## Сервис дописывает атрибут

Участок лежит в контексте запроса переменной `Span`. Класс читает его
через `Ctx(Span)` и ставит свои атрибуты и события:

```typescript
// src/features/orders/orders.service.ts
import type { CtxReader } from '@nestlingjs/app';
import { Ctx } from '@nestlingjs/app';
import type { OtelSpan } from '@nestlingjs/otel';
import { Span } from '@nestlingjs/otel';
import { Component } from '@nestlingjs/container';

@Component([Ctx(Span)])
export class OrdersService {
  constructor(private readonly span: CtxReader<OtelSpan>) {}

  async checkout(id: string) {
    this.span.peek()?.setAttribute('order.id', id);
    this.span.peek()?.addEvent('payment requested');

    return this.payments.charge(id);
  }
}
```

Чтение идёт через `peek()`: вне запроса участка нет, и читалка возвращает
`undefined`. Методов у значения два — `setAttribute` и `addEvent`. Метода
закрытия нет: участок закрывает слой, и второй закрыватель дал бы два
участка с одним идентификатором.

Про OpenTelemetry SDK сервис при этом не знает: он видит переменную
контекста, как `Ctx(RequestId)` или `Ctx(TenantId)`.

## Дерево двух процессов

Разнесённые по процессам фичи из [главы 20](./20-split.md) пишут участки
каждая своим сателлитом. Слой ставится в базовый слой обоих процессов:

```typescript
// src/base.ts
export const traced = compose(
  makePipeline().pre(withTracing()).pre(TenantId.propagated()),
  telemetry.spans,
);
```

Вызыватель кладёт трассу в конверт сообщения, получатель возвращает её
шагом `withTracing()` на своей стороне. Участок получателя видит в
`Trace.parentSpanId` идентификатор участка вызывателя и становится его
ребёнком. Собственного участка у вызова порта нет: время, проведённое в
сети и в очереди брокера, показывает разность метрик
`nestling.port.duration` и `nestling.request.duration`.

## Посмотреть дерево

Коллектор и просмотр дерева поднимаются одним контейнером:

```bash
docker run --rm -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one
```

Приложение запускается с адресом коллектора:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 yarn start:dev
```

Дерево открывается на `http://localhost:16686`: сервис выбирается по
`service.name`, запрос — по `traceId` из записи логгера.

Без переменной окружения экспортёр никуда не отправляет, а без опции
`traces` слой работает и не отправляет ничего. Композиция приложения от
этого не меняется: экспорт включается настройкой развёртывания.

## Проверка

Тест подставляет экспортёр, который копит участки в памяти, и читает их
после запроса:

```typescript
// src/features/orders/tracing.spec.ts
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';

const traces = new InMemorySpanExporter();
const telemetry = otel({ service: 'orders', traces });

await using testApp = await buildTest(app);

await testApp.call(GetOrder, { id: '42' });

const [span] = traces.getFinishedSpans();

expect(span?.name).toBe('GET /orders/:id');
expect(span?.attributes.outcome).toBe('completed');
```

Участок приходит экспортёру значением формы `ReadableSpan` — той же,
которую он получил бы от OpenTelemetry SDK. Поэтому в тесте годится любой
готовый экспортёр, а в бою — тот, который умеет протокол развёртывания.
