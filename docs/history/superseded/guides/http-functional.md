# HTTP-сервер без DI

> Гайд по **текущему API**; сверено с кодом `examples.simple-http-server` (2026-09-02).
> Целевое описание деклараций — [design/endpoints.md](../design/endpoints.md).
> Запускаемый код — в
> [`packages/examples.simple-http-server/`](../../packages/examples.simple-http-server/).

Это минимальный уровень фреймворка: без контейнера и без модулей. Вы
создаёте транспорт напрямую, а endpoint'ы объявляете обычными значениями
через `httpEndpoint`. Транспорт-нейтральный конструктор `makeEndpoint`
остаётся примитивом ядра; в пользовательском коде его не используют.

## Endpoint со схемой входа

```typescript
// packages/examples.simple-http-server/src/endpoints/create-user.endpoint.ts
import { withTiming } from '../common/middleware';
import { EmailTaken } from '../errors';

import type { Output } from '@nestling/pipeline';
import { makePipeline } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import z from 'zod';

const CreateUserInput = z.object({
  name: z.string().min(1).max(100),
  email: z.email(),
  address: z.object({ street: z.string().min(1), city: z.string().min(1) }),
});
const CreateUserOutput = z.object({
  message: z.string(),
  user: z.object({
    id: z.number(),
    name: z.string(),
    email: z.string(),
    address: z.object({ street: z.string(), city: z.string() }),
  }),
});
type CreateUserInput = z.infer<typeof CreateUserInput>;
type CreateUserOutput = z.infer<typeof CreateUserOutput>;

const taken = new Set(['taken@example.com']);

export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/users',
  input: CreateUserInput,
  output: CreateUserOutput,
  errors: [EmailTaken],
  pipeline: makePipeline().pre(withTiming),
  handle: async (
    input: CreateUserInput,
  ): Output<CreateUserOutput, ReturnType<typeof EmailTaken>> => {
    if (taken.has(input.email)) {
      return EmailTaken({ email: input.email });
    }

    return {
      message: 'User created',
      user: { id: Math.floor(Math.random() * 1000), ...input },
    };
  },
});
```

`method` и `path` задают адрес endpoint'а. Его паттерн собирается из них как
`"МЕТОД /путь"`. Путь проверяется в момент создания декларации: пустой путь,
путь без ведущего `/` и повторяющийся path-параметр дают ошибку сразу, а не
на старте приложения.

Схема `input` даёт хендлеру уже проверенный и типизированный payload:
вход по ней проверяет рантайм перед вызовом хендлера, независимо от
состава пайплайна. Невалидный запрос получает `400` с кодом
`VALIDATION_FAILED`, и хендлер не вызывается. Чтобы принимать любое
значение, объявите схему `z.unknown()`; отдельного способа отключить
проверку нет. Хендлер может вернуть значение
напрямую (оно оборачивается в `Ok`) или явно вызвать `Ok.created(...)`,
чтобы ответить статусом 201.

Отказ (`Fail`) — тоже значение. Объявите его через `defineFail`,
перечислите в `errors:` декларации и верните из хендлера или бросьте: для
ответа это одно и то же. Отказ, которого нет в `errors:`, вернуть нельзя —
это ошибка компиляции. Если такой отказ всё же долетит до границы
пайплайна (например, брошенный из глубины), клиент получит `UNKNOWN` с
кодом 500.

```typescript
// packages/examples.simple-http-server/src/errors.ts
export const EmailTaken = defineFail('EMAIL_TAKEN', {
  status: 'CONFLICT',                        // HTTP 409
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} already taken`,
});
```

Модель ошибок целиком описана в [design/errors.md](../design/errors.md).

## Куда попадают поля запроса

Поля `input` раскладываются по частям HTTP-запроса по фиксированному
правилу:

1. имя поля совпало с path-параметром шаблона (`:id`) — поле берётся из
   пути;
2. поле помечено в `bind` — из указанного места;
3. остальные поля — из query для методов без тела (`GET`, `HEAD`,
   `DELETE`, `OPTIONS`, `TRACE`) и из тела для остальных.

У `POST /users` выше `name` и `email` читаются из тела. Те же поля,
присланные в query-строке, в payload не попадут: они дадут обычную ошибку
валидации. Слияния полей из нескольких мест нет.

```typescript
// packages/examples.simple-http-server/src/endpoints/search-users.endpoint.ts
import { httpEndpoint, query } from '@nestling/transport.http';

const SearchUsersInput = z.object({
  q: z.string().min(1),                     // GET: из query
  tag: z.array(z.string()).optional(),      // ?tag=a&tag=b
  limit: z.coerce.number().int().positive().optional(),
});

