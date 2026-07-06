# App + Container Integration Plan

Дата: 8 января 2026

## Цель

Интегрировать DI-контейнер в класс App для автоматического обнаружения и регистрации endpoint-хэндлеров с поддержкой dependency injection.

## Архитектурные решения

### 1. Стратегия поиска хэндлеров

**Решение:** Использовать глобальный registry для классов, декорированных `@Endpoint`.

**Обоснование:**
- Не нужно проходить по всем провайдерам контейнера
- Registry уже используется в декораторе `@Endpoint` (через Symbol)
- Позволяет быстро найти все endpoint-классы без обхода всего дерева зависимостей

**Реализация:**
- Создать глобальный registry в `@nestling/pipeline` для отслеживания всех классов с декоратором `@Endpoint`
- Декоратор `@Endpoint` автоматически регистрирует класс в этом registry
- App использует этот registry для автоматического обнаружения

### 2. API для инициализации

**Решение:** App принимает модули и провайдеры в конструкторе, инициализация контейнера происходит в `app.init()`.

```typescript
// Создание App
const app = new App({
  transports: {
    http: httpTransport,
    cli: cliTransport,
  },
  modules: [AppModule, LoggingModule],
  providers: [SomeService],
});

// Инициализация контейнера и регистрация endpoints
await app.init();

// Запуск транспортов
await app.listen();
```

**Структура App:**
- **Конструктор** - принимает транспорты, модули и провайдеры
- **app.init()** - строит контейнер, запускает lifecycle hooks, регистрирует endpoints
- **app.listen()** - запускает транспорты
- **app.close()** - останавливает транспорты и уничтожает контейнер

### 3. DI для хэндлеров

**Решение:** Endpoint-классы ДОЛЖНЫ быть декорированы `@Injectable` и получают зависимости через DI.

**Обоснование:**
- Единообразный подход к управлению зависимостями
- Возможность инъекции сервисов (логгеры, репозитории, и т.д.)
- Поддержка lifecycle hooks (@OnInit, @OnDestroy)

**Требования:**
```typescript
@Injectable([UserService, ILogger('users')])
@Endpoint({
  transport: 'http',
  pattern: 'GET /users/:id',
  input: UserIdSchema,
  output: UserResponseSchema,
})
class GetUserByIdEndpoint implements IEndpoint {
  constructor(
    private userService: UserService,
    private logger: ILogger
  ) {}

  async handle(payload, metadata) {
    // ...
  }
}
```

### 4. makeAppModule

**Решение:** Создать высокоуровневое API на уровне `@nestling/app` для модулей с endpoints и middleware.

**Обоснование:**
- Контейнер не должен знать про endpoints/middleware (separation of concerns)
- Модули с endpoints/middleware - это концепция уровня приложения, а не контейнера
- makeAppModule - это wrapper над makeModule

```typescript
// В @nestling/app
export interface AppModule extends Module {
  endpoints?: Constructor<IEndpoint>[];
  middleware?: Constructor<IMiddleware>[];
}

export function makeAppModule(config: AppModule): Module {
  const { endpoints = [], middleware = [], ...moduleConfig } = config;
  
  // endpoints и middleware автоматически добавляются в providers
  return makeModule({
    ...moduleConfig,
    providers: [
      ...(Array.isArray(moduleConfig.providers) 
        ? moduleConfig.providers 
        : []),
      ...endpoints,
      ...middleware,
    ],
  });
}
```

**Использование:**
```typescript
import { makeAppModule } from '@nestling/app';

export const UsersModule = makeAppModule({
  name: 'module:users',
  providers: [UserService, UserRepository],
  middleware: [AuthMiddleware, LoggingMiddleware],
  endpoints: [
    GetUserByIdEndpoint,
    CreateUserEndpoint,
    UpdateUserEndpoint,
  ],
  imports: [DatabaseModule],
  exports: [UserService],
});
```

### 5. Middleware с DI

**Решение:** Middleware должны быть провайдерами и поддерживать dependency injection.

**Обоснование:**
- Middleware часто нуждаются в зависимостях (логгеры, сервисы аутентификации, метрики)
- Консистентность с endpoints - оба используют DI
- Поддержка lifecycle hooks (@OnInit, @OnDestroy)
- Улучшение тестируемости

**Подход:**
```typescript
// Middleware с DI
@Injectable([IAuthService, ILogger('auth')])
@Middleware()
class AuthMiddleware implements IMiddleware {
  constructor(
    private authService: IAuthService,
    private logger: ILogger
  ) {}
  
  async apply(ctx: RequestContext, next: () => Promise<ResponseContext>) {
    const token = ctx.headers?.['authorization'];
    const user = await this.authService.verify(token);
    this.logger.log(`User ${user.id} authenticated`);
    ctx.user = user;
    return next();
  }
}

// Регистрация через makeAppModule
const ApiModule = makeAppModule({
  name: 'module:api',
  providers: [AuthService],
  middleware: [AuthMiddleware],
  endpoints: [GetUserEndpoint],
});
```

