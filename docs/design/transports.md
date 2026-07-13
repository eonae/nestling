# Transport-centric HTTP Architecture (Node.js)

> Минималистичная, транспорт-ориентированная архитектура HTTP-фреймворка  
> Цель — быть фундаментом для собственного фреймворка, а не готовым решением.

⚠️ **Статус: частично реализовано.** Транспорт `@nestling/transport.http` следует
этой архитектуре (find-my-way, busboy, парсинг по io-декларации). Разделы
§1/§3/§5/§7 приведены к pipeline v2 + abort-signal (2026-07) и отказу от
`.after` (2026-07-13); псевдокод §8–§10 — иллюстративные наброски, строчно с
реализацией не сверялись. §5 описывает kernel-представление
`EndpointDefinition`; пользовательский канон деклараций —
per-transport конструкторы ([ideas.md [2026-07-13]](../decisions/ideas.md)
«Endpoint-декларации»). При расхождении источник истины —
[decisions/ideas.md](../decisions/ideas.md) (Pipeline v2) и код пакета.

🔒 **Hardening (реализовано, change `transport-hardening`):** лимит размера тела
`maxBodySize` (JSON/raw/text/multipart/NDJSON, дефолт 1 MiB) с ранним
прерыванием → `413`; типизированные ошибки входа (битый JSON, конфликт ключей)
→ `400`; настраиваемые таймауты `node:http`; graceful `close()` с дренажом
соединений; детали необработанных 500-ошибок скрыты по умолчанию
(`exposeErrorDetails`). Осталось вне scope: CORS, rate limiting, сжатие,
проверка `Content-Type`. Опции — в README пакета.

---

## 1. Цели и ограничения

### Цели

- Минимальный HTTP-транспорт (routing + parsing)
- Отсутствие юнитов пайплайна, завязанных на HTTP-специфику
- Единый пайплайн для всех транспортов
- Поддержка:
  - обычных запросов
  - streaming request
  - streaming response
  - multipart upload
- Чёткое разделение ответственности

### Жёсткие ограничения

- ❌ Нет привязки пайплайна на уровне App/модуля — только к endpoint'у (`compose`)
- ❌ Нет IncomingMessage / ServerResponse вне транспорта
- ❌ Нет multer / body-parser как middleware
- ✅ Multipart и body parsing — ответственность транспорта
- ✅ Pipeline оперирует только абстрактной моделью — **значениями, не байтами**:
  сжатие, CORS, content-negotiation — концерн транспорта, не пайплайна
- ✅ Единицы пайплайна — препроцессоры (`.pre`), постпроцессоры (`.ok`),
  обработчики ошибок (`.catch`), наблюдатель исхода (`.finally`);
  термина «middleware» нет

---

## 2. Архитектурный обзор

```
┌────────────┐
│ HTTP       │
│ Transport  │
└─────┬──────┘
      │ RequestContext
      ▼
┌───────────────────────┐
│ Endpoint Pipeline     │
│ (слои: pre → handler  │
│  → ok/catch           │
│  → finally)           │
└─────┬─────────────────┘
      │ ResponseContext
      ▼
┌────────────┐
│ Transport  │
│ Adapter    │
└────────────┘
```

Пайплайн привязывается только к endpoint'у (глобального/модульного уровня
нет — композиция константами через `compose`).

---

## 3. Ключевые абстракции

### 3.1 Transport

```ts
interface ITransport {
  // регистрация endpoint'а (роутинг + io-декларация для парсинга)
  endpoint(definition: EndpointDefinition): void
  // go-live: слушать соединения/команды
  listen(...args: unknown[]): Promise<void>
  // graceful shutdown: дренаж активных соединений + отмена in-flight
  close?(): Promise<void>
}
```

Транспорт строит `RequestContext` из провода и вызывает
`pipeline.executeWithHandler(handler, ctx, options)` — о фазах пайплайна он не
знает. Отмена (change `abort-signal`): транспорт взводит `meta.signal` при
дисконнекте клиента, `close()` — при graceful shutdown; per-request и
transport-level сигналы объединяются через `AbortSignal.any`.

**Целевая эволюция (proposed, [composition-and-lifecycle](./composition-and-lifecycle.md)):**
nullary `listen(...)` заменяется на `serve(dispatch, signal)` — go-live принимает
готовый `dispatch` (рождается в фазе WIRE), поэтому «ранний `listen` на `@OnInit`»
структурно невозможен (гарантия, не конвенция).

---

### 3.2 RequestContext

```ts
interface RequestContext {
  transport: string
  pattern: string
  headers: Record<string, string>

  query?: unknown
  body?: unknown

  streams?: {
    body?: Readable
    files?: FilePart[]
  }

  meta: Record<string, unknown>  // гарантирован meta.signal: AbortSignal (change abort-signal)
}
```

