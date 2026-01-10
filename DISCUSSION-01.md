# Архитектурные решения: Pipeline, Transports, Endpoints

## Главная идея
Разделение инфраструктурной и бизнес логики в обработке запросов.

---

## 1. ТЕРМИНОЛОГИЯ И ТЕКУЩАЯ РЕАЛИЗАЦИЯ

### Handler (IEndpoint)
**Определение:** Класс с методом `handle()`, реализующий бизнес-логику.

**Текущая реализация:**
```typescript
interface IEndpoint<I, O, M> {
  handle(payload: InferInput<I>, metadata: Infer<M>): Output<O> | OutputSync<O>
}
```

**✅ Реализовано:**
- Handler получает нормализованные данные (payload, metadata)
- Транспортно-независимый (не знает про HTTP, CLI и т.д.)
- Возвращает Success (Ok) или выбрасывает Failure (Fail)
- Типизированный через Input/Output схемы

**💭 Вопрос:** Может назвать интерфейс `IHandler` вместо `IEndpoint`?
**💡 Комментарий:** Текущее название `IEndpoint` корректно - оно отражает, что это точка входа 
в бизнес-логику. `IHandler` слишком общее и может смешаться с другими handler'ами в системе.

---

### Pipeline
**Определение:** Последовательность обработки запроса:
```
Transport → Middleware₁ → ... → Middlewareₙ → Handler → Response
```

**Текущая реализация:**
- `Pipeline.use()` - добавление middleware в цепочку
- `Pipeline.executeWithHandler()` - выполнение: middleware → handler
- Глобальный перехват ошибок
- Нормализация результата в `ResponseContext`

**✅ Реализовано:**
- Middleware поддерживает функции и классы
- Автоматическая обработка Ok/Fail результатов
- Middleware могут модифицировать RequestContext и ResponseContext

**❌ НЕ реализовано:**
- Типизированный изменяемый контекст (см. раздел 4)
- Привязка конкретных пайплайнов к endpoint'ам через декоратор @Pipeline()
- Валидация совместимости типов между middleware в цепочке

---

### Transport
**Определение:** Компонент для приёма и нормализации запросов от внешнего мира.

**Обязанности:**
1. Приём нативного запроса (HTTP request, CLI args, и т.д.)
2. Нормализация в `RequestContext { transport, pattern, payload, metadata }`
3. Роутинг - поиск нужного endpoint'а
4. Выполнение Pipeline с найденным handler'ом
5. Преобразование `ResponseContext` в нативный ответ (HTTP response, stdout)

**Текущая реализация (HttpTransport):**
- Парсинг URL, query, params, body (JSON/multipart/stream)
- Валидация через Zod схемы (input/metadata)
- Вызов `pipeline.executeWithHandler(handler, requestContext)`
- Отправка ответа через `sendResponse()`

**✅ Реализовано:**
- HTTP Transport полностью функционален
- CLI Transport базово работает
- Разделение транспортной и бизнес-логики

---

### Endpoint (декоратор)
**Текущая реализация:**
```typescript
@HttpEndpoint('POST', '/api/users', { input: Schema, output: Schema })
```

**Что делает:**
- Регистрирует класс в EndpointRegistry
- Сохраняет метаданные (transport, pattern, input/output schemas)
- App автоматически обнаруживает и регистрирует в транспортах

**✅ Работает хорошо** - декоратор именно `@HttpEndpoint`, а не общий `@Route`.

---

## 2. АБСТРАКЦИЯ ОБРАБОТЧИКА

### Транспортная независимость ✅
**Текущее состояние:** Handler полностью независим от транспорта.

```typescript
// Один handler может работать через разные транспорты:
@HttpEndpoint('POST', '/users')
@CliEndpoint('create-user')
class CreateUserEndpoint {
  handle(payload, metadata) { /* ... */ }
}
```

**💡 Комментарий:** Это ОТЛИЧНОЕ архитектурное решение. Handler действительно
не должен знать, откуда пришёл запрос.

---

### Проблема: Разные пайплайны для одного handler'а 🤔

**Сценарий:**
```
Создание пользователя доступно через:
1. /api/users - для фронтенда (session auth)
2. /external/users - для API (API key auth)
```

**Вопросы:**
- Пайплайны разные (разная авторизация)
- Но handler - один и тот же

**Варианты решения:**

#### Вариант A: Union type для identity
```typescript
handle(payload, metadata: { identity: User | App }) {
  if (metadata.identity instanceof User) { /* ... */ }
  if (metadata.identity instanceof App) { /* ... */ }
}
```
**❌ Недостатки:** Смешивание логики в handler'е

#### Вариант B: Разные endpoint классы
```typescript
@Ht - то есть права входа в да. Если нет - тогда,
к сожалению надо будет уже делать в обработчике.

tity: User }) { /* ... */ }
}

@HttpEndpoint('POST', '/external/users')  
class CreateUserForAPI {
  handle(payload, metadata: { identity: App }) { /* ... */ }
}
```
**✅ Преимущества:** Чёткое разделение, типобезопасность
**❌ Недостатки:** Дублирование бизнес-логики