export const SearchUsers = httpEndpoint({
  method: 'GET',
  path: '/users',
  input: SearchUsersInput,
  output: SearchUsersOutput,
  bind: { tag: query({ multiple: true }) }, // массив даже при одном ?tag=a
  pipeline: makePipeline().pre(withTiming),
  handle: async (input: SearchUsersInput) => ({
    query: input.q,
    tags: input.tag ?? [],
    limit: input.limit ?? 20,
  }),
});
```

Повторяющийся query-ключ даёт массив в порядке следования, одно вхождение —
скаляр, ноль вхождений — отсутствующее поле. Пометка `query({ multiple:
true })` делает поле массивом всегда. Query-строка несёт только строки,
поэтому приведение к числам и булевым делает схема: `z.coerce`,
`z.stringbool()`. Тело читается только тогда, когда его требует карта
размещения: у `GET` без пометок `body()` оно не буферизуется вовсе.

Для проверки подписей webhook'ов есть опция `rawBody: true`: сырые байты
тела попадают в типизированный стартовый контекст. Пример — в
[гайде с DI](./http-app-di.md#сырые-байты-тела-rawbody-и-webhook-подписи).

`makeDispatch()` принимает только декларации без зависимостей. У endpoint'а
с `deps`, классом-хендлером или классами-юнитами в пайплайне тип содержит
неразрешённые зависимости, и `makeDispatch` его не примет: это ошибка
компиляции. Разрешить зависимости вручную можно вызовом
`endpoint.resolve(resolver)`; для формы с `deps` подходит и позиционный
`endpoint.resolve([...])`.

zod в примерах — один из вариантов. Ядро принимает любую схему
[Standard Schema](https://standardschema.dev): valibot, arktype, TypeBox,
Effect Schema. Отказ валидации возвращает `400` с `details` вида
`[{ message, path }]`; эту форму гарантирует спецификация, а не вендор.
Асинхронные refinement'ы в схемах endpoint'ов запрещены: валидация всегда
синхронна.

## Формы io: значение, поток, multipart

Верхний уровень `input` и `output` — **форма**, а схемы — её листья. Схема
без обёртки, как во всех примерах выше, означает форму значения. Поток и
multipart объявляются явно. От формы зависят парсинг запроса, framing ответа
и media type.

### Потоковый вход

```typescript
// packages/examples.simple-http-server/src/endpoints/stream-logs.endpoint.ts
import { makePipeline, stream } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

const LogLevel = z.enum(['info', 'warn', 'error']);
const LogChunk = z.object({
  timestamp: z.number(),
  level: LogLevel,
  message: z.string(),
});

const MAX_LOG_LINES = 50_000;   // `.limit`: сверх него — 413
const LOG_GAP_TIMEOUT = 30_000; // `.gapTimeout`: пауза дольше — 504

export const StreamLogs = httpEndpoint({
  method: 'POST',
  path: '/logs/stream',
  // NDJSON: по одному JSON-объекту на строку. Лимит и таймаут молчания
  // объявлены на декларации, а не написаны в хендлере
  input: stream(LogChunk).limit(MAX_LOG_LINES).gapTimeout(LOG_GAP_TIMEOUT),
  output: z.object({ processed: z.number(), summary: z.record(LogLevel, z.number()) }),
  pipeline: makePipeline().pre(withTiming),
  handle: async (payload: AsyncIterableIterator<LogChunk>) => {
    const stats = { info: 0, warn: 0, error: 0 };
    let processed = 0;

    for await (const chunk of payload) {
      stats[chunk.level]++;
      processed++;
    }

    return { processed, summary: stats };
  },
});
```

Каждый элемент потока проверяется схемой-листом до того, как попадёт в
цепочку. Этим занимается ядро, а не транспорт и не хендлер. По умолчанию
действует `{ validate: true, onInvalid: 'fail' }`: невалидная строка даёт
`400 VALIDATION_FAILED`. Чтобы отключить проверку, передайте
`stream(LogChunk, { validate: false })`; чтобы пропускать невалидные
элементы — `{ onInvalid: 'skip' }`.

`.limit(n)` отвечает отказом `413 STREAM_LIMIT_EXCEEDED`, `.gapTimeout(ms)`
— `504 STREAM_GAP_TIMEOUT`. Это коды ядра: объявлять их в `errors:` не
нужно, и проверка на границе пайплайна не превращает их в `500 UNKNOWN`.

### Потоковый ответ

```typescript
// packages/examples.simple-http-server/src/endpoints/export-logs.endpoint.ts
export const ExportLogs = httpEndpoint({
  method: 'GET',
  path: '/logs/export',
  output: stream(LogLine).limit(1000),     // только шаги, сохраняющие тип
  pipeline: makePipeline().pre(withTiming),
  handle: async () => new Ok(generate(5)), // обычный AsyncIterable
});
```

Хендлер возвращает обычный `AsyncIterable`. Транспорт отдаёт его как
`application/x-ndjson` с chunked-кодированием; заголовки вручную ставить не
нужно. Выходная цепочка может только сохранять тип элемента (`T → T`),
потому что оба её конца зафиксированы схемой `output`. Поэтому
`.batch(100)` на выходе — ошибка компиляции в точке декларации. Открытую
подписку (SSE) объявляют формой `events(T)`; пример с DI и `Topic` — в
[гайде по App](./http-app-di.md).

У потокового endpoint'а `.finally` вызывается после того, как поток
завершился или оборвался. К этому моменту исход известен точно, а
`ctx.summary.itemsOut` уже досчитан.

### Загрузка файлов

```typescript
// packages/examples.simple-http-server/src/endpoints/upload-report.endpoint.ts
import type { FilePart } from '@nestling/pipeline';
import { makePipeline, multipart, upload } from '@nestling/pipeline';

