# @nestling/transport.http

HTTP-транспорт Nestling на `node:http`: маршрутизация через `find-my-way`,
разбор тела запроса по io-декларации endpoint'а (JSON, сырые байты, NDJSON,
multipart через `busboy`) и выбор формата ответа по той же декларации:
NDJSON для `stream(T)`, SSE для `events(T)`.

> 🚧 Активная разработка, API может меняться. CORS, ограничение частоты
> запросов и сжатие пока не реализованы. Валидатора среди зависимостей нет:
> транспорт проверяет данные через `@nestling/pipeline` любой схемой
> [Standard Schema](https://standardschema.dev).
> Дизайн: [`docs/design/transports.md`](../../docs/design/transports.md).
> Гайды: [HTTP без DI](../../docs/guides/http-functional.md),
> [приложение с DI](../../docs/guides/http-app-di.md),
> [composition root](../../docs/guides/composition.md).

## Установка

```bash
npm install @nestling/transport.http
```

## Минимальный пример

```ts
import { assemble } from '@nestling/app';
import { Ok } from '@nestling/pipeline';
import { http, httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: z.object({ id: z.string() }),      // id берётся из пути
  output: z.object({ id: z.string(), name: z.string() }),
  handle: async ({ id }) => new Ok({ id, name: 'Alice' }),
});

await assemble({
  features: [UsersFeature],                 // фича, где объявлен GetUser
  transports: [http({ port: 3000 })],       // провайдер, а не инстанс
}).run();
```

Без `assemble` транспорт запускается вручную: `serve(dispatch, signal)`
(раздел «Запуск»).

## Декларация endpoint'а

`httpEndpoint` принимает две формы одной декларации.

**Анонимная форма** описывает адрес и схемы на месте:

```ts
httpEndpoint({ method, path, input, output, errors, bind, rawBody, sse, pipeline, deps, doc, handle, detached });
```

Это тонкий слой над `makeEndpoint` из `@nestling/pipeline`: он добавляет
HTTP-поля и собирает `pattern` как `` `${method} ${path}` ``. `path` —
литеральный тип; `PathParams<Path>` выводит из него имена `:param`.

**Контрактная форма** берёт адрес, схемы, `errors` и `doc` из операции
с секцией `http:`:

```ts
httpEndpoint({ operation: CreateUser, deps, pipeline, handle, detached });
```

Поля `method`, `path`, `bind`, `rawBody`, `sse`, `input`, `output`,
`errors` и `doc` в этой форме объявлены как `never`: повторить их рядом с
операцией — ошибка компиляции, а для JS-потребителя — ошибка выполнения.
Bind-карта переносится из операции тем же значением, а не вычисляется
заново.

Декларация проверяется в момент создания. Пустой `path`, `path` без
ведущего `/`, повторный path-параметр, неверная секция `doc:` и нарушение
любого правила размещения из следующего раздела бросают ошибку сразу, а не
на первом запросе. Поле `doc:` транспорт не читает, а только передаёт в
`makeEndpoint`; его читает генератор документации
([`@nestling/openapi`](../nestling.openapi)).

## Размещение полей входа

Где в запросе лежит каждое поле `input`, определяет правило:

1. имя поля совпадает с path-параметром (`:id`) — поле берётся из пути;
2. поле помечено в `bind` — из указанного места;
3. остальные поля — из query для методов без тела (`GET`, `HEAD`,
   `DELETE`, `OPTIONS`, `TRACE`) и из тела для остальных.

```ts
import { httpEndpoint, query } from '@nestling/transport.http';

export const CreateMember = httpEndpoint({
  method: 'POST',
  path: '/orgs/:orgId/members',
  input: MemberInput,                 // orgId из пути, name из тела
  bind: { dryRun: query(), tags: query({ multiple: true }) },
  …
});
```

- Пометки `query(options?)` и `body()` — значения, а не строки; форма
  `{ expand: 'query' }` отклоняется. Ключи `bind` типизированы полями
  схемы за вычетом path-параметров: опечатка и пометка на path-параметре —
  ошибки компиляции.
- Пометки и bind-карту экспортирует
  [`@nestling/operations`](../nestling.operations); этот пакет их
  реэкспортирует, так что автор декларации импортирует их вместе с
  `httpEndpoint`.
- Bind-карта вычисляется при создании декларации и доступна как
  `httpBindingOf(definition)`. Клиент, который импортирует только операция,
  получает её без серверного кода.
- Payload собирается только из канонических мест с приоритетом
  «путь, затем пометка, затем остальное». Поле, присланное не туда, в
  payload не попадает и падает обычной ошибкой валидации. Слияния
  «поле принимается отовсюду» нет.
- Повторный query-ключ даёт массив в порядке появления.
  `query({ multiple: true })` даёт массив даже при одном вхождении. Если
  вхождений нет, поле отсутствует, и допустимо ли это, решает схема.
  Преобразование строк (`?page=2` в число) делает схема (`z.coerce`).
- Тело читается только когда оно нужно карте: остаток полей идёт в тело,
  есть пометка `body()` или задан `rawBody`. Тело `GET`-запроса не
  буферизуется.
- Ошибки при создании декларации: пометка на path-параметре; `body()` у
  метода без тела; `bind` или path-параметр при неструктурном `input`
  (потоковая форма, примитив); path-параметр без `input`; `rawBody` вместе
  с потоковой или multipart-формой; секция `sse` без выхода `events`;
  `sse.event`, дающий зарезервированное имя `error`. У `multipart`
  структурная часть — `fields`: path-параметры и помеченные query-поля
  попадают в неё.

### `rawBody`: сырые байты в контексте

`rawBody: true` кладёт нетронутые байты запроса в стартовый контекст
(`{ rawBody: Uint8Array }`). Это нужно проверке подписи вебхука (HMAC):
повторно сериализованный JSON дал бы другой хеш.

```ts
export const Hook = httpEndpoint({
  method: 'POST',
  path: '/hooks/stripe',
  input: HookEvent,
  rawBody: true,        // без этого поля пайплайн ниже не скомпилируется
  pipeline: compose(
    makePipeline<{ rawBody: Uint8Array }>().pre(verifySignature(secret)),
    basePipeline,
  ),
  …
});
```

Забытое поле — ошибка компиляции в декларации, а не 500 в рантайме: тип
стартового контекста зависит от `rawBody`, и слот `pipeline` его
проверяет. Диагностика имеет ту же форму, что у остальных ошибок пайплайна,
плюс `hint` с подсказкой:

```
'{ __error: "Pipeline requires context that the start context does not
provide"; missing: { rawBody: Uint8Array; }; hint: "declare 'rawBody: true',
or provide the fields from an outer layer"; }'
```

Тело читается один раз: значение разбирается из тех же байтов.
`maxBodySize` действует как обычно.

## Потоки: NDJSON, SSE, multipart

Транспорт объявляет, какие формы io он умеет, и регистрация проверяется
по этому списку до открытия сокета:

```ts
capabilities = {
  input:  new Set(['value', 'stream', 'multipart']),
  output: new Set(['value', 'stream', 'events']),
};
```

| Форма | Как передаётся |
|---|---|
| `stream(T)` на выходе | `application/x-ndjson`, chunked, один JSON на строку |
| `events(T)` на выходе | `text/event-stream` с `cache-control: no-cache` |
| `stream(T)` на входе | NDJSON декодируется в поток значений; поэлементную валидацию, item-цепочку и счётчики выполняет ядро (`bindInputStream`) |
| `multipart({ fields, files })` на входе | файлы приходят под объявленными именами полей |

Поля SSE-кадра задаёт секция `sse` декларации:

```ts
export const Activity = httpEndpoint({
  method: 'GET',
  path: '/activity/live',
  output: events(ActivityEvent),
  sse: { id: (e) => e.id, event: (e) => e.kind, heartbeat: 15_000 },
  handle: (hub) => async (_p, meta: { signal: AbortSignal; lastEventId?: string }) =>
    new Ok(hub.subscribe(meta.signal)),
});
```

Heartbeat по умолчанию равен опции транспорта `sseHeartbeat` (15 с; `0`
выключает). Он пишется как SSE-комментарий и не считается элементом.
Заголовок `Last-Event-ID` попадает в стартовый контекст (`lastEventId?:
string`) любой декларации с выходом `events`, тем же механизмом, что
`rawBody`.

Ограничения `upload({ maxSize, mime })` проверяются во время разбора
multipart: файл больше лимита прерывает своё чтение (`413`), неверный MIME
отклоняется до чтения тела (`400`), необъявленное файловое поле и второй
файл в одиночном поле отклоняются (`400`).

**Ошибка посреди потока.** После отправки заголовков статус изменить
нельзя, поэтому NDJSON-ответ обрывается (клиент видит незавершённое
chunked-тело), а SSE-ответ получает кадр `event: error` с телом отказа
перед закрытием соединения. В обоих случаях `.finally` видит `failed`, а
незадекларированный отказ заменяется на `UnknownError` как обычно.

При разрыве соединения, ошибке записи и `close()` транспорт закрывает
итератор ответа (`return()`). Это запускает отложенные `.finally`-юниты и
отписывает подписки `Topic`. Входные потоки при ошибке дочитываются, чтобы
соединение не осталось наполовину прочитанным.

## Запуск: `serve(dispatch, signal)`

```ts
const server = new HttpTransport({ port: 3000 });
const shutdown = new AbortController();

await server.serve(makeDispatch([SayHello, CreateUser]), shutdown.signal);
```

`serve` — единственный способ начать приём запросов: метода `listen()` и
регистрации отдельных endpoint'ов нет. Маршруты приходят проекциями в
`dispatch.routes`, а endpoint выполняет `dispatch.call`. Транспорт отвечает
только за разбор запроса, формат ответа и `sendResponse`. Под `assemble`
тот же `dispatch` собирается на фазе WIRE.

`address()` возвращает фактический адрес после запуска и `null` до `serve`
и после `close()`. Это нужно тестам с `port: 0`: `serve` не принимает
хост и порт аргументами.

`makeDispatch` принимает только готовые к запуску декларации: сначала
получите зависимости (`endpoint.resolve(...)`) или объявите endpoint в
модуле и запустите его под `assemble`.

## Провайдер `http(options?)`

```ts
await assemble({ features: [UsersFeature], transports: [http({ port: 3000 })] }).run();
```

`http()` возвращает провайдер, а не инстанс. Транспорт — обычный узел
графа: контейнер инжектит его зависимости, а жизненный цикл идёт вместе с
остальными. Порт и хост приходят из секции конфига пакета (`HTTP_PORT`,
`HTTP_HOST`). Приоритет: явные опции фабрики, затем конфиг, затем
значение по умолчанию. Наружу экспортируется только `httpConfigKeys`;
токен секции остаётся приватным.

## Безопасность и лимиты

По умолчанию транспорт можно открывать наружу.

- **Внутренние ошибки скрыты.** Необработанные исключения и
  незадекларированные отказы возвращают `{ "error": "Internal server
  error", "code": "UNKNOWN" }` со статусом `500`, без `message` и `stack`.
  Опция `exposeErrorDetails: true` раскрывает их (только для разработки).
  Задекларированный отказ (его `code` есть в `errors:` endpoint'а или это
  код ядра) сохраняет `message`, `code` и `details`. Оригинал
  заменённого отказа передаётся в `onUnknownFail` (по умолчанию
  `console.error`).
- Размер тела ограничен. Буферизуемые тела (JSON, raw, text) и длина
  строки NDJSON ограничены `maxBodySize` (по умолчанию 1 MiB); чтение
  прерывается заранее и возвращает `413`. `maxBodySize: 0` снимает лимит.
  Файл multipart ограничен своим `upload({ maxSize })`, а без него —
  `maxBodySize`. Строка потокового входа длиннее лимита даёт отказ
  `PAYLOAD_TOO_LARGE` (413): лимит срабатывает во время чтения, уже внутри
  хендлера, поэтому отказ несёт код ядра. Heartbeat-комментарии в лимиты
  не входят.
- Ошибки входа дают 4xx: некорректный JSON — `400`, слишком большой
  payload — `413`.
- Семантические статусы переводятся в HTTP-коды здесь, а не в ядре:
  `CONFLICT` в 409, `PAYLOAD_TOO_LARGE` в 413, `TOO_MANY_REQUESTS` в 429,
  `TIMEOUT` в 504. `.limit(n)` и `.gapTimeout(ms)` item-цепочки дают 413
  и 504 через них же. Таблица экспортируется как `httpCodeOf(status)`; её
  же читает генератор OpenAPI.
- Ошибка проверки входа возвращает `400` с `"code":
  "VALIDATION_FAILED"` и `details` вида `[{ "message": "…", "path":
  ["name"] }]`. Это формат Standard Schema, без полей конкретного
  валидатора. Вход проверяет рантайм ядра, включая поля `multipart`,
  поэтому HTTP-запрос и `app.call` дают один результат. Асинхронная схема
  или объект, не являющийся Standard Schema, — ошибка конфигурации: они
  дают `500`, скрытый `exposeErrorDetails` как любая необработанная
  ошибка.
- Каждый запрос получает `meta.signal` (`AbortSignal`). Он срабатывает,
  когда клиент отключился до завершения ответа. Отмена кооперативная:
  долгие и потоковые хендлеры должны проверять сигнал.
- `close()` сначала взводит `meta.signal` всех активных запросов, затем
  перестаёт принимать соединения, закрывает простаивающие keep-alive
  соединения, ждёт завершения активных запросов до `closeTimeout` (по
  умолчанию 10 с) и закрывает оставшиеся принудительно. Открытые
  `events`-соединения завершаются так же: сигнал закрывает итератор
  ответа, и `.finally` видит `aborted`.

## Справочник

### Экспорты

| Имя | Что это |
|---|---|
| `httpEndpoint(declaration)` | конструктор декларации (анонимная и контрактная формы) |
| `http(options?)` | провайдер транспорта для `transports:` или `providers:` |
| `HttpTransport` | класс транспорта для ручного запуска |
| `HttpTransport$('default')`, `HTTP_TRANSPORT_NAME` | токен транспорта и его короткое имя `'http'` |
| `query(options?)`, `body()` | пометки размещения полей (реэкспорт из `@nestling/operations`) |
| `httpBindingOf(definition)` | bind-карта декларации |
| `httpCodeOf(status)` | HTTP-код для семантического статуса |
| `httpConfigKeys` | ключи секции конфига `HTTP_PORT`, `HTTP_HOST` |
| `PathParams<Path>` | тип имён `:param` из шаблона пути |
| `JsonParseError`, `PayloadTooLargeError`, `ChunkTooLargeError`, `MultipartFieldError` | ошибки разбора запроса |

### Опции `HttpTransport`

```ts
new HttpTransport({
  port: 3000,
  host: '0.0.0.0',
  maxBodySize: 1024 * 1024,   // байт; 0 снимает лимит
  exposeErrorDetails: false,  // раскрывать message и stack необработанных ошибок
  onUnknownFail: undefined,   // получает оригинал заменённого отказа; по умолчанию console.error
  requestTimeout: undefined,  // server.requestTimeout из node:http (мс)
  headersTimeout: undefined,  // server.headersTimeout (мс)
  keepAliveTimeout: undefined,// server.keepAliveTimeout (мс)
  closeTimeout: 10_000,       // ожидание активных соединений при close() (мс)
  sseHeartbeat: 15_000,       // период heartbeat-комментариев SSE (мс); 0 выключает
});
```

Таймауты, не заданные явно, берут значения по умолчанию из Node.
`close({ timeout })` принимает разовое значение вместо `closeTimeout`.

## Границы пакета

Пакет не реализует CORS, сжатие и ограничение частоты запросов; `events`
на входе и `multipart` на выходе не поддерживаются.
