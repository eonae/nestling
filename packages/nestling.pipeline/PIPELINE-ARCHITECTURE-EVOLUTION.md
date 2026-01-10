# Эволюция архитектуры Pipeline

Этот документ описывает архитектурные решения и эволюцию дизайна типизированного pipeline в nestling.pipeline.

## Проблема: избыточная сложность типов

Изначальная модель использовала дженерик `I` (Input) на всех уровнях:

```typescript
Middleware<I, M, N, CIn, COut>
```

Это создавало избыточную сложность и не соответствовало реальным потребностям middleware.

## Решение 1: Убрать input из middleware

### Инсайт

**Middleware не должны видеть input.** Они работают с инфраструктурой, а не с бизнес-данными.

### Типичные middleware

- `auth` — работает с `raw`, `endpoint`, `meta`
- `identity` — работает с `raw`, `endpoint`, `meta`
- `rate limit` — работает с `raw`, `endpoint`, `meta`
- `timing` — работает с `raw`, `endpoint`, `meta`
- `logging` — работает с `raw`, `endpoint`, `meta`
- `audit` — работает с `raw`, `endpoint`, `meta`
- `tracing` — работает с `raw`, `endpoint`, `meta`
- `cache` — работает с `raw`, `endpoint`, `meta`
- `metrics` — работает с `raw`, `endpoint`, `meta`

**Им не нужно:**
- ❌ бизнес-структура input
- ❌ типы payload'а
- ❌ знание схемы

**А validate?**
`validate` создаёт input, но не использует его как вход.

### Что меняется

**Было:**
```typescript
Middleware<I, M, N, CIn, COut>
```

**Становится:**
```typescript
Middleware<MIn, MOut, PIn, POut>
```

или вообще:
```typescript
Middleware<CIn, COut>
```

где `C` не содержит `input`.

### Новая модель контекста

Разделяем контексты:

```typescript
interface BaseContext<M> {
  readonly raw: Raw;
  readonly endpoint: EndpointMeta;
  meta: M;
}

interface UnvalidatedContext<M> extends BaseContext<M> {}

interface ValidatedContext<M> extends BaseContext<M> {
  /** input здесь НЕТ */
}
```

А `input` живёт отдельно:

```typescript
interface HandlerContext<I, M> {
  input: I;
  meta: M;
}
```

### validate как boundary middleware

```typescript
export type Validate<I> = <M>(
  ctx: UnvalidatedContext<M>,
  next: (ctx: ValidatedContext<M>, input: I) => Promise<ResponseContext>,
) => Promise<ResponseContext>;
```

Или проще — `validate` не middleware, а шаг pipeline:

```typescript
pipeline
  .use(withTiming)
  .use(withIdentity)
  .validate(schema)
  .handle((input, meta) => ...)
```

### Pipeline без I

```typescript
export class Pipeline<M, P extends 'unvalidated' | 'validated'> {
  use(mw: Observe<M>): Pipeline<M, P>;
  use<MAdd>(mw: EnrichMeta<MAdd>): Pipeline<M & MAdd, P>;
  validate<I>(): Pipeline<M, 'validated'>;

  execute<I>(
    handler: P extends 'validated'
      ? (input: I, meta: M) => Output<I>
      : never,
    ctx: BaseContext<M>,
  ): Promise<ResponseContext>;
}
```

### Что исчезло

- ❌ `I` в middleware
- ❌ `I` в `.use()`
- ❌ `NextContext<I, ...>`
- ❌ касты (`currentCtx as ValidatedContext<I, M>`)

### Что выиграли

- ✅ Минус один фундаментальный дженерик (самый тяжёлый)
- ✅ Middleware стали проще, чище, ближе к реальности
- ✅ `validate` стал явной границей, единственным местом появления input
- ✅ Архитектура стала более честной

### Что потеряли?

Почти ничего.

Единственный кейс: middleware, которому нужен input. Но это:
- либо бизнес-логика → handler
- либо anti-pattern (middleware начинает «понимать» домен)

Если вдруг понадобится:
- можно сделать post-handler middleware
- или `after()` hook

### Архитектурный вывод

**Принцип:**
> Middleware — это инфраструктура.  
> Input — это бизнес.

Когда их разделяешь:
- типы упрощаются
- границы становятся чёткими
- DSL начинает «дышать»

---

## Решение 2: Как endpoint получает input?

### Проблема

