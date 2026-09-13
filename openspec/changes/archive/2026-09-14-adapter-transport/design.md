## Context

`HttpTransport` уже не владеет сокетом. Сокет держит `HttpServer`, а
транспорт присоединяет к нему обработчик: в `serve()` он зовёт
`server.attach((req, res) => this.handle(req, res))`, и это **единственное**
обращение транспорта к серверу. Всё остальное — маршрутизация, разбор
входа, сборка контекста, `dispatch.call`, кадрирование ответа — от сокета
не зависит.

Значит «приложение как обработчик» отделяет от текущего кода одна вещь:
приёмник обработчика, который не открывает сокет, а отдаёт его наружу.

Вторая форма — `(Request) => Promise<Response>` — упирается в типы.
Кадрирование (`sendResponse`) пишет в `ServerResponse`, разбор
(`readBody`, `parseNdjson`, `parseMultipartForm`) читает
`IncomingMessage`. Классы `node:http` в этом коде используются неглубоко:
из ответа берутся `statusCode`, `setHeader`, `writeHead`, `write`, `end`,
`flushHeaders`, `destroy`, `destroyed`, `writableEnded`,
`writableFinished`, `headersSent` и событие `'close'`; из запроса —
`method`, `url`, `headers`, `socket.remoteAddress` и сам поток байтов.

Транспортов без сервера в сборке уже два: `cli()` и шина. Поле `server` у
`TransportDeclaration` необязательное, корень заводит сервер только по
ссылке из транспорта. Ничего нового в ядре под адаптер заводить не нужно —
кроме двух мелочей, названных ниже.

## Goals / Non-Goals

**Goals:**

- Собранное приложение отдаёт обработчик HTTP-запроса в двух формах:
  `(req, res) => Promise<boolean>` и `(Request) => Promise<Response>`.
- Обе формы обслуживают тот же набор форм io, что `http()`: `value`,
  `stream`, `events`, `multipart`, `rawBody`, включая SSE с heartbeat и
  отмену по разрыву соединения.
- Декларации `httpEndpoint` переезжают на адаптер без единой правки.
- Встроенное приложение не трогает сигналы чужого процесса.
- Байтовый путь запроса перестаёт зависеть от классов `node:http`: это
  делает будущую сборку под Workers работой одного дня, а не рефакторингом.

**Non-Goals:**

- Рантайм помимо Node. `multipart` читает `busboy`, тело собирается в
  `Buffer`, `fetch`-источник заворачивает `request.body` в
  `Readable.fromWeb`. Эти три места остаются.
- Префикс пути при монтировании.
- Подъём приложения первым запросом.
- HTTP-уровень в `testApp`: тестовый шов останавливается после WIRE и
  `serve()` транспортам не зовёт, поэтому адаптер там пуст (см. открытые
  вопросы).

## Decisions

### 1. Адаптер — приёмник обработчика вместо сервера

`HttpTransport` берёт в конструкторе не `HttpServer`, а интерфейс с одним
методом:

```typescript
export interface HttpAttach {
  attach(listener: HttpRequestListener): void;
}
```

`HttpServer` его уже реализует. Адаптер — второй реализующий:

```typescript
export class HttpAdapter implements ITransport {
  #listener?: HttpRequestListener;
  readonly #transport: HttpTransport;

  constructor(options: HttpTransportOptions = {}) {
    this.#transport = new HttpTransport(
      { attach: (listener) => void (this.#listener = listener) },
      options,
    );
  }

  serve(dispatch: Dispatch, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;

  /** Обработчик формы `node:http`; до `serve()` его нет */
  get node(): HttpRequestListener;

  /** Обработчик формы `fetch`; до `serve()` его нет */
  get fetch(): (request: Request) => Promise<Response>;
}
```

Композиция, а не наследование: адаптер не переопределяет ни одного метода
транспорта, ему нужен только доступ к обработчику. Разбор, маршрутизация
и кадрирование остаются в одном месте, поэтому расхождения между
`http()` и адаптером быть не может по устройству.

Фабрика объявляет узел без зависимостей и без сервера:

```typescript
export const adapter = <const Name extends string = 'default'>(
  options: HttpTransportOptions & { readonly name?: Name } = {},
): TransportDeclaration<Name> => { … };
```

DI-токен — тот же `HttpTransport$(name)`, способности — то же значение
`HTTP_CAPABILITIES`. Из этого следует: `adapter()` и `http()` с одним
именем в одной сборке дают занятый DI-токен, и контейнер отвергает сборку
сам. Отдельной проверки не нужно.

**Отвергнуто.** Свой класс `AdapterTransport` с копией `handle` — вторая
реализация разбора, которая разойдётся с первой на первой же правке.
Опция `http({ server: false })` — у одной фабрики появляется два смысла, а
у типа `ServerDeclaration | false` — ветка ради одного случая.

