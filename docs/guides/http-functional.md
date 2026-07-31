# HTTP-сервер без DI: standalone-транспорт

✅ **Статус: актуально** — сверено с кодом `examples.simple-http-server`
(2026-07-31). Канон деклараций — per-transport конструкторы (`httpEndpoint`),
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
`Ok.created(...)`.

Отказ — тоже значение: он объявляется `defineFail`, перечисляется в
`errors:` декларации и отдаётся возвратом или броском — для ответа это
одно и то же. Возврат отказа вне объявленного множества — ошибка
компиляции, а отказ, доехавший до границы незадекларированным, клиент
получит как `UNKNOWN`/500:

```typescript
export const EmailTaken = defineFail('EMAIL_TAKEN', {
  status: 'CONFLICT',                        // → HTTP 409
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} already taken`,
});

export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/users',
  input: CreateUserInput,
  output: CreateUserOutput,
  errors: [EmailTaken],
  pipeline: makePipeline().pre(withTiming).pre(validate()),
  handle: async (input): Output<CreateUserOutput, ReturnType<typeof EmailTaken>> =>
    taken.has(input.email)
      ? EmailTaken({ email: input.email })
      : { message: 'User created', user: { id: nextId(), ...input } },
});
```

Подробности модели — [design/errors.md](../design/errors.md).

## Куда попадают поля запроса

Размещение полей `input` по частям запроса — детерминированное правило:
имя поля совпало с path-параметром шаблона → **путь**; поле помечено в
`bind` → указанное место; всё остальное → **query** для методов без тела
(`GET`, `HEAD`, `DELETE`, `OPTIONS`, `TRACE`) и **тело** для остальных.
У `POST /users` выше `name` и `email` читаются из тела; те же поля,
присланные в query-строке, в payload не попадут и дадут обычную ошибку
валидации — приём strict, слияния «отовсюду» нет.

```typescript
import { httpEndpoint, query } from '@nestling/transport.http';

const SearchUsersInput = z.object({
  q: z.string().min(1),                     // GET → query
  tag: z.array(z.string()).optional(),      // ?tag=a&tag=b
  limit: z.coerce.number().int().positive().optional(),
});

export const SearchUsers = httpEndpoint({
  method: 'GET',
  path: '/users',
  input: SearchUsersInput,
  output: SearchUsersOutput,
  bind: { tag: query({ multiple: true }) }, // массив и при одном ?tag=a
  pipeline: makePipeline().pre(withTiming).pre(validate()),
  handle: async (input: SearchUsersInput) => ({
    query: input.q,
    tags: input.tag ?? [],
    limit: input.limit ?? 20,
  }),
});
```

Повтор query-ключа даёт массив в порядке следования, одно вхождение —
скаляр (пометка `multiple` делает массив всегда), ноль вхождений — поля
нет. Коерсию провод-строк в числа и булевы делает схема (`z.coerce`,
`z.stringbool()`). Тело читается только тогда, когда его требует карта: у
`GET` без `body()`-пометок оно не буферизуется вовсе.

Для webhook-подписей есть `rawBody: true` — сырые байты тела в
типизированном стартовом контексте
([гайд с DI](./http-app-di.md#сырые-байты-тела-rawbody-и-webhook-подписи)).

`makeDispatch()` принимает **только deps-free декларации**: у ручки с
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

## Формы io: значение, поток, multipart

Верхний уровень `input`/`output` — **форма**, листья — схемы. Схема без
обёртки (как во всех примерах выше) — это форма значения; поток и
multipart объявляются явно, и от формы зависит и парсинг, и framing
ответа, и media type.

### Streaming-вход

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
  // NDJSON: по одному JSON-объекту на строку; лимит и таймаут молчания —
  // item-цепочка на декларации, а не код в хендлере
  input: stream(LogChunk).limit(50_000).gapTimeout(30_000),
  output: z.object({ processed: z.number() }),
  pipeline: makePipeline(),
  handle: async (payload: AsyncIterableIterator<LogChunk>) => {
    let processed = 0;
    for await (const chunk of payload) processed++;
    return { processed };
  },
});
```

