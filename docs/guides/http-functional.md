# HTTP-сервер в функциональном стиле

✅ **Статус: актуально** — сверено с кодом `examples.simple-http-server`
(2026-07-13). ⚠️ В целевом V1 фаза `.after` уходит (roadmap 17), а канон
деклараций — per-transport конструкторы (`httpEndpoint`,
[design/endpoints.md](../design/endpoints.md), roadmap 24); `makeEndpoint`
остаётся kernel-примитивом. Запускаемый код — в
[`packages/examples.simple-http-server/`](../../packages/examples.simple-http-server/).

Минимальный уровень фреймворка: без DI-контейнера, без классов и декораторов.
Транспорт создаётся напрямую, endpoints — обычные значения.

## Endpoint с валидацией

```typescript
import { makeEndpoint, makePipeline, validate } from '@nestling/pipeline';
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
  pipeline: makePipeline().pre(validate()),
  handle: async (input: CreateUserInput): Promise<CreateUserOutput> => {
    // input уже провалидирован и типизирован (после validate())
    return { message: 'User created', user: { id: 1, ...input } };
  },
});
```

Ключевое: `pattern` — строка `"МЕТОД /путь"`; схема `input` + `.pre(validate())`
в пайплайне дают типизированный payload в хендлере; вернуть можно значение
напрямую (обернётся в `Ok`) или явно `Ok.created(...)` / `throw Fail.badRequest(...)`.

## Streaming-вход

```typescript
import { makeEndpoint, makePipeline, stream } from '@nestling/pipeline';

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
  pipeline: makePipeline(),
  handle: async (payload: AsyncIterableIterator<LogChunk>) => {
    let processed = 0;
    for await (const chunk of payload) processed++;
    return { processed };
  },
});
```

Каждый chunk валидируется схемой при парсинге. Streaming-ответ — симметрично:
хендлер возвращает `AsyncIterable`, транспорт отдаёт NDJSON.

## Юниты и фазы

Pipeline — один слой с фазами. Вид юнита виден в декларации, она читается
сверху вниз как порядок исполнения:

| Метод | Когда вызывается | Контекст |
|---|---|---|
| `.pre(u)` | до хендлера, по порядку | накопленный, полный |
| `.ok(u)` | ответ — успех | полный (весь pre-тракт прошёл) |
| `.catch(u)` | ответ — `Fail` | свой слой `Partial` |
| `.after(u)` | любой ответ | свой слой `Partial` |
| `.finally(u)` | всегда, последним, с исходом | свой слой `Partial` |

Pre-юнит — функция, добавляющая данные в контекст (монотонно, с проверкой
типов):

```typescript
import type { EmptyInput, PreUnitFn } from '@nestling/pipeline';

export const withTiming: PreUnitFn<EmptyInput, { timestamp: number }> =
  async () => ({ timestamp: Date.now() });

// подключение: makePipeline().pre(withTiming).pre(validate())
```

Ответные юниты получают текущий ответ и могут заменить его (ошибку —
только ошибкой, успех — только успехом); `.finally` — наблюдатель исхода
(`completed | disconnected | aborted | failed`):

```typescript
const audited = makePipeline()
  .pre(withTiming)
  .catch((res) => ({ ...res, value: { error: mapMessage(res.value.error) } }))
  .finally((outcome, _res, ctx) => {
    console.log(`${ctx.raw.pattern} → ${outcome}`);
  });
```

Слои композируются константами — `compose(outer, ..., inner)` (снаружи
внутрь); требования слоя к внешнему контексту объявляются
`makePipeline<{ identity: User }>()` и проверяются компилятором в точке
композиции. Пример композиции — в `examples.app-with-http`
(`src/common/pipelines.ts`).

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

> Модель пайплайна (фазы, слои, логика решений) подробно описана в
> [decisions/ideas.md](../decisions/ideas.md), раздел «Pipeline v2».