При связывании endpoint с pipeline нужно проверить существование input (только существование, не тип).

### Разделение ответственности

```
Transport → Pipeline → Endpoint(handler)
```

**Pipeline:**
- подготавливает инфраструктуру
- гарантирует, что input существует или нет

**Endpoint:**
- потребляет input, если он есть

Pipeline не обязан знать, как endpoint использует input. Он обязан знать есть ли он вообще.

### Типовое решение: handler с условной сигнатурой

#### Тип handler'а

```typescript
type EndpointHandler<P, TOutput> =
  HasValidation<P> extends true
    ? (input: any, meta: InferPipelineMeta<P>) => Output<TOutput> | OutputSync<TOutput>
    : (meta: InferPipelineMeta<P>) => Output<TOutput> | OutputSync<TOutput>;
```

Обрати внимание:
- `input: any` — осознанно
- тип input — забота `validate` + endpoint, не pipeline

#### executeWithHandler с типовой проверкой

```typescript
async executeWithHandler<TOutput, P extends Pipeline<any, any, any>>(
  this: P,
  handler: EndpointHandler<P, TOutput>,
  ctx: P extends Pipeline<any, any, infer C> ? C : never,
): Promise<ResponseContext<TOutput>> {
  ...
}
```

Теперь:
- ❌ нельзя передать handler с `(input, meta)` если validate не было
- ❌ нельзя забыть validate, если endpoint ожидает input

### Как реально передать input в handler?

Ровно так, как сейчас — но с runtime-assert вместо кастов:

```typescript
if ('input' in currentCtx) {
  return handler(currentCtx.input, currentCtx.meta);
}
return handler(currentCtx.meta);
```

И это правильное место для runtime-проверки.

**Почему?**
- TypeScript не может проверить runtime
- но он может гарантировать, что ты сюда не попадёшь с неправильным handler'ом

### Проверка «input существует» при связывании

**Типовая проверка** — уже есть:
```typescript
HasValidation<P>
```

**Runtime-проверка** — минимальная и честная:
```typescript
if (!('input' in currentCtx)) {
  throw new Error(
    'Endpoint expects input, but pipeline does not contain validate()',
  );
}
```

💡 Это не дублирование типов, это защита от:
- кастов
- JS-пользователей
- неправильной сборки

### Разделение ответственности

| Слой | Отвечает за |
|------|-------------|
| Transport | raw payload |
| Pipeline | инфраструктура + existence of input |
| Endpoint | бизнес-логика + тип input |

Это:
- уменьшает дженерики
- убирает касты
- делает validate настоящей границей

---

## Решение 3: Единый объект input = payload & meta

### Идея

У нас в принципе есть один объект `input = payload & meta`. Валидационная middleware просто добавляет в input новый ключ. Мы только договариваемся, что он должен назваться `payload`.

Соответственно `HasPayload` — тип, проверяющий наличие ключа `payload` в типе.

### Новая договорённость

`input` — это один объект, который накапливается middleware. `validate()` просто добавляет ключ `payload`.

То есть:

```typescript
input = {
  ...meta,
  payload: ValidatedPayload
}
```

или даже:

```typescript
input = {
  payload: ...,
  user: ...,
  requestId: ...
}
```

Pipeline работает только с `input`, а не с `meta + input`.

### Что это радикально упрощает