### 2. Имя `adapter()`

Короткое, уже названо так в d/13 §6.1, roadmap и ideas.md. Освобождает
внутреннее имя: модуль `adapter.ts` (кадрирование ответа) переименовывается
в `framing.ts` — он и есть кадрирование, а слово «адаптер» теперь занято
публичным понятием. Публичные экспорты (`sendResponse`, `httpCodeOf`) не
двигаются.

**Отвергнуто.** `handler()` — имя `HttpHandler` уже принадлежит интерфейсу
хендлера операции, и `handler:` — поле декларации; третий смысл у того же
слова. `mount()` — в Express и Koa монтирование означает префикс пути, а
префикса здесь нет.

### 3. Обработчик достаётся у запущенного приложения

```typescript
const app = makeApp({ features: [Users], transports: [adapter()] }).assemble();
await app.run({ signals: false });

export const handler = toFetchHandler(app);
```

`toNodeHandler(app, { name? })` и `toFetchHandler(app, { name? })` —
синхронные функции. Они берут экземпляр из нового свойства
`AssembledApp.transports`, проверяют, что это `HttpAdapter`, и возвращают
его обработчик.

Три отказа с названной причиной:

- приложение не в фазе RUN (`transports` пусто) — «позовите `run()` до
  `toNodeHandler()`»;
- транспорта с таким именем в сборке нет — перечислить, какие есть;
- транспорт есть, но это не адаптер — «`http('admin')` владеет сокетом;
  обработчик отдаёт `adapter('admin')`».

Свойство ядра:

```typescript
/** Экземпляры транспортов по имени; пусто до фазы INIT */
get transports(): ReadonlyMap<string, ITransport>;
```

Пара к существующему `servers` — тот же способ дотянуться до узла графа
снаружи, тем же обоснованием.

**Отвергнуто.** Доступ через само объявление (`const api = adapter();
api.node`) —
объявление стало бы изменяемым значением, а одно объявление переиспользуют
в нескольких сборках: обработчик второй сборки затирал бы первый.
Асинхронный `await toNodeHandler(app)`, поднимающий приложение сам, — это
второй жизненный цикл рядом с `run()`, и хозяину процесса не остаётся
места, где вызвать `close()`.

### 4. Опция `run({ signals })`

`run()` ставит обработчики `SIGTERM` и `SIGINT`. Внутри чужого процесса
это перехват: Node не завершает процесс по Ctrl+C, если на `SIGINT`
подписались, поэтому встроенное приложение ломало бы остановку хозяина.

```typescript
await app.run({ signals: false });
```

Умолчание — `true`: приложение-процесс не меняет поведения.

**Отвергнуто.** «Ставить сигналы, только если у сборки есть сервер» —
неявное правило, выведенное из состава: приложение с `cli()` тоже без
сокета, и подписка ему нужна. Отдельный метод `app.embed()` — второй вход
в те же фазы.

### 5. Интерфейсы `HttpSource` и `HttpSink` повторяют форму `node:http`

Пакет объявляет ровно то подмножество, которым пользуется:

```typescript
/** Запрос: то, что читают роутер, разбор входа и стартовый контекст */
export interface HttpSource extends AsyncIterable<Buffer> {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly socket?: { readonly remoteAddress?: string };
  pipe<T extends NodeJS.WritableStream>(destination: T): T;
}

/** Ответ: то, во что пишут кадрирование и отправка ошибки */
export interface HttpSink {
  statusCode: number;
  readonly headersSent: boolean;
  readonly writableEnded: boolean;
  readonly writableFinished: boolean;
  readonly destroyed: boolean;
  setHeader(name: string, value: string | number | readonly string[]): void;
  writeHead(status: number, headers: Record<string, unknown>): void;
  write(chunk: string | Buffer | Uint8Array, cb?: (e?: Error | null) => void): boolean;
  end(chunk?: string | Buffer): void;
  flushHeaders(): void;
  destroy(): void;
  on(event: 'close', listener: () => void): void;
}
```

`IncomingMessage` и `ServerResponse` удовлетворяют им как есть, поэтому на
пути `http()` не появляется ни одной обёртки на запрос. Это условие
названо прямо: в профиле горячего пути
([ideas.md [2026-09-05]](../../../docs/decisions/ideas.md)) на запрос
считали доли процента, и две аллокации на каждый ответ туда не проходят.

**Отвергнуто.** Нейтральная абстракция («обмен») с адаптерами по обе
стороны: она читается лучше, но добавляет пару объектов на каждый запрос
на пути, у которого этого бюджета нет.

### 6. Форма `fetch`: ответ уходит, как только известен статус

`FetchSink implements HttpSink` копит заголовки и отдаёт `Response`:

