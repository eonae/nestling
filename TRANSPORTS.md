# Transport-centric HTTP Architecture (Node.js)

> Минималистичная, транспорт-ориентированная архитектура HTTP-фреймворка  
> Цель — быть фундаментом для собственного фреймворка, а не готовым решением.

---

## 1. Цели и ограничения

### Цели

- Минимальный HTTP-транспорт (routing + parsing)
- Отсутствие middleware, завязанных на HTTP-специфику
- Единый пайплайн для всех транспортов
- Поддержка:
  - обычных запросов
  - streaming request
  - streaming response
  - multipart upload
- Чёткое разделение ответственности

### Жёсткие ограничения

- ❌ Нет middleware на уровне маршрутов
- ❌ Нет IncomingMessage / ServerResponse вне транспорта
- ❌ Нет multer / body-parser как middleware
- ✅ Multipart и body parsing — ответственность транспорта
- ✅ Middleware работают только с абстрактной моделью

---

## 2. Архитектурный обзор

```
┌────────────┐
│ HTTP       │
│ Transport  │
└─────┬──────┘
      │ RequestContext
      ▼
┌─────────────────┐
│ Global Pipeline │
│ (middlewares)   │
└─────┬───────────┘
      │
      ▼
┌────────────┐
│ Handler    │
└─────┬──────┘
      │ ResponseContext
      ▼
┌────────────┐
│ Transport  │
│ Adapter    │
└────────────┘
```

---

## 3. Ключевые абстракции

### 3.1 Transport

```ts
interface ITransport {
  handle(nativeReq: unknown, nativeRes: unknown): Promise<void>
}
```

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

  meta: Record<string, unknown>
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

## 5. RouteConfig

```ts
interface RouteConfig {
  pattern: string
  input?: {
    body?: 'json' | 'raw' | 'stream'
    multipart?: {
      files: 'stream' | 'buffer'
    }
  }
  handle: Handler
}
```

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

```ts
type Middleware = (
  ctx: RequestContext,
  next: () => Promise<ResponseContext>
) => Promise<ResponseContext>
```

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
- Middleware не знают о стримах
- Handler управляет I/O
- Один пайплайн — много транспортов