**Уходит полностью:**
- ❌ `ValidatedContext` / `UnvalidatedContext`
- ❌ `NextContext`
- ❌ фазы
- ❌ `I extends AnyInput`
- ❌ runtime-касты (`ctx as ValidatedContext).input`

**Остаётся:**
- ✅ монотонное накопление данных
- ✅ строгий контроль «payload есть или нет»
- ✅ типовой вывод итогового input

### Новый минимальный контекст

```typescript
export interface Context<I extends object> {
  readonly raw: Raw;
  readonly endpoint: EndpointMeta;
  input: I;
}
```

В начале:

```typescript
type InitialInput = {};
```

### Middleware как расширение input

```typescript
export type Middleware<IIn extends object, IOut extends IIn> = (
  ctx: Context<IIn>,
  next: (ctx: Context<IOut>) => Promise<ResponseContext>,
) => Promise<ResponseContext>;
```

🔒 **Ключевой момент:**
`IOut extends IIn` — input можно только расширять, но не ломать.

### validate() просто добавляет payload

```typescript
export function validate<P>(): Middleware<
  {},
  { payload: P }
> {
  return async (ctx, next) => {
    const payload = /* validate raw.payload */;
    return next({
      ...ctx,
      input: {
        ...ctx.input,
        payload,
      },
    });
  };
}
```

Никакой «фазы». Просто появился ключ `payload`.

### HasPayload

```typescript
export type HasPayload<I> =
  I extends { payload: any } ? true : false;
```

Или сразу полезнее:

```typescript
export type PayloadOf<I> =
  I extends { payload: infer P } ? P : never;
```

### Pipeline теперь элементарный

```typescript
export class Pipeline<I extends object> {
  private constructor(
    private readonly middlewares: Middleware<any, any>[],
  ) {}

  static empty(): Pipeline<{}> {
    return new Pipeline([]);
  }

  use<I2 extends I>(
    mw: Middleware<I, I2>,
  ): Pipeline<I2> {
    return new Pipeline([...this.middlewares, mw]);
  }

  async execute<T>(
    handler: HasPayload<I> extends true
      ? (payload: PayloadOf<I>, input: I) => Output<T> | OutputSync<T>
      : (input: I) => Output<T> | OutputSync<T>,
    ctx: Context<I>,
  ): Promise<ResponseContext<T>> {
    ...
  }
}
```

💡 Тип handler'а теперь зависит ТОЛЬКО от наличия `payload`.

### Пользовательский код — очень чистый

```typescript
const pipeline = Pipeline.empty()
  .use(withTiming)
  .use(withIdentity<User>())
  .use(validate<UserInput>());
```

Тип pipeline:

```typescript
Pipeline<{
  user: User;
  payload: UserInput;
}>
```

Handler:

```typescript
pipeline.execute((payload, input) => {
  // payload: UserInput
  // input.user: User
  return Ok(...);
});
```

Если убрать `validate()` — TS запретит handler с `payload`.

### Runtime-проверка — минимальная и честная

```typescript
if ('payload' in ctx.input) {
  return handler(ctx.input.payload, ctx.input);
}
return handler(ctx.input);
```

### Почему это особенно хорошо в TS

- TypeScript очень хорошо работает со структурными типами
- проверка «есть ли ключ» — его сильная сторона
- `extends { payload: ... }` — дешёвая и надёжная модель

Ты перестал моделировать состояния, и стал моделировать форму данных.

### Что сознательно теряем (и это ок)

- ❌ невозможность «запретить» два validate()
  → решается соглашением или runtime-check
- ❌ payload — просто ключ
  → но это ровно то, что ты хочешь

На практике это не проблема, а честное отражение реальности.

### Архитектурный вывод

**Модель:**
> Pipeline — это builder input-объекта.  
> Endpoint — это функция от input.  
> payload — просто обязательная часть input, не особая сущность.

---

## Решение 4: Append паттерн для middleware

### Идея

Middleware передаёт в `next` не изменённый `input`, а `Append` — то, что надо добавить к input. Таким образом middleware не смогут мутировать уже существующие атрибуты input'а.

### Проблема, которую решаем

**Текущие риски:**
- Middleware может вернуть input с другим shape
- Middleware может затереть существующие поля
- Middleware может подменить payload, meta, что угодно

**Типизация через `Context<In, Out>`:**
- усложняется
- требует нескольких дженериков
- плохо масштабируется

**Хотим:**
- запретить мутацию
- разрешить только расширение
- упростить дженерики

### Ключевая концепция

**Middleware ничего не меняет, а только ДОБАВЛЯЕТ**

#### Контракт middleware

```typescript
type Middleware<Ctx, Add extends object> = (
  ctx: Readonly<Ctx>,
  next: (append: Add) => Promise<void>
) => Promise<void>;
```

- `ctx` — `Readonly`, мутировать нельзя
- `Add` — только новые поля
- `next` принимает `append`, а не `ctx`

### Как реально выглядит пайплайн

#### Общий input

```typescript
type Input = {
  requestId: string;
  meta: {
    ip: string;
  };
};
```

#### Middleware, добавляющая payload

```typescript
type Payload = {
  userId: string;
};

const validatePayload: Middleware<Input, { payload: Payload }> =
  async (ctx, next) => {
    // ctx.payload ❌ — нет
    // ctx.meta ✔

    await next({
      payload: {
        userId: '123',
      },
    });
  };
```

#### Middleware, добавляющая user

```typescript
type User = { id: string; role: 'admin' | 'user' };

const auth: Middleware<Input & { payload: Payload }, { user: User }> =
  async (ctx, next) => {
    // ctx.payload ✔
    // ctx.user ❌

    await next({
      user: { id: ctx.payload.userId, role: 'admin' },
    });
  };
```

### Как собирается итоговый input

Где-то в транспорте / рантайме:

```typescript
let currentInput = initialInput;

await middleware(ctx, async (append) => {
  currentInput = {
    ...currentInput,
    ...append,
  };
});
```

Тип на уровне TS:

```typescript
type Append<A, B> = A & B;
```

Именно так и должно быть: пересечения, а не замены.

### Запрет перезаписи существующих ключей

Чтобы middleware не мог добавить ключ, который уже есть, вводим constraint:

```typescript
type NoOverlap<Base, Add> =
  keyof Base & keyof Add extends never ? Add : never;
```

И обновляем сигнатуру:

```typescript
type Middleware<Ctx, Add extends object> = (
  ctx: Readonly<Ctx>,
  next: (append: NoOverlap<Ctx, Add>) => Promise<void>
) => Promise<void>;
```

Теперь это не скомпилируется:

```typescript
await next({
  meta: {} // ❌ meta уже есть в Ctx
});
```

🔥 **Это очень сильная гарантия**

### Про идею payload & meta как единый input

Да, это логично и правильно:

```typescript
type Input = {
  meta: Meta;
  payload?: unknown;
};
```

Тогда:
- validation middleware добавляет `payload`
- auth middleware добавляет `user`
- handler требует `HasPayload<Input>`

### HasPayload — простой и чистый тип

```typescript
type HasPayload<T> =
  T extends { payload: infer P }
    ? unknown extends P
      ? never
      : T
    : never;
```

Или проще, если payload всегда обязателен после валидации:

```typescript
type HasPayload<T> = T & { payload: object };
```

Использование:

```typescript
function handler(input: HasPayload<Input & { user: User }>) {
  input.payload; // ✔ типизирован
  input.user;    // ✔
}
```

### Что в итоге получили

**Плюсы:**
- ✅ middleware не может мутировать input
- ✅ middleware не может удалить или подменить поля
- ✅ middleware только расширяет контекст
- ✅ минус 1 дженерик
- ✅ строгая типизация порядка middleware
- ✅ идеально ложится на transport-level pipeline

**Ограничение (и это нормально):**
- middleware не может трансформировать payload
  → но это хорошо: трансформации = новый ключ (`validatedPayload`, `user`, `session`, …)

### Архитектурный вывод

**Модель:**
> Middleware = typed context enrichment

Это:
- ближе к dataflow, чем к Express
- ближе к type-level state machine
- идеально для «транспорт как фреймворк» подхода

---

## Итоговая архитектура

### Принципы

1. **Middleware — это инфраструктура. Input — это бизнес.**
   - Разделение ответственности упрощает типы и делает границы чёткими.

2. **Pipeline — это builder input-объекта.**
   - Input накапливается через middleware, расширяясь монотонно.

3. **validate() — это граница.**
   - Единственное место появления `payload` в input.

4. **Middleware только расширяет, не мутирует.**
   - Append паттерн гарантирует неизменность существующих полей.

5. **Структурная типизация вместо фазовой модели.**
   - Проверка наличия ключей (`HasPayload`) вместо состояний (`ValidatedContext`).

### Преимущества

- ✅ Минус один фундаментальный дженерик
- ✅ Упрощённая типизация middleware
- ✅ Чёткие границы ответственности
- ✅ Защита от мутаций на уровне типов
- ✅ Идеальное соответствие TypeScript структурной типизации
- ✅ Прозрачная и понятная модель

### Следующие шаги

Возможные направления развития:

- Запретить двойной `payload` типами
- Сделать `requirePayload()` middleware
- Разобрать cache/idempotency поверх payload
- Аккуратно задокументировать эту модель как public API
- Собрать typed middleware chain builder
- Показать, как из этого автоматически выводить OpenAPI / contracts

---

## Заключение

Эволюция архитектуры pipeline привела к очень зрелой модели, которая:

- Упрощает типы без потери гарантий
- Чётко разделяет ответственность между слоями
- Использует сильные стороны TypeScript
- Защищает от ошибок на уровне типов

Это не упрощение ради удобства, а очистка модели и вычищение границ ответственности.
