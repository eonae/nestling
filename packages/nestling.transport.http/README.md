# @nestling/transport.http

HTTP-транспорт Nestling на `node:http`: маршрутизация через `find-my-way`,
разбор тела запроса по io-декларации endpoint'а (JSON, сырые байты, NDJSON,
multipart через `busboy`) и выбор формата ответа по той же декларации:
NDJSON для `stream(T)`, SSE для `events(T)`.

> 🚧 Активная разработка, API может меняться. CORS, ограничение частоты
> запросов и сжатие пока не реализованы. Валидатор для схем приложения
> пакет не выбирает: данные проверяет `@nestling/app` любой схемой
> [Standard Schema](https://standardschema.dev). Пакет `zod` в
> зависимостях нужен только конфиг-секции сервера (`HTTP_PORT`,
> `HTTP_HOST`).
> Дизайн: [`docs/design/transports.md`](../../docs/design/transports.md).
> Гайды: [глава 1. Поднять сервис, который отвечает на запрос](../../docs/guide/01-first-service.md),
> [глава 6. Хендлеру нужен репозиторий](../../docs/guide/06-repository.md),
> [глава 13. Выделить вторую область](../../docs/guide/13-features.md).

## Установка

```bash
npm install @nestling/transport.http
```

## Минимальный пример

```ts
import { makeApp } from '@nestling/app';
import { Ok } from '@nestling/app';
import { http, httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: z.object({ id: z.string() }),      // id берётся из пути
  output: z.object({ id: z.string(), name: z.string() }),
  handler: async ({ id }) => new Ok({ id, name: 'Alice' }),
});

await makeApp({
  features: [UsersFeature],                 // фича, где объявлен GetUser
  transports: [http()],                     // объявление, а не инстанс
}).assemble().run();
```

Порт и хост приходят из `HTTP_PORT` и `HTTP_HOST`: сокет держит сервер,
которого `http()` объявляет сам (раздел «Сервер»).

Без `makeApp` транспорт и сервер поднимаются вручную: `serve(dispatch,
signal)` и `listen()` (раздел «Запуск»).

## Декларация endpoint'а

`httpEndpoint` принимает две формы одной декларации.

**Анонимная форма** описывает адрес и схемы на месте:

```ts
httpEndpoint({ method, path, input, output, errors, bind, rawBody, sse, pipeline, doc, handler, detached });
```

Это тонкий слой над `makeEndpoint` из `@nestling/app`: он добавляет
HTTP-поля и собирает `pattern` как `` `${method} ${path}` ``. `path` —
литеральный тип; `PathParams<Path>` выводит из него имена `:param`.
Список `errors:` складывается с отказами слоёв пайплайна: перечислять
отказ слоя у endpoint'а не нужно.

**Форма с операцией** берёт адрес, схемы, `errors` и `doc` из операции
с секцией `http:`:

```ts
httpEndpoint({ operation: CreateUser, pipeline, handler, detached });
```

Поля `method`, `path`, `bind`, `rawBody`, `sse`, `input`, `output`,
`errors` и `doc` в этой форме объявлены как `never`: повторить их рядом с
операцией — ошибка компиляции, а для JS-потребителя — ошибка выполнения.
Bind-карта переносится из операции тем же значением, а не вычисляется
заново.

Отказы, объявленные слоями пайплайна, обязаны входить в `errors:`
операции. Слот `pipeline` принимает литерал `__error` с подсказкой, если
это не так, а конструктор бросает ошибку при создании декларации, называя
операцию и недостающие коды. Множество операции не расширяется
автоматически: операцию импортирует клиент, и пайплайна реализации он не
видит. Отказы ядра из проверки исключены.

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
  `httpBindingOf(definition)`. Клиент, который импортирует только операцию,
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
@Handler([ActivityHub])
class ActivityHandler {
  constructor(private readonly hub: ActivityHub) {}

  async handle(
    _payload: unknown,
    meta: { signal: AbortSignal; lastEventId?: string },
  ) {
    return new Ok(this.hub.subscribe(meta.signal));
  }
}

export const Activity = httpEndpoint({
  method: 'GET',
  path: '/activity/live',
  output: events(ActivityEvent),
  sse: { id: (e) => e.id, event: (e) => e.kind, heartbeat: 15_000 },
  handler: ActivityHandler,
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
незадекларированный отказ заменяется на `InternalError` как обычно.

При разрыве соединения, ошибке записи и `close()` транспорт закрывает
итератор ответа (`return()`). Это запускает отложенные `.finally`-юниты и
отписывает подписки `Topic`. Входные потоки при ошибке дочитываются, чтобы
соединение не осталось наполовину прочитанным.

## Запуск: `serve(dispatch, signal)` и `listen()`

```ts
const server = new HttpServer({ port: 3000, host: '0.0.0.0' });
const transport = new HttpTransport(server);
const shutdown = new AbortController();

await transport.serve(makeDispatch([SayHello, CreateUser]), shutdown.signal);
await server.listen();
```

`serve` — единственный способ начать обслуживать запросы: регистрации
отдельных endpoint'ов нет. Маршруты приходят проекциями в
`dispatch.routes`, а endpoint выполняет `dispatch.call`. Транспорт
отвечает только за разбор запроса, формат ответа и `sendResponse`. Под
`assemble` тот же `dispatch` собирается на фазе WIRE.

Сокет открывает сервер, и делает это после `serve`: к моменту `listen()`
обработчики присоединены, поэтому запрос не может прийти раньше, чем его
есть кому обслужить. Останавливается связка тем же порядком в реверсе:
`server.drain()` дочитывает открытые соединения, `transport.close()`
отменяет запросы в обработке.

`makeDispatch` принимает только готовые к запуску декларации: сначала
получите зависимости (`endpoint.resolve(...)`) или объявите endpoint в
модуле и запустите его под `assemble`.

## Сервер: `httpServer(options?)`

```ts
await makeApp({ features: [UsersFeature], transports: [http()] }).assemble().run();
```

Сокет держит сервер — отдельный узел графа, а не транспорт. Разделяемая
вещь именно сокет: два слушателя на один порт не биндятся, а транспортов
на одном порту бывает несколько.

`http()` без `server` объявляет собственный сервер с тем же именем, что у
транспорта, поэтому в корне про сервер не пишется ни строки. Явное
объявление нужно там, где на одном сокете работает больше одного
транспорта:

```ts
const api = httpServer({ name: 'api' });

await makeApp({
  features: [UsersFeature],
  transports: [api, http({ server: api }), graphql({ server: api })],
}).assemble().run();
```

Порт и хост сервер читает из секции по своему имени: `HTTP_PORT` и
`HTTP_HOST` у сервера по умолчанию, `HTTP_API_PORT` и `HTTP_API_HOST` у
`name: 'api'`. Опций адреса у фабрик нет: адрес меняется без пересборки
образа, поэтому он в конфиге. Наружу экспортируется только
`httpServerKeys(name?)`; DI-токен секции остаётся приватным.

Обработчики выстраиваются в цепочку в порядке присоединения. Запрос,
который не взял ни один транспорт, получает `404` от сервера.

`address()` сервера возвращает фактический адрес после `listen()` и
`null` до него и после дренажа. Это нужно тестам с `HTTP_PORT=0`.

## Безопасность и лимиты

По умолчанию транспорт можно открывать наружу.

- **Внутренние ошибки скрыты.** Необработанные исключения и
  незадекларированные отказы возвращают `{ "error": "Internal server
  error", "code": "UNKNOWN" }` со статусом `500`, без `message` и `stack`.
  Опция `exposeErrorDetails: true` раскрывает их (только для разработки).
  Задекларированный отказ (его `code` есть в `errors:` endpoint'а или это
  код ядра) сохраняет `message`, `code` и `details`. Оригинал
  заменённого отказа уходит записью `error` в логгер ядра: под `App` это
  `Logger$('nestling')`, без него — умолчание ядра в `stderr`.
- Размер тела ограничен. Буферизуемые тела (JSON, raw, text) и длина
  строки NDJSON ограничены `maxBodySize` (по умолчанию 1 MiB); чтение
  прерывается заранее и возвращает `413`. `maxBodySize: 0` снимает лимит.
  Файл multipart ограничен своим `upload({ maxSize })`, а без него —
  `maxBodySize`. Строка потокового входа длиннее лимита даёт отказ
  `payload_too_large` (413): лимит срабатывает во время чтения, уже внутри
  хендлера, поэтому отказ несёт код ядра. Heartbeat-комментарии в лимиты
  не входят.
- Ошибки разбора запроса дают 4xx с кодом ядра в теле: некорректный
  JSON и дефектное поле формы — `400` с `"code": "bad_request"`, слишком
  большой payload — `413` с `"code": "payload_too_large"` и
  `details.limit`.
- Категория отказа переводится в HTTP-код здесь, а не в ядре:
  `conflict` в 409, `payload_too_large` в 413, `too_many_requests` в 429,
  `timeout` в 504. `.limit(n)` и `.gapTimeout(ms)` item-цепочки дают 413
  и 504 через них же. Таблица экспортируется как `httpCodeOf(status)`;
  она принимает и статус успеха, и категорию отказа, и её же читает
  генератор OpenAPI.
- Отказ проверки входа возвращает `400` с `"code": "bad_request"` и
  `details` вида `[{ "message": "…", "path": ["name"] }]`. Это формат
  Standard Schema, без полей конкретного валидатора. Вход проверяет
  рантайм ядра, включая поля `multipart`, поэтому HTTP-запрос и
  `testApp.call` дают один результат. Асинхронная схема или объект, не
  являющийся Standard Schema, — ошибка конфигурации: они дают `500`,
  скрытый `exposeErrorDetails` как любая необработанная ошибка.
- Заголовки `Ok` пишутся в ответ как есть, после заголовков, которые
  транспорт ставит по форме `output`. Одноимённый заголовок хендлера
  перекрывает заголовок формы: `Ok.created(order, { 'content-type': … })`
  задаёт свой тип содержимого.
- `raw.pattern` контекста — строка `<метод> <путь>`, где путь взят из
  запроса как прислан клиентом, до `?`, без нормализации и декодирования.
  Поле информационное: его читают `.finally`-юниты для лога.
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
| `httpEndpoint(declaration)` | конструктор декларации (анонимная форма и форма с операцией) |
| `http(options?)` | объявление транспорта для `transports:` или `providers:` |
| `httpServer(options?)` | объявление сервера для `transports:` |
| `HttpTransport` | класс транспорта для ручного запуска |
| `HttpServer` | класс сервера: сокет, цепочка обработчиков, `address()` |
| `HttpTransport$('default')`, `HTTP_TRANSPORT_NAME` | DI-токен транспорта и его короткое имя `'http'` |
| `HttpServer$('default')` | DI-токен сервера |
| `query(options?)`, `body()` | пометки размещения полей (реэкспорт из `@nestling/operations`) |
| `httpBindingOf(definition)` | bind-карта декларации |
| `httpCodeOf(status)` | HTTP-код для статуса успеха или категории отказа |
| `httpServerKeys(name?)` | ключи секции сервера: `HTTP_PORT`, `HTTP_HOST` |
| `HTTP_CAPABILITIES` | формы io транспорта; их же отдаёт `HttpTransport.capabilities` |
| `PathParams<Path>` | тип имён `:param` из шаблона пути |
| `JsonParseError`, `PayloadTooLargeError`, `MultipartFieldError` | ошибки разбора запроса |

### Опции `HttpTransport` и `HttpServer`

```ts
new HttpTransport(server, {
  maxBodySize: 1024 * 1024,   // байт; 0 снимает лимит
  exposeErrorDetails: false,  // раскрывать message и stack необработанных ошибок
  sseHeartbeat: 15_000,       // период heartbeat-комментариев SSE (мс); 0 выключает
});

new HttpServer({
  port: 3000,                 // под `assemble` приходит из HTTP_PORT
  host: '0.0.0.0',            // под `assemble` приходит из HTTP_HOST
  requestTimeout: undefined,  // server.requestTimeout из node:http (мс)
  headersTimeout: undefined,  // server.headersTimeout (мс)
  keepAliveTimeout: undefined,// server.keepAliveTimeout (мс)
  closeTimeout: 10_000,       // ожидание активных соединений при drain() (мс)
});
```

Опции сокета — у сервера, опции разбора запроса — у транспорта.
Таймауты, не заданные явно, берут значения по умолчанию из Node. Под
`assemble` таймауты задаются аргументом `httpServer({ … })`, а порт и
хост приходят из конфига.

Пакет рассчитан на Node 24. Замер относительно Fastify, Hono и Express —
`yarn bench:http`; результат и разбор разницы — `scripts/bench/README.md`
и запись ideas.md [2026-09-05].

## Границы пакета

Пакет обещает:

- **HTTP/1.1 поверх `node:http`.** Стороннего HTTP-сервера под капотом
  нет.
- **Формы io.** На входе `value`, `stream` и `multipart`; на выходе
  `value`, `stream` и `events`.
- **`rawBody`.** Байты запроса попадают в стартовый контекст одним
  чтением, из них же разбирается значение.
- **Лимиты тела и файлов.** `maxBodySize` ограничивает буферизуемое тело
  и строку NDJSON, `upload({ maxSize, mime })` — файл multipart.
- **Таймауты `node:http`.** `requestTimeout`, `headersTimeout` и
  `keepAliveTimeout` задаются опциями сервера.
- **Дренаж соединений при остановке.** `drain()` сервера ждёт активные
  запросы до `closeTimeout`, затем закрывает оставшиеся соединения;
  `close()` транспорта отменяет запросы в обработке.
- **Адрес из секции конфига.** Порт и хост приходят из `HTTP_PORT` и
  `HTTP_HOST`; фактический адрес после старта даёт `address()` сервера.

В пакет не входят:

- **HTTP/2 и WebSocket.** Их берёт на себя обратный прокси перед сервисом
  или отдельный транспорт.
- **TLS-терминация.** Её берёт на себя обратный прокси.
- **`events` на входе и `multipart` на выходе.** Декларация с такой
  формой отвергается на сборке, до открытия сокета.

CORS, сжатие и ограничение частоты запросов пока не реализованы.

### Байтовые части — публичная поверхность

Транспорт поверх другого HTTP-сервера собирается из экспортов пакета и
не трогает ни его, ни ядро:

| Часть | Экспорт |
|---|---|
| разбор тела по форме io | `readBody`, `parseJson`, `parseRaw`, `parseNdjson`, `parseMultipartForm` |
| чтение bind-карты | `httpBindingOf`, `readQuery`, `assemblePayload`, `bindingNeedsBody` |
| таблица статусов | `httpCodeOf` |
| кадрирование NDJSON и SSE | `sendResponse` |
| формы io транспорта | `HTTP_CAPABILITIES` |
| поиск маршрута | `HttpRouter` |

Рабочий пример такого транспорта — `src/satellite.integration.spec.ts`:
он поднимает свой `node:http`-сервер и отвечает на `GET` и `POST` тем же,
чем `HttpTransport`. Не хватает части — добавляется экспорт, а не
обходной код у автора транспорта.
