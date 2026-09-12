# @nestlingjs/transport.http

HTTP-транспорт Nestling на `node:http`: маршрутизация через `find-my-way`,
разбор тела запроса по io-декларации endpoint'а (JSON, сырые байты, NDJSON,
multipart через `busboy`) и выбор формата ответа по той же декларации —
NDJSON для `stream(T)`, SSE для `events(T)`.

> 🚧 Активная разработка, API может меняться. CORS, ограничение частоты
> запросов и сжатие не реализованы. Валидатор для схем приложения пакет не
> выбирает: данные проверяет `@nestlingjs/app`.
> Дизайн: [`docs/design/transports.md`](../../docs/design/transports.md).
> Гайд: [глава 1. Поднять сервис, который отвечает на запрос](../../docs/guide/01-first-service.md),
> [глава 12. Файлы и потоки](../../docs/guide/12-files-and-streams.md).

## Установка

```bash
npm install @nestlingjs/transport.http
```

Пакет `zod` в зависимостях нужен только конфиг-секции сервера (`HTTP_PORT`,
`HTTP_HOST`).

## Минимальный пример

```typescript
import { makeApp, Ok } from '@nestlingjs/app';
import { http, httpEndpoint } from '@nestlingjs/transport.http';
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
  `HTTP_CAPABILITIES`, `HTTP_TRANSPORT_NAME`, `httpServerKeys`,
  `HttpTransport`, `HttpTransport$`.
- **Сервер и пробы** — `httpProbes`, `httpServer`, `HttpServer`,
  `HttpServer$`.
- **Декларация endpoint'а** ([design](../../docs/design/endpoints.md)) —
  `httpBindingOf`, `httpEndpoint`, `httpEndpoint.implement`, `HttpRouter`,
  `HttpStartContext`.

  Конструкторов два. `httpEndpoint({ method, path, … })` объявляет адрес
  сам. `httpEndpoint.implement(Operation, { … })` реализует операцию с
  секцией `http:`: адрес, схемы, `errors` и `doc` берутся с неё.
- **Запрос и ответ** — `Cookie`, `httpCodeOf`, `HttpHandler`,
  `HttpHandlerMeta`, `HttpOutput`, `HttpOutputSync`, `HttpRequest`,
  `HttpResponse`.
- **Байтовый уровень** — `assemblePayload`, `bindingNeedsBody`, `parseJson`,
  `parseMultipartForm`, `parseNdjson`, `parseRaw`, `readQuery`,
  `sendResponse`.

  Эти части публичны намеренно: на них собирается своя реализация
  `ITransport` поверх стороннего HTTP-сервера, без правок пакета.
- **Юниты пайплайна** ([design](../../docs/design/pipeline.md)) —
  `httpAccessLog`, `withClientIp`, `withHeader`.

## Границы пакета

Транспорт разбирает запрос и отдаёт ответ. Проверку данных схемой, политики
и пайплайн выполняет `@nestlingjs/app`; байтовый уровень — сжатие, CORS,
ограничение частоты — остаётся за обратным прокси.