#### Вариант C: Композиция через сервисы (РЕКОМЕНДУЕТСЯ)
```typescript
@Injectable()
class UserService {
  createUser(data) { /* бизнес-логика */ }
}

@HttpEndpoint('POST', '/api/users')
class CreateUserForFrontend {
  constructor(private users: UserService) {}
  handle(payload, { identity }: { identity: User }) {
    return this.users.createUser(payload);
  }
}

@HttpEndpoint('POST', '/external/users')
class CreateUserForAPI {
  constructor(private users: UserService) {}
  handle(payload, { identity }: { identity: App }) {
    return this.users.createUser(payload);
  }
}
```
**✅ Преимущества:** 
- Бизнес-логика в одном месте (UserService)
- Endpoint'ы - тонкие адаптеры с правильной типизацией
- Можно добавлять endpoint-специфичную логику

**💡 Вывод:** Handler'ы ПАЙПЛАЙНО-зависимые. Это нормально. Используй композицию.

---

## 3. ТИПИЗАЦИЯ ПАЙПЛАЙНА

### Текущее состояние
Middleware получает `RequestContext` и может его модифицировать:

```typescript
interface IMiddleware {
  apply(ctx: RequestContext, next): Promise<ResponseContext>
}
```

**Проблема:** `RequestContext.metadata` имеет тип `unknown` - нет type safety.

---

### Идея: Типизированная цепочка middleware

```typescript
type Fn<T = any, R = any> = (arg: T) => R;

type PipedFn<Fns extends Fn[]> = 
  Fns extends [Fn<infer A, infer B>]
    ? Fn<A, B>
    : Fns extends [Fn<infer A, infer B>, ...infer Rest]
    ? Rest extends [Fn<infer C, any>, ...Fn[]]
      ? B extends C
        ? PipedFn<[Fn<A, C>, ...Rest extends [Fn<any, any>, ...infer R] ? R : []]>
        : never
      : Fn<A, B>
    : never;
```

**Цель:** 
1. Middleware₁ добавляет `identity: User` в контекст
2. Middleware₂ ЗНАЕТ на уровне типов, что `identity` уже есть
3. Handler получает типизированный контекст

**💡 Комментарий:** Это сложная типизация. Нужно взвесить:
- **За:** Type safety, IDE autocomplete
- **Против:** Сложность, многословность типов

**🎯 Рекомендация:** Начать проще - сделать систему plugin'ов для расширения контекста:

```typescript
interface RequestContext<TMetadata = unknown> {
  transport: string;
  pattern: string;
  payload: unknown;
  metadata: TMetadata;
}

// Middleware декларирует, что добавляет в metadata
interface AuthMiddleware extends IMiddleware {
  apply(ctx: RequestContext<{}>, next): Promise<ResponseContext>
  // выход: RequestContext<{ identity: User }>
}

// Handler декларирует, что ожидает
class CreateUserEndpoint implements IEndpoint<Input, Output, { identity: User }> {
  handle(payload, metadata: { identity: User }) { /* ... */ }
}
```

**❌ Проблема:** Связь между Middleware и Handler на уровне типов сложна в TypeScript.

**🔮 Будущее направление:** Исследовать type-level проверки, но не блокировать текущую разработку.

---

## 4. ИЗМЕНЯЕМЫЙ КОНТЕКСТ

### Вопрос: Должны ли middleware модифицировать payload/metadata?

**Текущая реализация:** Middleware могут модифицировать `RequestContext` и `ResponseContext`.

**Примеры:**
- ✅ Добавление заголовка `X-Response-Time` (TimingMiddleware)
- ✅ Добавление identity в metadata (AuthMiddleware)
- ⚠️  Модификация payload - спорно

**💡 Рекомендация:**
- **metadata** - изменяемый (для auth, tracing, logging)
- **payload** - READONLY (только валидация/парсинг в transport слое)

**Доступность в handler:**
```typescript
handle(payload: Input, metadata: { identity: User, traceId: string }) {
  // metadata доступен полностью - ОК
  // payload уже провалидирован - ОК
}
```

---

## 5. ВАЛИДАЦИЯ И АВТОРИЗАЦИЯ

### Валидация
**Текущая реализация:** ✅ Валидация через Zod в Transport слое
```typescript
@HttpEndpoint('POST', '/users', { 
  input: z.object({ email: z.email() }) 
})
```

**💡 Комментарий:** Правильное место. Валидация - часть нормализации входных данных.

**❌ НЕ должна быть middleware** - она должна произойти ДО попадания в пайплайн.

---

### Идентификация и Аутентификация

**Вопрос:** Middleware или фиксированная функция?