## План реализации

### Фаза 1: Расширение Pipeline (@nestling/pipeline)

**Задачи:**

1. ✅ Создать глобальный endpoint registry
   - Файл: `packages/nestling.pipeline/src/metadata/endpoint-registry.ts`
   - Функции:
     - `registerEndpoint(ctor: Constructor<IEndpoint>): void`
     - `getAllEndpoints(): Constructor<IEndpoint>[]`
     - `clearRegistry(): void` (для тестов)

2. ✅ Модифицировать декоратор `@Endpoint`
   - При декорировании класса автоматически регистрировать его в registry
   - Проверить, что класс также декорирован `@Injectable`

3. ✅ Экспортировать registry функции
   - Добавить в `packages/nestling.pipeline/src/index.ts`

### Фаза 2: Расширение App (@nestling/app)

**Задачи:**

1. ✅ Создать `makeAppModule`
   - Файл: `packages/nestling.app/src/module.ts`
   - Тип `AppModule` расширяющий `Module`
   - Функция обёртка над `makeModule`
   - Поддержка полей `endpoints` и `middleware`

2. ✅ Рефакторинг класса `App`
   - Изменить конструктор:
     ```typescript
     constructor(config: {
       transports: Record<string, ITransport>;
       modules?: Module[];
       providers?: Provider[];
     })
     ```
   - Хранить модули и провайдеры как поля класса
   - Контейнер становится приватным полем `#container?: BuiltContainer`

3. ✅ Реализовать `app.init()`
   - Построить контейнер из модулей и провайдеров
   - Запустить `container.init()` для lifecycle hooks
   - Автоматически обнаружить endpoints через:
     - Registry (все классы с `@Endpoint`)
     - Проверить, что они есть в контейнере
     - Зарегистрировать их через `this.registerClass()`
   - **Примечание:** Middleware регистрация добавляется в Фазе 4
   - Поддержать идемпотентность (можно вызывать повторно безопасно)

4. ✅ Обновить `app.close()`
   - Остановить транспорты
   - Вызвать `container.destroy()` для lifecycle hooks

5. ✅ Удалить метод `app.endpoint()`
   - Убрать метод из публичного API
   - Убрать методы `registerClass()` и `registerPlain()` (они теперь приватные для внутреннего использования)

### Фаза 3: Обновление примеров

**Задачи:**

1. ✅ Создать новый пример `examples.simple-app-with-http`
   - Скопировать структуру из `examples.simple-app`
   - Добавить HTTP endpoints с DI
   - Использовать `makeModuleWithEndpoints`
   - Продемонстрировать инъекцию зависимостей в endpoints

2. ✅ Обновить документацию
   - README.md с примерами использования
   - Документация в коде (JSDoc)

### Фаза 4: Middleware с DI

**Задачи:**

1. ✅ Создать глобальный middleware registry (аналогично endpoint registry)
   - Файл: `packages/nestling.pipeline/src/metadata/middleware-registry.ts`
   - Функции:
     - `registerMiddleware(ctor: Constructor<IMiddleware>): void`
     - `getAllMiddleware(): Constructor<IMiddleware>[]`

2. ✅ Модифицировать декоратор `@Middleware`
   - Автоматически регистрировать в registry
   - Опционально проверять наличие `@Injectable`

3. ✅ Расширить `app.init()`
   - Обнаружить middleware через registry
   - Получить инстансы из контейнера (если есть `@Injectable`)
   - Зарегистрировать в транспортах через новый метод

4. ✅ Добавить методы в Transport
   - `transport.useInstance(instance: IMiddleware)` - для middleware из контейнера
   - Сохранить существующий `transport.use()` для обратной совместимости

5. ✅ Связать middleware с транспортами
   - Middleware в модуле должны знать, для какого транспорта они предназначены
   - Опция 1: Добавить поле `transport` в декоратор `@Middleware()`
   - Опция 2: Регистрировать глобально для всех транспортов
   - **Решение:** Начать с глобальной регистрации, потом добавить фильтрацию

### Фаза 5: Тестирование

**Задачи:**

1. ✅ Юнит-тесты для endpoint registry
2. ✅ Юнит-тесты для middleware registry
3. ✅ Юнит-тесты для `makeAppModule`
4. ✅ Интеграционные тесты для `App.init()` (endpoints + middleware)
5. ✅ Тесты для различных сценариев (endpoints + middleware вместе)
6. ✅ Тесты для middleware с DI
7. ✅ Тесты для обработки ошибок (endpoint не в контейнере, middleware не в контейнере)

## Критические моменты

### 1. Порядок декораторов

