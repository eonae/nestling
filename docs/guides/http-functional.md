# HTTP-сервер в функциональном стиле

✅ **Статус: актуально** — сверено с кодом `examples.simple-http-server`
(2026-07-06). Запускаемый код — в
[`packages/examples.simple-http-server/`](../../packages/examples.simple-http-server/).

Минимальный уровень фреймворка: без DI-контейнера, без классов и декораторов.
Транспорт создаётся напрямую, endpoints — обычные значения.

## Endpoint с валидацией

```typescript
import { definePipeline, makeEndpoint, validate } from '@nestling/pipeline';
import z from 'zod';

const CreateUserInput = z.object({
  name: z.string().min(1).max(100),
  email: z.email(),
});
const CreateUserOutput = z.object({
  message: z.string(),
  user: z.object({ id: z.number(), name: z.string(), email: z.string() }),
});
type CreateUserInput = z.infer<typeof CreateUserInput>;
type CreateUserOutput = z.infer<typeof CreateUserOutput>;

export const CreateUser = makeEndpoint({
  transport: 'http',
  pattern: 'POST /users',
  input: CreateUserInput,
  output: CreateUserOutput,
  pipeline: definePipeline().use(validate()),
  handle: async (input: CreateUserInput): Promise<CreateUserOutput> => {
    // input уже провалидирован и типизирован (после validate())
    return { message: 'User created', user: { id: 1, ...input } };
  },
});
```

Ключевое: `pattern` — строка `"МЕТОД /путь"`; схема `input` + `validate()`
в пайплайне дают типизированный payload в хендлере; вернуть можно значение
напрямую (обернётся в `Ok`) или явно `Ok.created(...)` / `throw Fail.badRequest(...)`.

## Streaming-вход

```typescript
import { definePipeline, makeEndpoint, stream } from '@nestling/pipeline';

const LogChunk = z.object({
  timestamp: z.number(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
});

export const StreamLogs = makeEndpoint({
  transport: 'http',
  pattern: 'POST /logs/stream',
  input: stream(LogChunk),          // NDJSON: по одному JSON-объекту на строку
  output: z.object({ processed: z.number() }),
  pipeline: definePipeline(),
  handle: async (payload: AsyncIterableIterator<LogChunk>) => {
    let processed = 0;
    for await (const chunk of payload) processed++;
    return { processed };
  },
});
```

Каждый chunk валидируется схемой при парсинге. Streaming-ответ — симметрично:
хендлер возвращает `AsyncIterable`, транспорт отдаёт NDJSON.

## Middleware

Middleware — функция, добавляющая данные в контекст (before-only):

```typescript
import type { EmptyInput, MiddlewareFn } from '@nestling/pipeline';

export const withTiming: MiddlewareFn<EmptyInput, { timestamp: number }> =
  async () => ({ timestamp: Date.now() });

// подключение: definePipeline().use(withTiming).use(validate())
```

## Запуск

```typescript
import { HttpTransport } from '@nestling/transport.http';
import { CreateUser, StreamLogs } from './endpoints.functional';

const server = new HttpTransport({ port: Number(process.env.PORT) || 3000 });

server.route(CreateUser);
server.route(StreamLogs);

await server.listen();

// graceful shutdown — вручную (в standalone-режиме App нет)
process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});
```

## Куда расти

Когда появляется потребность в DI, модулях и lifecycle-хуках — переходи на
[`App` + классовые endpoints](./http-app-di.md): хендлеры при этом почти
не меняются.

> Целевой дизайн пайплайна развивается — см.
> [decisions/ideas.md](../decisions/ideas.md) (pipeline v2: `makePipeline`,
> фазы `.pre/.ok/.catch/.after/.finally`, `compose`). Текущий API —
> `definePipeline().use(...)`.
