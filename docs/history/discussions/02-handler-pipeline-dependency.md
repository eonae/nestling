# Архитектурные решения: Pipeline, Handler, Endpoint

## 1. Терминология: ты почти попал, но есть один скрытый перекос

### Handler

Ок. Бизнес-операция, не HTTP-ручка, не endpoint.

Ключевая мысль, которую ты уже почти сформулировал, но не дожал:

> **Handler не транспортонезависимый, а pipeline-зависимый**

Это очень важно. И это нормально.

### Pipeline

Тут я бы зафиксировал жёстче:

> **Pipeline = типизированная программа преобразования Context → Context + вызов Handler**

То есть:

- middleware не про данные запроса, а про эволюцию контекста
- handler — просто последний шаг пайплайна

Это сразу снимает часть вопросов про типизацию.

### Transport

Транспорт не знает про middleware вообще.

Он делает:

1. `raw request → InitialContext`
2. выбирает `(pipeline, handler)`
3. запускает pipeline
4. `FinalContext → response`

Если транспорт начинает знать про пайплайн — ты теряешь изоляцию.

### Endpoint / Route

Я бы развёл:

- **Handler** — метод
- **Endpoint** — binding (transport + route + pipeline + handler)

Т.е. endpoint — это не код, а конфигурационный объект, который создаётся декоратором.

```typescript
@Route(Http.POST, "/users")
@Pipeline(SessionPipeline)
createUser(ctx: CtxWithIdentity<User>) {}
```

`@Route` и `@Pipeline` вместе порождают Endpoint.

Интерфейс `IHandler` тут не нужен вообще.

## 2. Один handler — несколько endpoint'ов: это нормально и правильно

Твой пример с:

- `/internal/users` (session)
- `/api/users` (api-key)

➡ **Один handler, разные пайплайны — это идеальный кейс.**

И твой вывод правильный:

> обработчики транспорто-независимые, но pipeline-зависимые

Я бы даже сказал жёстче:

> **Handler обязан быть pipeline-зависимым, иначе он будет проверять всё сам**

## 3. Identity: union — это тревожный звоночек

```typescript
identity: User | App
```

**Типобезопасно?** Да.  
**Архитектурно?** Пахнет протечкой пайплайна в бизнес.

### Лучше так:

```typescript
type UserCtx = BaseCtx & { identity: User }
type AppCtx  = BaseCtx & { identity: App }
```

И два разных handler'а, даже если они делят общую функцию:

```typescript
function createUserImpl(...) {}

createUserFromUI(ctx: UserCtx)
createUserFromAPI(ctx: AppCtx)
```

Это:

- убирает `if (identity instanceof …)`
- делает права входа явными
- упрощает типизацию

**Если handler начинает различать тип identity — значит это уже разные бизнес-операции.**

## 4. Типизация пайплайна: твой pipe — правильное направление, но не та форма

Ты сейчас мыслишь пайплайн как:

```typescript
(arg: A) => B
```

А тебе нужен:

```typescript
(ctx: Ctx<A>) => Ctx<B>
```

### Минимальная модель

```typescript
type Ctx<T> = {
  data: T
  meta: Record<string, unknown>
}

type Middleware<I, O> = (ctx: Ctx<I>) => Promise<Ctx<O>>
```

### Pipeline:

```typescript
class Pipeline<I, O> {
  constructor(private readonly mws: Middleware<any, any>[]) {}

  run(ctx: Ctx<I>): Promise<Ctx<O>> { ... }
}
```

### Типизация цепочки

```typescript
type Pipe<M extends Middleware<any, any>[]> =
  M extends [Middleware<infer A, infer B>]
    ? Pipeline<A, B>
    : M extends [Middleware<infer A, infer B>, ...infer R]
      ? R extends Middleware<any, any>[]
        ? Pipe<[Middleware<A, B>, ...R]>
        : never
      : never
```

➡ Да, твой подход применим, но:

- **не** через `Fn`
- **а** через `Ctx<T>` как единицу эволюции

## 5. «Немногословная» декларация — только через inference

Ключевая форма должна быть такой:

```typescript
const pipeline = definePipeline(
  withSession(),
  withIdentity<User>(),
  validate(CreateUserSchema),
)
```

Где:

- каждая middleware добавляет тип
- `definePipeline` возвращает `Pipeline<In, Out>` с инференсом

**Любая попытка писать `<A, B>` руками — проигрыш.**

## 6. Декоратор @Pipeline и проверка типов handler'а

Вот тут неприятная правда:

> Декораторы в TS не могут гарантировать совпадение типов

Но есть обходной путь, который ты почти нащупал.

### Единственный рабочий вариант

Handler типизируется не сигнатурой метода, а generic'ом класса:

```typescript
class CreateUserHandler implements Handler<UserCtx> {
  handle(ctx: UserCtx) {}
}
```

А декоратор:

```typescript
@Pipeline(UserPipeline)
class CreateUserHandler ...
```

И `@Pipeline` принимает `Pipeline<In, Out>` и проверяет:

```typescript
PipelineOut extends HandlerCtx ? ok : error
```

❗ **Это единственный способ получить compile-time гарантию.**

Метод `handle()` — слишком поздно.

## 7. Default pipeline — да, но типы проверяются только при override

Default pipeline:

- не типизируется жёстко
- считается `unknown → unknown`

Как только ты пишешь `@Pipeline(Custom)` — начинается строгая проверка.

Это нормальный компромисс.

## 8. Контекст: KV — плохо, структурированный тип — хорошо

```typescript
ctx.identity
ctx.permissions
ctx.requestId
```

Контекст должен быть доступен в handler'е, иначе:

- ты будешь прокидывать параметры
- или делать сервис-локаторы

Но:

- **только то, что гарантировано пайплайном**
- **никаких `ctx.get("foo")`**

## 9. Валидация и авторизация

### Валидация

Middleware, без вариантов.

Типы без runtime-валидации — ложь, ты это правильно чувствуешь.

Схема:

- `validate` → меняет тип `ctx.data`
- handler получает уже валидный тип

### Аутентификация / Идентификация

Не middleware в классическом смысле.

Это обязательная стадия пайплайна, почти как `parseRequest`.

Я бы выделил:

- `identify()` — всегда
- `authorize()` — опционально

### Авторизация — бизнес или нет?

Твой вывод верный:

- **право входа** — инфраструктура
- **право действия** — бизнес

Это значит:

- `@RequireRole("admin")` — middleware
- `if (!canEdit(user, entity))` — handler

## 10. Итоговая позиция (коротко)

✅ **Handler pipeline-зависим** — и это нормально

✅ **Один handler → несколько endpoint'ов с разными pipeline** — правильно

✅ **Identity ≠ union**, а разные контексты

✅ **Pipeline типизируется как Ctx → Ctx**

✅ **Декораторы проверяют типы только на уровне класса**

✅ **Валидация** — часть типизации

✅ **Default pipeline** — осознанно слаботипизирован

### Если хочешь, следующим шагом можем:

- спроектировать минимальный API `definePipeline`
- или разобрать как это всё не превратить в NestJS v2

---

## Мой ответ: Я использую ECMAScript декораторы

Смотри тут какая штука. Я использую ECMAScript декораторы. Эндпоинты - это не функции, а классы. Декораторы тоже на классе - так что проверки типов конструктора есть. А вот на методе handle - не знаю...

### Вот так выглядит:

```typescript
import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Endpoint, Fail, Ok } from '@nestling/pipeline';
import { z } from 'zod';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';
import { HttpEndpoint } from '@nestling/transport.http';

const CreateUserInput = z.object({
  name: z.string().min(1),
  email: z.email(),
});

const CreateUserOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

type CreateUserInput = z.infer<typeof CreateUserInput>;
type CreateUserOutput = z.infer<typeof CreateUserOutput>;

/**
 * Endpoint для создания пользователя
 */
@Injectable([UserService, ILogger])
@HttpEndpoint('POST', '/api/users', {
  input: CreateUserInput,
  output: CreateUserOutput,
})
export class CreateUserEndpoint implements IEndpoint {
  constructor(
    private users: UserService,
    private logger: ILoggerService,
  ) {}

  async handle({ name, email }: CreateUserInput): Output<CreateUserOutput> {
    this.logger.log(`Handling POST /api/users - creating user ${name}`);

    // Проверка на дубликат email
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw Fail.badRequest('Email already taken', { field: 'email' });
    }

    const user = await this.users.create({ name, email });

    return Ok.created(user, {
      Location: `/api/users/${user.id}`,
    });
  }
}
```