Endpoint/Middleware-классы должны иметь ОБА декоратора:

```typescript
@Injectable([Dep1, Dep2])  // ПЕРВЫЙ - для DI
@Endpoint({ ... })          // ВТОРОЙ - для метаданных endpoint
class MyEndpoint { }

@Injectable([Logger])       // ПЕРВЫЙ - для DI
@Middleware()               // ВТОРОЙ - для метаданных middleware
class MyMiddleware { }
```

**Проблема:** Если порядок нарушен, TypeScript может не вывести типы корректно.

**Решение:** 
- Добавить валидацию в декораторы `@Endpoint` и `@Middleware`
- Если есть `@Injectable` - использовать инстанс из контейнера
- Если нет - создавать через `new` (для обратной совместимости)

### 2. Контейнер и endpoints

**Проблема:** Endpoints должны быть в контейнере, чтобы получить DI.

**Решение:** 
- `makeAppModule` автоматически добавляет endpoints в providers
- App обнаруживает endpoints через registry и проверяет наличие в контейнере
- Если endpoint в registry, но не в контейнере - выбрасывается понятная ошибка

### 3. Lifecycle методы

**Проблема:** Когда вызывать `container.init()` и `container.destroy()`?

**Решение:**
- `container.init()` вызывается в `app.init()`
- `container.destroy()` вызывается в `app.close()`
- Endpoints создаются ПОСЛЕ `container.init()`, поэтому их lifecycle hooks уже выполнены

### 4. Функциональные endpoints

**Проблема:** Функциональные endpoints (через `makeEndpoint`) не имеют DI.

**Решение:** Это нормально - функциональные endpoints остаются stateless, классовые endpoints получают DI.

### 5. Middleware и транспорты

**Проблема:** Разные транспорты могут требовать разные middleware. Как связать middleware с конкретными транспортами?

**Решение (первая итерация):**
- Middleware из модулей регистрируются глобально во ВСЕХ транспортах
- Порядок определяется порядком импорта модулей
- В будущем можно добавить фильтрацию:
  ```typescript
  @Middleware({ transport: 'http' })
  class HttpOnlyMiddleware { }
  ```

**Проблема:** Порядок выполнения middleware из разных модулей?

**Решение:**
- Сначала выполняются middleware, зарегистрированные напрямую через `transport.use()`
- Затем middleware из модулей в порядке импорта модулей
- В будущем можно добавить приоритеты

## Пример использования (финальный)

```typescript
// 1. Определяем middleware с DI
@Injectable([IAuthService, ILogger('auth')])
@Middleware()
class AuthMiddleware implements IMiddleware {
  constructor(
    private authService: IAuthService,
    private logger: ILogger
  ) {}

  async apply(ctx: RequestContext, next: () => Promise<ResponseContext>) {
    const token = ctx.headers?.['authorization'];
    
    if (!token) {
      throw new Fail('UNAUTHORIZED', 'No token provided');
    }
    
    const user = await this.authService.verify(token);
    this.logger.log(`User ${user.id} authenticated`);
    ctx.user = user;
    
    return next();
  }
}

// 2. Определяем endpoint с DI
@Injectable([UserService, ILogger('api')])
@Endpoint({
  transport: 'http',
  pattern: 'GET /api/users/:id',
  input: z.object({ id: z.string() }),
  output: z.object({ name: z.string(), email: z.string() }),
})
class GetUserEndpoint implements IEndpoint {
  constructor(
    private userService: UserService,
    private logger: ILogger
  ) {}

  async handle(payload: { id: string }) {
    this.logger.log(`Getting user ${payload.id}`);
    const user = await this.userService.getById(payload.id);
    return { status: 200, value: user, meta: {} };
  }
}

// 3. Создаём модуль с middleware и endpoints
const UsersModule = makeAppModule({
  name: 'module:users',
  providers: [UserService, UserRepository, AuthService],
  middleware: [AuthMiddleware],
  endpoints: [GetUserEndpoint],
  imports: [DatabaseModule, LoggingModule],
  exports: [UserService],
});

// 4. Создаём и запускаем приложение
const app = new App({
  transports: {
    http: new HttpTransport({ port: 3000 }),
  },
  modules: [LoggingModule, UsersModule],
});

// Инициализация контейнера и автоматическая регистрация endpoints/middleware
await app.init();

// Запуск транспортов
await app.listen();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await app.close(); // останавливает транспорты и уничтожает контейнер
});
```

## Breaking Changes и Миграция

**BREAKING CHANGE:** Метод `app.endpoint()` удаляется. App теперь ВСЕГДА требует контейнер и модули.

### Миграция существующего кода

**Было (старый способ):**
```typescript
const app = new App({
  http: new HttpTransport({ port: 3000 }),
});

app.endpoint(SayHello);
app.endpoint(GetUserEndpoint);

await app.listen();
```

