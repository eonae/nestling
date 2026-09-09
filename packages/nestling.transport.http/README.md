# @nestling/transport.http

HTTP-транспорт Nestling на `node:http`: маршрутизация через `find-my-way`,
разбор тела запроса по io-декларации endpoint'а (JSON, сырые байты, NDJSON,
multipart через `busboy`) и выбор формата ответа по той же декларации —
NDJSON для `stream(T)`, SSE для `events(T)`.

> 🚧 Активная разработка, API может меняться. CORS, ограничение частоты
> запросов и сжатие не реализованы. Валидатор для схем приложения пакет не
> выбирает: данные проверяет `@nestling/app`.
> Дизайн: [`docs/design/transports.md`](../../docs/design/transports.md).
> Гайд: [глава 1. Поднять сервис, который отвечает на запрос](../../docs/guide/01-first-service.md),
> [глава 11. Файлы и потоки](../../docs/guide/11-files-and-streams.md).

## Установка

```bash
npm install @nestling/transport.http
```

Пакет `zod` в зависимостях нужен только конфиг-секции сервера (`HTTP_PORT`,
`HTTP_HOST`).

## Минимальный пример

```typescript
import { makeApp, Ok } from '@nestling/app';
import { http, httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: z.object({ id: z.string() }), // id берётся из пути
  output: z.object({ id: z.string(), name: z.string() }),
  handler: async ({ id }) => new Ok({ id, name: 'Alice' }),
});

await makeApp({
  features: [UsersFeature], // фича, где объявлен GetUser
  transports: [http()], // объявление, а не экземпляр
})
  .assemble()
  .run();
```

## Экспорты

- **Транспорт** ([design](../../docs/design/transports.md)) — `http`,
  `HTTP_CAPABILITIES`, `HTTP_TRANSPORT_NAME`, `httpServerKeys`, `HttpTransport`,
  `HttpTransport$`, `HttpTransportOptions`.
- **Сервер и пробы** — `httpProbes`, `HttpProbesOptions`, `HttpRequestListener`,
  `httpServer`, `HttpServer`, `HttpServer$`, `HttpServerOptions`,
  `HttpServerSpec`, `NotReady`.
- **Декларация endpoint'а** ([design](../../docs/design/endpoints.md)) —
  `assemblePayload`, `BindingBearer`, `bindingNeedsBody`, `httpBindingOf`,
  `httpEndpoint`, `HttpEndpointDictionary`, `HttpHandlerClass`, `HttpHandlerFn`,
  `HttpOperationDictionary`, `HttpRouter`, `HttpStartContext`, `PayloadSources`,
  `readQuery`, `RouteEntry`, `StartContext`.
- **Запрос и ответ** — `BytesObserver`, `collectFileParts`, `Cookie`,
  `DEFAULT_REDIRECT_STATUS`, `DEFAULT_SSE_HEARTBEAT`, `httpCodeOf`,
  `HttpHandler`, `HttpHandlerMeta`, `HttpOutput`, `HttpOutputSync`,
  `HttpRequest`, `HttpResponse`, `HttpResponseMeta`, `HttpResponseOptions`,
  `MultipartResult`, `parseJson`, `parseJsonBuffer`, `parseMultipartForm`,
  `parseNdjson`, `parseRaw`, `readBody`, `RedirectOptions`, `SendOptions`,
  `sendResponse`, `SSE_ERROR_EVENT`.
- **Юниты пайплайна** ([design](../../docs/design/pipeline.md)) —
  `httpAccessLog`, `withClientIp`, `withHeader`.
- **Ошибки транспорта** — `JsonParseError`, `MultipartFieldError`,
  `PayloadTooLargeError`.
- **Реэкспорт [`@nestling/operations`](../nestling.operations/)** — две формы
  bind-карты приходят из пакета-соседа.

## Границы пакета

Транспорт разбирает запрос и отдаёт ответ. Проверку данных схемой, политики
и пайплайн выполняет `@nestling/app`; байтовый уровень — сжатие, CORS,
ограничение частоты — остаётся за обратным прокси.