---

### 3.3 FilePart

```ts
interface FilePart {
  field: string
  filename: string
  mime: string
  stream: Readable
}
```

---

### 3.4 ResponseContext

```ts
interface ResponseContext {
  status?: number
  headers?: Record<string, string>
  value?: unknown
  stream?: Readable
  meta: Record<string, unknown>
}
```

---

## 4. Routing

Используется find-my-way исключительно как роутер.

---

## 5. EndpointDefinition

Роутинг и парсинг управляются **io-декларацией endpoint'а** (`input`/`output` —
схема или модификатор `stream()`/`events()`), а не отдельным `RouteConfig`:

```ts
interface EndpointDefinition<I, O, P> {
  transport: string                       // 'http' | 'cli' | 'nats' | ...
  pattern: string                         // 'POST /users'
  input?: I                               // схема или модификатор (stream/events)
  output?: O                              // конфигурация выходных данных
  pipeline?: Pipeline<AnyInput, P, never> // классы-юниты App резолвит на старте (bind)
  handle: HandlerFn<I, O, P>              // возвращает Ok | Fail (Output)
}
```

Это kernel-уровень — то, что потребляет `ITransport.endpoint()`. Целевой
пользовательский слой (2026-07-13) — конструкторы транспортов
(`httpEndpoint({ method, path, deps?, handle })`): они собирают это
представление, типизируют словарь транспорта (path-параметры, bind-карта) и
ссылаются на транспорт токеном (fail-fast при отсутствии в графе);
декораторные endpoint'ы (`@Endpoint`/`@HttpEndpoint`) из целевой поверхности
удалены — [ideas.md [2026-07-13]](../decisions/ideas.md)
«Endpoint-декларации».

Онтологически конструктор — сахар «анонимный контракт + `implement`»:
иерархия деклараций контракт-первична (именованный контракт = capability
через экспорт, анонимный = чисто транспортная поверхность). Целевая
io-декларация — **дерево форм** (`value`/`stream`/`events`/`multipart`,
листья — Standard Schema); биндинг валидируется против способностей
транспорта на ASSEMBLE (стримы умеет HTTP, шина v1 — только value).
Сырые байты (webhook-подписи) — opt-in пометка `rawBody: true` в словаре
HTTP, байты попадают в типизированный стартовый контекст пайплайна.
Статика/CORS/сжатие — этаж **ниже** деклараций: сантехника транспорта,
конфиг/плагины, без схем — [ideas.md [2026-07-13]](../decisions/ideas.md)
«Контракт первичен».

---

## 6. HTTP Transport: parsing

### JSON body

```ts
async function parseJson(req: IncomingMessage) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return JSON.parse(Buffer.concat(chunks).toString())
}
```

---

### Multipart (busboy)

```ts
function parseMultipart(req: IncomingMessage): Promise<FilePart[]> {
  return new Promise((resolve, reject) => {
    const busboy = new Busboy({ headers: req.headers })
    const files: FilePart[] = []

    busboy.on('file', (field, stream, filename, _, mime) => {
      files.push({ field, filename, mime, stream })
    })

    busboy.on('finish', () => resolve(files))
    busboy.on('error', reject)

    req.pipe(busboy)
  })
}
```

---

## 7. Pipeline

Модель v2 — плоские фазы без `next()`: `makePipeline()` со словарём
`.pre/.ok/.catch/.finally`, слои и `compose`. Pre-юниты монотонно
накапливают типизированный input; ответные юниты применяются к текущему
ответу и могут его заменить; `.finally` наблюдает исход
(`completed | disconnected | aborted | failed`).

```ts
const pipeline = compose(
  makePipeline().pre(withRequestId()).finally(audit),
  makePipeline<{ requestId: string }>().pre(validate()),
);
```

Транспорт вызывает `pipeline.executeWithHandler(handler, ctx, options)` и
не знает о фазах. Подробности и логика решений —
[decisions/ideas.md](../decisions/ideas.md), раздел «Pipeline v2».

---

## 8. Handler

```ts
type Handler = (ctx: RequestContext) => Promise<ResponseContext>
```

---

## 9. Streaming examples

### Upload

```ts
await pipeline(
  file.stream,
  fs.createWriteStream('/tmp/file')
)
```

### Download

```ts
return { stream: fs.createReadStream('big.txt') }
```

---

## 10. Transport adapter

```ts
function sendHttp(res: ServerResponse, r: ResponseContext) {
  if (r.stream) return r.stream.pipe(res)
  res.end(JSON.stringify(r.value))
}
```

---

## 11. Принципы

- Multipart — ответственность транспорта
- Юниты пайплайна не знают о нативных стримах транспорта
- Handler управляет I/O
- Один пайплайн — много транспортов