---

## Моя абстракция запроса и ответа

Далее. Моя абстракция основана на том, что request из любого транспорта можно свести к общему формату:

### RequestContext

```typescript
/**
 * Абстрактный контекст запроса
 */
export interface RequestContext {
  transport: string;
  pattern: string;

  /**
   * Данные запроса (тип выводится через InferInput)
   */
  payload: unknown;

  /**
   * Метаданные транспорта (headers, auth, tracing)
   */
  metadata?: unknown;
}
```

### и response context - тоже

```typescript
/**
 * Детали ошибки в ResponseContext
 */
export type ErrorDetails = Record<string, unknown>;

/**
 * ResponseContext для успешного ответа
 */
export interface SuccessResponseContext<TValue = unknown> {
  /** Флаг успешного ответа */
  isSuccess: true;

  /** Статус успешного ответа */
  status: SuccessStatus;

  /** HTTP заголовки (для HTTP transport) */
  headers?: Record<string, string>;

  /** Данные успешного ответа (может быть AsyncIterableIterator для streaming) */
  value: TValue;
}

/**
 * ResponseContext для ошибки
 */
export interface ErrorResponseContext {
  /** Флаг успешного ответа */
  isSuccess: false;

  /** Статус ошибки */
  status: ErrorStatus;

  /** HTTP заголовки (для HTTP transport) */
  headers?: Record<string, string>;

  /** Детали ошибки */
  value: ErrorDetails;
}

/**
 * Абстрактный контекст ответа (discriminated union)
 */
export type ResponseContext<TValue = unknown> =
  | SuccessResponseContext<TValue>
  | ErrorResponseContext;
```

И вот вроде всё стройно, но пока не выходит так, чтобы было и просто и гибко одновременно

---

# Ответ ChatGPT: Детальный разбор

Отлично, теперь картина полная — и тут уже можно говорить предметно, а не абстрактно.

**Коротко:** у тебя очень хорошая база, а «не выходит просто и гибко одновременно» — это не ошибка дизайна, а точка, где нужно жёстко выбрать, где проходит граница типовой гарантии.

Я разберу по слоям и дам конкретные варианты, где TypeScript реально может помочь, а где — нет, и что с этим делать.

## 1. Ключевое наблюдение (самое важное)

В твоей модели `endpoint = класс`, а `handle()` — просто реализация контракта.

Это огромный плюс, потому что:

✔ **ECMAScript class decorators** → можно проверять тип конструктора

✔ **Endpoint — DI-объект** → можно типизировать на уровне класса

✔ **Transport** → вообще не знает про handle, только про контракт

👉 **Значит, типовую гарантию надо вешать НЕ на метод, а на класс.**

`handle()` — вторичен.

## 2. Почему handle() нельзя нормально проверить (и не надо)

Ты интуитивно прав:

> «А вот на методе handle — не знаю…»

И правда:

- decorators не видят сигнатуру метода
- TS не связывает metadata декоратора с типом метода
- ECMAScript decorators — runtime, типы — compile-time

❗ **Любая попытка проверить `handle()` напрямую — архитектурный тупик.**

➡ **Выход ровно один:**

> `handle()` должен быть следствием интерфейса класса, а не объектом проверки.

## 3. Правильный контракт: IEndpoint с generics

Сейчас у тебя:

```typescript
export class CreateUserEndpoint implements IEndpoint {
  async handle({ name, email }: CreateUserInput): Output<CreateUserOutput>
}
```

Это выглядит красиво, но типовая связь ни с чем не зафиксирована.

### Нужно вот так

```typescript
export interface IEndpoint<I = unknown, O = unknown> {
  handle(input: I): Output<O>;
}
```