**Вариант A: Middleware** (текущий подход)
```typescript
@Injectable()
@Middleware()
class AuthMiddleware {
  apply(ctx, next) {
    const token = ctx.metadata.headers['authorization'];
    const user = await this.auth.verify(token);
    ctx.metadata.identity = user; // добавляем в контекст
    return next();
  }
}
```

**Вариант B: Transport-level** (до пайплайна)
```typescript
const transport = new HttpTransport(pipeline, {
  auth: async (headers) => {
    const token = headers['authorization'];
    return await verifyToken(token);
  }
});
```

**🎯 Рекомендация:** 
- **Идентификация/Аутентификация** - Middleware ✅
  - Может быть глобальной или специфичной для эндпоинта
  - Имеет доступ к DI контейнеру (AuthService)
  - Может логировать, трейсить

- **Identity** - First-class citizen в metadata ✅
  - Стандартизированное поле `metadata.identity`
  - Строгая типизация через generic

---

### Авторизация

**Вопрос:** Бизнес-логика или инфраструктура?

**Ответ:** Зависит от типа проверки:

#### Инфраструктурная авторизация → Middleware
```typescript
// "Может ли этот пользователь вообще вызвать этот endpoint?"
@Middleware()
class RoleGuard {
  apply(ctx, next) {
    if (!ctx.metadata.identity.roles.includes('admin')) {
      throw Fail.forbidden('Admin role required');
    }
    return next();
  }
}
```

#### Бизнес-авторизация → Handler
```typescript
// "Может ли этот пользователь удалить ЭТОТ конкретный ресурс?"
async handle({ userId }, { identity }) {
  const user = await this.users.get(userId);
  
  if (user.id !== identity.id && !identity.isAdmin) {
    throw Fail.forbidden('Cannot delete other users');
  }
  
  // ...
}
```

**💡 Комментарий:** Оба подхода валидны. Главное - не смешивать.

---

## 6. НЕРЕШЁННЫЕ ВОПРОСЫ И БУДУЩИЕ НАПРАВЛЕНИЯ

### 6.1 Декоратор @Pipeline() для endpoint'ов
**Идея:**
```typescript
const frontendPipeline = new Pipeline([SessionAuth, RateLimiter]);
const apiPipeline = new Pipeline([ApiKeyAuth]);

@HttpEndpoint('POST', '/api/users')
@UsePipeline(frontendPipeline)
class CreateUserForFrontend { /* ... */ }
```

**Проблемы:**
- Сейчас Pipeline глобальный (один на транспорт)
- Нет механизма привязки pipeline к конкретному endpoint'у

**🔮 Будущее:** Реализовать endpoint-specific pipelines

---

### 6.2 Дефолтный Pipeline в App
**Идея:**
```typescript
const app = new App({
  defaultPipeline: new Pipeline([Timing, Auth, Logging]),
  transports: { /* ... */ }
});
```

**Проблемы:**
- Как контролировать типы metadata, если pipeline дефолтный?

**🔮 Решение:** Typed Pipeline Builder

---

### 6.3 Middleware композиция и переиспользование
**Вопрос:** Как композировать middleware?

```typescript
const authPipeline = compose([Timing, Auth, Logging]);
const publicPipeline = compose([Timing, RateLimiter]);

@UsePipeline(authPipeline)
class ProtectedEndpoint { /* ... */ }
```

**🔮 Будущее:** Исследовать паттерны композиции

---

## 7. ИТОГОВЫЕ РЕКОМЕНДАЦИИ

### ✅ Что работает отлично (не трогать)
1. Handler транспортно-независим
2. Transport нормализует данные в RequestContext
3. Валидация через Zod в transport слое
4. Pipeline с middleware цепочкой
5. Success/Failure (Ok/Fail) модель
6. DI интеграция

### 🎯 Что улучшить
1. Добавить endpoint-specific pipelines через @UsePipeline()
2. Стандартизировать metadata.identity как first-class
3. Создать TypedContext для лучшей type safety
4. Документировать паттерны для разных сценариев авторизации

### 🔮 Что исследовать
1. Типизированные цепочки middleware (PipedFn)
2. Middleware композиция и переиспользование
3. Plugin система для расширения RequestContext
4. Declarative pipeline configuration

---

## 8. СПРАВОЧНИК ПО ТЕРМИНАМ

| Термин | Определение | Пример |
|--------|-------------|--------|
| Handler | Бизнес-логика endpoint'а | `CreateUserEndpoint.handle()` |
| Pipeline | Цепочка middleware + handler | `Timing → Auth → Handler` |
| Transport | Адаптер внешнего протокола | `HttpTransport`, `CliTransport` |
| Middleware | Инфраструктурная логика | `AuthMiddleware`, `LoggingMiddleware` |
| RequestContext | Нормализованный запрос | `{ transport, pattern, payload, metadata }` |
| ResponseContext | Нормализованный ответ | `{ isSuccess, status, value, headers }` |
| Endpoint | Точка входа (класс + декоратор) | `@HttpEndpoint('POST', '/users')` |