**Стало (новый способ):**
```typescript
// 1. Преобразуем функциональные endpoints в классы
@Injectable([])
@Endpoint({
  transport: 'http',
  pattern: 'GET /',
  handle: async () => ({ value: 'Hello' }),
})
class SayHelloEndpoint implements IEndpoint {
  async handle() {
    return { value: 'Hello' };
  }
}

// 2. Создаём модуль с endpoints
const AppEndpointsModule = makeAppModule({
  name: 'module:endpoints',
  endpoints: [SayHelloEndpoint, GetUserEndpoint],
});

// 3. Используем новый API
const app = new App({
  transports: {
    http: new HttpTransport({ port: 3000 }),
  },
  modules: [AppEndpointsModule],
});

await app.init();
await app.listen();
```

**Альтернатива для простых случаев:** Можно передать endpoints напрямую как providers:
```typescript
const app = new App({
  transports: {
    http: new HttpTransport({ port: 3000 }),
  },
  providers: [SayHelloEndpoint, GetUserEndpoint],
});
```

**Требование:** Если переданы модули/providers, то `app.init()` ОБЯЗАТЕЛЕН до `app.listen()`.

## Возможные улучшения (будущее)

1. **Scope endpoints/middleware** - request-scoped или transient scope (новый инстанс на каждый запрос/вызов)
2. **Middleware filtering** - фильтрация middleware по транспорту/роуту
   ```typescript
   @Middleware({ transport: 'http', routes: ['/api/*'] })
   class ApiAuthMiddleware { }
   ```
3. **Lazy loading** - отложенная инициализация модулей с endpoints
4. **Health checks** - автоматические health check endpoints
5. **Interceptors** - pre/post обработка на уровне приложения (как в NestJS)
6. **Guards** - декларативные проверки доступа на уровне endpoints
7. **Pipes** - трансформация и валидация данных как отдельные компоненты

## Вопросы для обсуждения

### Endpoints

1. ❓ Нужна ли валидация на наличие `@Injectable` при использовании `@Endpoint`?
   - **Ответ:** Пока не ясно, можно ли это вообще сделать. Требуется исследование.
   
2. ~~❓ Должны ли функциональные endpoints иметь доступ к контейнеру?~~
   - **Ответ:** Нет. Убрать `app.endpoint()` полностью - нет смысла в endpoints вне контейнера, если контейнер есть.
   - **Следствие:** Только автоматическая регистрация через `makeAppModule`, ручная регистрация удаляется.
   
3. ❓ Как обрабатывать ситуацию, когда endpoint в registry, но не в контейнере?
   - **Ответ:** Выбросить понятную ошибку с указанием имени endpoint и подсказкой (добавить в providers модуля).
   
4. ~~❓ Нужен ли специальный lifecycle hook для endpoints?~~
   - **Ответ:** Нет. Endpoints - это просто часть контейнера, используют стандартные lifecycle hooks.

### Middleware

5. ❓ Как middleware должны узнавать, для какого транспорта они предназначены?
   - **Опция A:** Глобально для всех транспортов (проще, но менее гибко)
   - **Опция B:** Указывать транспорт в декораторе `@Middleware({ transport: 'http' })`
   - **Опция C:** В конфигурации модуля указывать связь middleware→transport
   - **Предложение:** Начать с глобальной регистрации (A), позже добавить фильтрацию

6. ❓ Должны ли middleware поддерживать per-route регистрацию?
   ```typescript
   @Middleware({ routes: ['/api/*', '/admin/*'] })
   class ApiAuthMiddleware { }
   ```
   - **Предложение:** Отложить на будущее (фаза 2)

7. ❓ Порядок выполнения middleware из разных модулей?
   - **Опция A:** Порядок импорта модулей
   - **Опция B:** Явный приоритет `@Middleware({ priority: 10 })`
   - **Предложение:** Начать с A (порядок модулей), позже добавить B

8. ❓ Должен ли `@Middleware` требовать обязательное наличие `@Injectable`?
   - Для консистентности с endpoints - да
   - Но нужна обратная совместимость
   - **Предложение:** Опционально - если есть `@Injectable`, берём из контейнера, иначе `new`

## Заметки

- Контейнер не знает про endpoints/middleware - это важно для разделения ответственности
- Endpoints и Middleware - это обычные провайдеры для контейнера, но с дополнительными метаданными
- App работает как оркестратор: контейнер управляет зависимостями, транспорты обрабатывают запросы
- Middleware с DI позволяют инъектировать сервисы (auth, logging, metrics) прямо в цепочку обработки
- Registry паттерн используется для автоматического обнаружения как endpoints, так и middleware
- Первая итерация - простая (глобальная регистрация), вторая - с фильтрацией по транспортам/роутам