И класс:

```typescript
export class CreateUserEndpoint
  implements IEndpoint<CreateUserInput, CreateUserOutput>
{
  async handle(input: CreateUserInput): Output<CreateUserOutput> { ... }
}
```

💡 **Теперь:**

- сигнатура handle обязана совпадать
- типы живут на уровне класса, а не метода

## 4. Как связать @HttpEndpoint и IEndpoint типами (ключевой момент)

Вот здесь твой дизайн можно дожать до почти идеала.

### Делай декоратор generic-aware

```typescript
function HttpEndpoint<I, O>(
  method: string,
  path: string,
  opts: {
    input: z.ZodType<I>;
    output: z.ZodType<O>;
  }
) {
  return function <
    T extends new (...args: any[]) => IEndpoint<I, O>
  >(ctor: T) {
    // runtime metadata
  };
}
```

🔥 **Что это даёт:**

- Если класс не реализует `IEndpoint<I, O>` → **compile error**
- Если `handle()` возвращает не `Output<O>` → **compile error**
- Если типы не совпадают с zod-схемой → **compile error** (через infer)

📌 **Это максимум, который вообще возможен в TS + decorators.**

## 5. RequestContext: ты сделал правильно, но сейчас он слишком «сырой»

```typescript
payload: unknown;
metadata?: unknown;
```

Это нормально на уровне транспорта, но не на уровне endpoint'а.

### Правильное разделение

**Transport-level:**

```typescript
interface RequestContext {
  transport: string;
  pattern: string;
  payload: unknown;
  metadata: unknown;
}
```

**Endpoint-level (после пайплайна):**

```typescript
interface EndpointContext<I, M = unknown> {
  input: I;
  meta: M;
}
```

И `handle()` никогда не должен видеть `RequestContext`.

➡ **Pipeline делает:**

```
RequestContext
  → validate
  → auth
  → map
  → EndpointContext<I, Meta>
```

## 6. ResponseContext — хорош, но ты смешал уровни

Твоя модель ответа очень хорошая, но:

- `headers`
- `status`
- `streaming`

— это transport concern, не endpoint.

### Рекомендую разделить

**Endpoint возвращает:**

```typescript
type EndpointResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DomainError };
```

**Transport адаптирует в:**

```typescript
ResponseContext<T>
```

📌 `Ok.created(...)` — это уже HTTP-specific sugar, и ты это чувствуешь.

## 7. Почему «не выходит просто и гибко» — и это нормально

Потому что ты пытаешься одновременно:

1. Сохранить чистую бизнес-абстракцию
2. Дать богатый HTTP-DSL
3. Получить жёсткие типовые гарантии
4. Не превратиться в NestJS

❗ **Эти цели противоречат друг другу после определённой точки.**

### Единственный устойчивый компромисс

- ✅ Типы жёсткие на границе Endpoint
- ✅ Pipeline — типизирован, но не отражается в handle
- ✅ Transport — адаптер, не участник типовой модели
- ✅ Декораторы проверяют класс, не метод

**Ты уже на правильной стороне компромисса.**

---

# Дальнейшее обсуждение

## Мои уточнения:

### 1. Смотри - декоратор Endpoint я с интерфейсом связал - там всё ок. IEndpoint - дженерик с двумя параметрами, как ты и сказал.

### 2. В handler попадает именно input и metadata - оба типизированные.

### 3. По поводу status и headers