const MiB = 1024 * 1024;

export const UploadReport = httpEndpoint({
  method: 'POST',
  path: '/reports',
  input: multipart({
    fields: z.object({ title: z.string().min(1) }),
    files: { report: upload({ maxSize: 2 * MiB, mime: ['application/pdf'] }) },
  }),
  output: UploadReportOutput,
  pipeline: makePipeline().pre(withTiming),
  handle: async (payload: {
    fields: { title: string };
    files: { report: FilePart };
  }) => {
    const { report } = payload.files;

    return { title: payload.fields.title, filename: report.filename, mime: report.mime };
  },
});
```

- Payload имеет вид `{ fields, files }`. Файлы лежат под именами
  объявленных полей: `upload()` даёт один `FilePart`, `upload({ multiple:
  true })` — массив.
- Лимит размера и фильтр MIME объявлены на самом поле и применяются во
  время разбора: файл сверх `maxSize` отвергается с `413`, не дожидаясь
  конца буферизации; файл с чужим MIME отвергается с `400` до чтения тела.
- Форма закрыта: незаявленное файловое поле и второй файл в поле без
  `multiple` дают `400`.
- Path-параметры и поля с пометкой `query()` добавляются к `fields`.

```bash
curl -N http://localhost:3000/logs/export
curl -F title=Q3 -F 'report=@q3.pdf;type=application/pdf' http://localhost:3000/reports
```

## Юниты и фазы

Пайплайн — один слой из фаз. Вид каждого юнита виден в декларации, и она
читается сверху вниз как порядок исполнения:

| Метод | Когда вызывается | Контекст |
|---|---|---|
| `.pre(u)` | до хендлера, по порядку объявления | накопленный, полный |
| `.ok(u)` | ответ — успех | полный: все `.pre` выполнились |
| `.catch(u)` | ответ — `Fail` | свой слой как `Partial`: часть `.pre` могла не выполниться |
| `.finally(u)` | всегда, последним, с исходом | свой слой как `Partial` |

Pre-юнит — функция, которая добавляет данные в контекст. Контекст только
растёт, и компилятор проверяет, что каждый следующий юнит получает всё,
что положили предыдущие:

```typescript
// packages/examples.simple-http-server/src/common/middleware.ts
import type { EmptyInput, PreUnitFn } from '@nestling/pipeline';

export const withTiming: PreUnitFn<EmptyInput, { timestamp: number }> =
  async () => ({ timestamp: Date.now() });

// подключение: makePipeline().pre(withTiming)
```

Ответные юниты получают текущий ответ и могут заменить его: `.ok` — успех
на успех, `.catch` — ошибку на ошибку. `.finally` наблюдает исход
(`completed`, `disconnected`, `aborted` или `failed`) и ответ не меняет:

```typescript
const audited = makePipeline()
  .pre(withTiming)
  .catch((res) => ({ ...res, value: { error: mapMessage(res.value.error) } }))
  .finally((outcome, _res, ctx) => {
    console.log(`${ctx.raw.pattern}: ${outcome}`);
  });
```

Слои складываются константами: `compose(outer, ..., inner)` перечисляет их
снаружи внутрь. Требования слоя к внешнему контексту объявляются
параметром типа, `makePipeline<{ identity: User }>()`, и проверяются
компилятором в точке композиции. Пример композиции — в
`examples.app-with-http` (`src/common/pipelines.ts`).

## Запуск

```typescript
// packages/examples.simple-http-server/src/main.ts
import { makeDispatch } from '@nestling/transport';
import { HttpTransport } from '@nestling/transport.http';
import { CreateUser, StreamLogs } from './endpoints';

const server = new HttpTransport({ port: Number(process.env.PORT) || 3000 });

// Все маршруты передаются транспорту одним объектом
const dispatch = makeDispatch([CreateUser, StreamLogs]);
const shutdown = new AbortController();

await server.serve(dispatch, shutdown.signal);

// В standalone-режиме нет App, поэтому остановку вы пишете сами:
// сигнал отменяет текущие запросы, close() закрывает соединения
process.on('SIGINT', async () => {
  shutdown.abort();
  await server.close();
  process.exit(0);
});
```

## Следующий шаг

Когда понадобятся DI, модули и хуки жизненного цикла, переходите на
[`assemble` и модули](./http-app-di.md). Декларация при этом не меняется:
к ней добавляются `deps` или класс-хендлер, а разрешение зависимостей и
построение `dispatch` берёт на себя приложение
([composition.md](./composition.md)).

## Смотри также

- [design/pipeline.md](../design/pipeline.md) — модель пайплайна: фазы,
  слои, композиция
- [decisions/ideas.md](../decisions/ideas.md), запись «Pipeline v2» — почему
  модель устроена именно так