Каждый элемент валидируется схемой-листом **до** цепочки — этим занимается
ядро, а не транспорт и не хендлер. Дефолт — `{ validate: true, onInvalid:
'fail' }`: невалидная строка даёт `400 VALIDATION_FAILED`. Явный opt-out —
`stream(LogChunk, { validate: false })`, «пропускать невалидные» —
`{ onInvalid: 'skip' }`.

`.limit(n)` отказывает `413 STREAM_LIMIT_EXCEEDED`, `.gapTimeout(ms)` —
`504 STREAM_GAP_TIMEOUT`. Это kernel-коды, поэтому объявлять их в
`errors:` не нужно и страж границы не превращает их в `500 UNKNOWN`.

### Streaming-ответ

```typescript
export const ExportLogs = httpEndpoint({
  method: 'GET',
  path: '/logs/export',
  output: stream(LogLine).limit(1000),     // только тип-сохраняющие шаги
  pipeline: makePipeline(),
  handle: async () => new Ok(generate(5)), // обычный AsyncIterable
});
```

Хендлер возвращает обычный `AsyncIterable` — транспорт отдаёт
`application/x-ndjson`, chunked; заголовки руками ставить не нужно.
Выходная цепочка может быть только `T → T`: оба конца зафиксированы
схемой, поэтому `.batch(100)` здесь — ошибка компиляции **в точке
декларации**. Открытая подписка (SSE) объявляется формой `events(T)` —
пример с DI и `Topic` в [гайде по App](./http-app-di.md).

Для потоковой ручки `.finally` вызывается **после** того, как поток дотёк
или оборвался, — исход честен, а `ctx.summary.itemsOut` уже досчитан.

### Загрузка файлов

```typescript
import { multipart, upload } from '@nestling/pipeline';

export const UploadReport = httpEndpoint({
  method: 'POST',
  path: '/reports',
  input: multipart({
    fields: z.object({ title: z.string().min(1) }),
    files: { report: upload({ maxSize: 2 * MiB, mime: ['application/pdf'] }) },
  }),
  output: UploadReportOutput,
  pipeline: makePipeline(),
  handle: async (payload: {
    fields: { title: string };
    files: { report: FilePart };
  }) => ({ title: payload.fields.title, filename: payload.files.report.filename }),
});
```

- payload — `{ fields, files }`, файлы **по именам объявленных полей**:
  `upload()` даёт один `FilePart`, `upload({ multiple: true })` — массив;
- лимит и MIME-фильтр объявлены на самом поле и применяются **во время**
  разбора: файл сверх `maxSize` не буферизуется целиком ради того, чтобы
  потом быть отвергнутым (`413`), чужой MIME отвергается до чтения тела
  (`400`);
- форма закрыта: незаявленное файловое поле и второй файл в поле без
  `multiple` отвергаются (`400`);
- path-параметры и помеченные query-поля подмешиваются к `fields`.

```bash
curl -N http://localhost:3000/logs/export
curl -F title=Q3 -F 'report=@q3.pdf;type=application/pdf' http://localhost:3000/reports
```

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
import { makeDispatch } from '@nestling/transport';
import { HttpTransport } from '@nestling/transport.http';
import { CreateUser, StreamLogs } from './endpoints';

const server = new HttpTransport({ port: Number(process.env.PORT) || 3000 });

// Маршруты приезжают одним объектом: своей копии исполнения у транспорта нет
const dispatch = makeDispatch([CreateUser, StreamLogs]);
const shutdown = new AbortController();

await server.serve(dispatch, shutdown.signal);

// graceful shutdown — вручную (в standalone-режиме App нет): сигнал
// отменяет in-flight, close() дренирует соединения
process.on('SIGINT', async () => {
  shutdown.abort();
  await server.close();
  process.exit(0);
});
```

## Куда расти

Когда появляется потребность в DI, модулях и lifecycle-хуках — переходи на
[`assemble` + модули](./http-app-di.md): декларация не меняется вообще, к
ней добавляются `deps` (или класс-хендлер), а гашение зависимостей и
построение `dispatch` берёт на себя приложение
([composition.md](./composition.md)).

> Модель пайплайна (фазы, слои, логика решений) подробно описана в
> [decisions/ideas.md](../decisions/ideas.md), раздел «Pipeline v2».