- `writeHead(status, headers)` и следом `end(body)` — ответ значения:
  `new Response(body, { status, headers })`;
- `flushHeaders()` (SSE) или первый `write` (NDJSON) — потоковый ответ:
  `new Response(stream, { status, headers })`, где `stream` —
  `ReadableStream`; дальнейшие `write` кладут кадр в контроллер, `end()`
  закрывает поток, `destroy()` рвёт его ошибкой;
- `write(chunk, cb)` зовёт `cb` после `enqueue` и возвращает
  `desiredSize > 0`, поэтому `writeChunk` кадрирования работает без
  правок и медленный клиент по-прежнему не превращается в буфер в памяти.

`toFetchHandler` не может дождаться `handle()`: у потокового ответа она
вернётся только после последнего кадра. Поэтому обработчик ждёт первым из
двух: `sink.response` (статус известен) или завершения `handle()`.
Завершилась `handle()`, а статуса нет — ответ `404 Not Found`, тем же
телом, что отдаёт `HttpServer` на непойманный маршрут.

Разрыв соединения: `request.signal` хозяина взводит событие `'close'`
приёмника, и дальше работает тот же код, что на сокете, —
`ClientDisconnectedError` в сигнале контекста.

`socket` у `fetch`-источника нет, поэтому `ctx.http.ip` — `undefined`.
За адресом клиента во встроенном приложении идут в заголовок
(`withClientIp` читает `x-forwarded-for`), и это записано в рецепте.

**Отвергнуто.** `Promise<Response | undefined>` с `undefined` на
непойманном маршруте: роут Next.js обязан вернуть `Response`, и хозяину
пришлось бы дописывать `?? new Response(null, { status: 404 })` в каждом
файле. Хозяину, который хочет провалиться дальше по своей маршрутизации,
доступна node-форма с её `false`.

### 7. Тело запроса в `fetch`-форме

`FetchSource implements HttpSource` строится из `Request`:
`method` и `headers` — из запроса, `url` — `pathname` с `search`
(роутер сравнивает путь, а не абсолютный адрес), поток — `Readable.fromWeb
(request.body)`. Запрос без тела даёт пустой поток.

Отсюда `pipe` в интерфейсе: `parseMultipartForm` передаёт поток в
`busboy`. Это же место — причина, по которой рантайм помимо Node вынесен
в non-goals: `busboy` и `Buffer` остаются, и честнее назвать это прямо,
чем обещать Workers, не имея прогона под Workers.

## Risks / Trade-offs

- **Дублирование кадрирования на двух приёмниках расходится.** →
  Интеграционный прогон сверяет три пути на одних и тех же декларациях:
  `http()` через сокет, node-форма адаптера, fetch-форма адаптера. Ответы
  сравниваются целиком — статус, `content-type`, тело. Ровно тем же
  способом, каким `satellite.integration.spec.ts` сверяет сторонний
  транспорт с `HttpTransport`.
- **Интерфейсы повторяют форму `node:http` и наследуют её странности**
  (`writeHead` рядом с `setHeader`, `destroy` рядом с `end`). → Это цена
  нулевой обёртки на горячем пути; интерфейсы внутренние по смыслу и
  экспортируются ради автора своего приёмника, а не ради прикладного кода.
- **`Readable.fromWeb` на каждый запрос с телом дороже, чем чтение
  `IncomingMessage`.** → Платит только fetch-форма, и только когда тело
  есть; форма io `value` без тела не читает поток вовсе.
- **Change трогает `run()` и `AssembledApp` — те же строки, что
  `config-run-bind` (#90) и `terminology` (#86).** → Оба в работе
  параллельно. Ветка, пришедшая к Merger'у второй, делает rebase; правки
  точечные (ключ в объекте опций, геттер рядом с `servers`).
- **`app.transports` открывает наружу экземпляры транспортов.** →
  Поверхность та же, что у `servers`, и тем же обоснованием: дотянуться до
  узла графа снаружи больше нечем. Карта только на чтение.

## Migration Plan

Ломающих правок нет: всё перечисленное — добавление. Порядок работ внутри
change'а — в `tasks.md`; переименование `adapter.ts` → `framing.ts`
внутреннее и в барель не попадает.

## Open Questions

- **HTTP-уровень в тесте без сокета.** `toFetchHandler` над тестовым
  приложением дал бы прогон «запрос — ответ» без порта, но тестовый шов
  останавливается после WIRE и `serve()` не зовёт. Менять шов в этом
  change'е не будем: это отдельное решение о фазах тестового прогона.
- **Второй адаптер поверх `Response` хозяина.** Формы Hono и Elysia
  совпадают с fetch-формой, формы Express и Fastify — с node-формой.
  Проверять их прогоном в этом change'е не будем: обе формы стандартные,
  а зависимость на чужой фреймворк ради теста дороже пользы.