Это не HTTP - это абстрактные статусы (не числовые - там строковый ENUM: Ok, Created и т. д. Статусы у ошибок тоже есть - это некие "бизнес-статусы" и абстрактные заголовки. Заголовки ведь у любого транспорта есть. Без этого не знаю, как реализовать сценарий, когда например я в ответ на идемпотентный метод создания хочу вернуть 201 если объект создан и 200, если он уже и так был. Ну и заголовки иногда нужны. 

**Например:**

```typescript
import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Ok, stream } from '@nestling/pipeline';
import { z } from 'zod';
import type { User } from '../../../common/types';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';
import { HttpEndpoint } from '@nestling/transport.http';

const ExportUsersOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

type ExportUsersOutput = z.infer<typeof ExportUsersOutput>;

/**
 * Endpoint для экспорта пользователей через streaming
 * Демонстрирует:
 * - Streaming данных на выход через AsyncIterableIterator
 * - Кастомные заголовки (Content-Type, Content-Disposition)
 */
@Injectable([UserService, ILogger])
@HttpEndpoint('GET', '/api/users/export', {
  output: stream(ExportUsersOutput),
})
export class ExportUsersEndpoint implements IEndpoint {
  constructor(
    private userService: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(): Output<AsyncIterableIterator<User>> {
    this.logger.log('Handling GET /api/users/export');

    const stream = this.userService.exportAll();

    return new Ok(stream, {
      'Content-Type': 'application/x-ndjson',
      'Content-Disposition': 'attachment; filename="users.ndjson"',
    });
  }
}
```

Хотя если у тебя есть идеи, как это улучшить.. давай

### 4. Главный вопрос про middleware и metadata

Я сейчас пытаюсь ответить на главный вопрос - какие данные должны быть доступны middleware? Могут ли они их изменять? К примеру, надо ли им давать доступ к распаршенному и провалидированному payload?

Дальше смотри. У меня у handler'а в контракте есть 2-й параметр - metadata. Для него я сейчас тоже схему задаю. Вот так:

```typescript
 * @Endpoint({
 *   transport: 'http',
 *   pattern: '/users/:id',
 *   input: UserSchema,
 *   metadata: MetadataSchema,
 *   output: ResponseSchema,
 * })
```

И вот думаю сейчас.. **а может быть на самом деле схема метаданных - это свойство пайплайна? А не эндпоинта?** И через него как раз и надо типизацию пайплайн + эндпоинт контролировать? Ну в смысле, какой пайплайн, такой и тип метаданных?

# Финальный ответ ChatGPT: Архитектурная фиксация

Отлично, теперь мы дошли до ядра. Ниже — не «советы вообще», а **архитектурная фиксация**, где я буду иногда говорить жёстко, потому что ты уже на уровне, где полумеры только мешают.

Я отвечу по пунктам, но в конце сведу всё в одну модель, чтобы было понятно, почему именно так.

## 1. Про статусы и заголовки — ты прав, это не HTTP

Начну с этого, потому что ты здесь прав, а я в прошлый раз был слишком категоричен.

### Почему status + headers допустимы в Endpoint

Ты используешь:

- **семантические статусы** (Ok, Created, …)
- **абстрактные заголовки** (key-value метаданные ответа)
- **streaming** как first-class output

И это:

- ✅ не HTTP
- ✅ не gRPC
- ✅ не transport-specific

**Это Response Semantics, а не Response Transport.**

Пример с идемпотентным create — абсолютно корректный кейс:

> 201 если создан, 200 если уже был

Это не инфраструктура, это **бизнес-смысл результата**.

### Вывод

✔ Endpoint имеет право возвращать:

- семантический статус
- response metadata (headers)
- value | stream

❗ **Но важно:**

> Endpoint не должен знать, как транспорт интерпретирует это.

Ты это соблюдаешь — значит всё ок.

## 2. Streaming — у тебя уже правильная модель

Вот это место:

```typescript
Output<AsyncIterableIterator<User>>
```

и

```typescript
stream(ExportUsersOutput)
```

— очень сильное решение.

### Почему:

- ты не тащишь `ReadableStream`
- не тащишь `res.write`
- не привязываешься к backpressure конкретного транспорта

**Transport просто:**

- умеет ли он `AsyncIterable` → стримит
- не умеет → буферизует / падает

✔ **Это зрелая абстракция. Тут я бы ничего не менял.**

## 3. Главный вопрос: что такое metadata и кому она принадлежит

Вот тут ты попал в **самую важную точку всего дизайна.**

> «какие данные должны быть доступны middleware?  
> могут ли они их изменять?  
> а schema metadata — это endpoint или pipeline?»

### Короткий ответ (сразу):

> **Metadata — это продукт pipeline, а не endpoint.**
> 
> **Endpoint потребляет metadata, но не определяет её форму.**

## 4. Почему metadata НЕ должна быть свойством endpoint

Ты сейчас думаешь так:

```typescript
@Endpoint({
  input: UserSchema,
  metadata: MetadataSchema,
})
```

И это логично интуитивно, но **архитектурно — ошибка**.

### Почему это ломает модель

**Metadata:**

- auth
- tracing
- locale
- identity
- permissions

→ **не принадлежат бизнес-операции**

**Metadata:**

- зависит от пайплайна
- может отличаться для одного и того же endpoint

**Endpoint, объявляя metadata:**

- начинает диктовать инфраструктуре, что она обязана дать
- теряет переиспользуемость

## 5. Правильная модель: Pipeline как типовой контракт

Pipeline должен быть типизирован так:

```typescript
Pipeline<In, Meta, Out>
```

или, если проще:

```typescript
Pipeline<CtxIn, CtxOut>
```

Где:

```typescript
type Ctx<I, M> = {
  input: I;
  meta: M;
}
```

**Middleware:**

```typescript
Middleware<CtxA, CtxB>
```

**Pipeline:**

гарантирует, что к моменту вызова handler:

- input валиден
- metadata имеет форму Meta

## 6. Endpoint теперь выглядит логично и чисто

```typescript
class CreateUserEndpoint
  implements IEndpoint<CreateUserInput, CreateUserMeta, CreateUserOutput>
{
  async handle(input: CreateUserInput, meta: CreateUserMeta) { ... }
}
```

❗ **Endpoint не знает, откуда взялся meta.**

Он знает только:

> «если меня вызвали — значит pipeline гарантировал это»

## 7. Как теперь связать Pipeline и Endpoint типами

Вот тут магия, ради которой всё это затевалось.

### Pipeline объявляется так:

```typescript
const HttpUserPipeline = definePipeline()
  .use(parseHttp())
  .use(authSession())
  .use(withIdentity<User>())
  .use(withPermissions())
  .use(validateInput(CreateUserSchema));
```

### Тип HttpUserPipeline:

```typescript
Pipeline<
  { input: unknown; meta: {} },
  { input: CreateUserInput; meta: { identity: User; permissions: Permissions } }
>
```

### Endpoint декоратор:

```typescript
@Pipeline(HttpUserPipeline)
class CreateUserEndpoint implements IEndpoint<
  CreateUserInput,
  { identity: User; permissions: Permissions },
  CreateUserOutput
> {}
```

❗ **Если типы не совпали — compile error.**

## 8. Ответ на вопрос: могут ли middleware менять данные?

**Да. И они должны это делать.**

Но:

- только через типизированный Context
- явно, а не мутируя втихаря

### Примеры:

- `validate()` → меняет `input: unknown → Input`
- `withIdentity()` → добавляет `meta.identity`
- `withLocale()` → добавляет `meta.locale`

### ❌ Middleware не должны:

- лазить в `ctx.meta as any`
- менять input без отражения в типе

## 9. Где теперь место schema metadata?

> «может schema metadata — это свойство pipeline?»

**Да. Именно так.**

Но не как отдельное поле, а как **следствие middleware**.

```typescript
withIdentity<User>() // ← schema здесь
withTracing()
withLocale()
```

**Pipeline собирает metadata тип композиционно.**

**Endpoint не описывает metadata схемой вообще.**

## 10. Итоговая фиксация (очень важно)

Если всё свести в одну формулу:

> **Pipeline = типовой контракт между транспортом и endpoint'ом**

- **Transport** → знает только RequestContext
- **Pipeline** → превращает его в TypedContext
- **Endpoint** → работает только с TypedContext
- **Metadata** → продукт pipeline
- **Input** → продукт pipeline
- **Output** → семантика endpoint'а

### И тогда:

✅ всё типизировано  
✅ всё расширяемо  
✅ нет магии  
✅ нет NestJS-стайл «всё во всём»

---

## Следующие шаги

Если хочешь, следующим шагом можем:

- спроектировать точный тип `definePipeline()`
- или разобрать как выглядят middleware с типовым расширением
- или посмотреть, где у тебя сейчас типовая информация теряется