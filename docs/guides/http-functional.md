# HTTP-сервер без DI: standalone-транспорт

✅ **Статус: актуально** — сверено с кодом `examples.simple-http-server`
(2026-07-30). Канон деклараций — per-transport конструкторы (`httpEndpoint`),
см. [design/endpoints.md](../design/endpoints.md); транспорт-нейтральный
`makeEndpoint` остаётся kernel-примитивом и в пользовательский канон не
входит. Запускаемый код — в
[`packages/examples.simple-http-server/`](../../packages/examples.simple-http-server/).

Минимальный уровень фреймворка: без DI-контейнера и без модулей.
Транспорт создаётся напрямую, endpoints — обычные значения.

## Endpoint с валидацией

```typescript
import { makePipeline, validate } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
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

export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/users',
  input: CreateUserInput,
  output: CreateUserOutput,
  pipeline: makePipeline().pre(validate()),
  handle: async (input: CreateUserInput): Promise<CreateUserOutput> => {
    // input уже провалидирован и типизирован (после validate())
    return { message: 'User created', user: { id: 1, ...input } };
  },
});
```

Ключевое: `method` + `path` — транспортный словарь HTTP (`pattern` ручки
собирается из них как `"МЕТОД /путь"`); `path` проверяется в момент создания
декларации — пустой путь, путь без ведущего `/` и повторяющийся
path-параметр падают сразу, а не на старте приложения. Схема `input` +
`.pre(validate())` в пайплайне дают типизированный payload в хендлере;
вернуть можно значение напрямую (обернётся в `Ok`) или явно
`Ok.created(...)` / `throw Fail.badRequest(...)`.

`server.route()` принимает **только deps-free декларацию**: у ручки с
`deps`, класс-хендлером или классами-юнитами в пайплайне тип несёт
неразрешённые зависимости, и standalone-путь её не примет — это ошибка
компиляции, а не рантайма. Погасить руками можно
`endpoint.resolve([...])` / `endpoint.resolve(resolver)`.

zod здесь — **один из вариантов**: ядро принимает любую
[Standard Schema](https://standardschema.dev) (valibot, arktype, TypeBox,
Effect Schema …) и валидатором не зависит. Отказ валидации возвращает `400`
с `details` вида `[{ message, path }]` — форма гарантирована спекой, не
вендором; async-refinement'ы в схемах endpoint'ов запрещены (валидация
синхронна по гарантии).

## Streaming-вход

```typescript
import { makePipeline, stream } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

const LogChunk = z.object({
  timestamp: z.number(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
});

export const StreamLogs = httpEndpoint({
  method: 'POST',
  path: '/logs/stream',
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
import { CreateUser, StreamLogs } from './endpoints';

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
[`App` + модули](./http-app-di.md): декларация не меняется вообще, к ней
добавляются `deps` (или класс-хендлер), а гашение зависимостей берёт на
себя App.

> Модель пайплайна (фазы, слои, логика решений) подробно описана в
> [decisions/ideas.md](../decisions/ideas.md), раздел «Pipeline v2».
