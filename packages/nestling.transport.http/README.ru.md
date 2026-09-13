# @nestlingjs/transport.http

HTTP-транспорт Nestling на `node:http`: маршрутизация через `find-my-way`,
разбор тела запроса по io-декларации endpoint'а (JSON, сырые байты, NDJSON,
multipart через `busboy`) и выбор формата ответа по той же декларации —
NDJSON для `stream(T)`, SSE для `events(T)`. Тот же набор endpoint'ов
работает внутри чужого процесса: `adapter()` объявляет транспорт без
сокета и отдаёт обработчик запроса наружу.

> 🚧 Активная разработка, API может меняться. CORS, ограничение частоты
> запросов и сжатие не реализованы. Валидатор для схем приложения пакет не
> выбирает: данные проверяет `@nestlingjs/app`.
> Дизайн: [`docs/design/transports.md`](../../docs/design/transports.md).
> Гайд: [глава 1. Поднять сервис, который отвечает на запрос](../../docs/guide/01-first-service.md),
> [глава 12. Файлы и потоки](../../docs/guide/12-files-and-streams.md).
> Рецепт: [приложение внутри чужого процесса](../../docs/recipes/embedded.md).

## Установка

```bash
npm install @nestlingjs/transport.http
```

Пакет `zod` в зависимостях нужен только конфиг-секции сервера (`HTTP_PORT`,
`HTTP_HOST`).

## Минимальный пример

```typescript
import { makeApp, Ok } from '@nestlingjs/app';
import {
  adapter,
  http,
  httpEndpoint,
  toFetchHandler,
} from '@nestlingjs/transport.http';
import { z } from 'zod';

export const GetUser = httpEndpoint.get('/users/:id', {
  input: z.object({ id: z.string() }), // id берётся из пути
  output: z.object({ id: z.string(), name: z.string() }),
  handler: async ({ id }) => new Ok({ id, name: 'Alice' }),
});

// Свой процесс: транспорт работает на сервере, сервер держит сокет
await makeApp({
  features: [UsersFeature], // фича, где объявлен GetUser
  transports: [http()], // объявление, а не экземпляр
})
  .build()
  .run();

// Чужой процесс: сокета нет, наружу уходит обработчик запроса
const embedded = makeApp({
  features: [UsersFeature],
  transports: [adapter()],
}).build();

await embedded.run({ signals: false }); // сигналы остаются хозяину процесса

export const GET = toFetchHandler(embedded); // (Request) => Promise<Response>
```

## Экспорты

- **Транспорт** ([design](../../docs/design/transports.md)) — `http`,
  `HTTP_CAPABILITIES`, `HTTP_TRANSPORT_NAME`, `HttpTransport`,
  `HttpTransport$`.
- **Адаптер** ([рецепт](../../docs/recipes/embedded.md)) — `adapter`,
  `HttpAdapter`, `HttpFetchHandler`, `HttpNodeHandler`, `toFetchHandler`,
  `toNodeHandler`.
- **Сервер и пробы** — `httpProbes`, `HttpServer`, `HttpServer$`,
  `server`, `serverKeys`.
- **Декларация endpoint'а** ([design](../../docs/design/endpoints.md)) —
  `httpBindingOf`, `httpEndpoint`, `httpEndpoint.implement`, `HttpRouter`,
  `HttpStartContext`.

  `httpEndpoint` — значение, а не функция. Декларацию создают семь
  статиков. Шесть по HTTP-методу — `get`, `head`, `post`, `put`, `patch`,
  `delete` — объявляют адрес сами: метод назван именем конструктора, путь
  идёт первым аргументом. Седьмой, `httpEndpoint.implement(Operation,
  { … })`, реализует операцию с секцией `http:`: адрес, схемы, `errors` и
  `doc` берутся с неё.
- **Запрос и ответ** — `Cookie`, `httpCodeOf`, `HttpHandler`,
  `HttpHandlerMeta`, `HttpOutput`, `HttpOutputSync`, `HttpRequest`,
  `HttpResponse`.
- **Реэкспорт [`@nestlingjs/operations`](../nestling.operations/)** — формат
  тела отказа ([design](../../docs/design/errors.md)).

  Отказ уходит документом RFC 9457 под медиатипом
  `application/problem+json`: код отказа — в члене `type` с префиксом
  `urn:error:`, сообщение — в `detail`, детали — в `details`. Медиатип,
  префикс типа, сборка документа и обратный разбор типа в код объявлены
  в пакете операций, чтобы клиент читал документ в браузере; отсюда они
  реэкспортированы, чтобы генератор документации и транспорт поверх
  стороннего сервера брали формат оттуда же, откуда `httpCodeOf`.
- **Байтовый уровень** — `buildPayload`, `bindingNeedsBody`, `HttpSink`,
  `HttpSource`, `parseJson`, `parseMultipartForm`, `parseNdjson`,
  `parseRaw`, `PayloadTooLargeError`, `readQuery`, `sendResponse`.

  Эти части публичны намеренно: на них собирается своя реализация
  `ITransport` поверх стороннего HTTP-сервера, без правок пакета.
  `HttpSource` и `HttpSink` описывают, что транспорт читает у запроса и
  во что пишет ответ; `IncomingMessage` и `ServerResponse` удовлетворяют
  им как есть.
- **Шаги пайплайна** ([design](../../docs/design/pipeline.md)) —
  `httpAccessLog`, `withClientIp`, `withHeader`.

## Границы пакета

Транспорт разбирает запрос и отдаёт ответ. Проверку данных схемой, политики
и пайплайн выполняет `@nestlingjs/app`; байтовый уровень — сжатие, CORS,
ограничение частоты — остаётся за обратным прокси.
