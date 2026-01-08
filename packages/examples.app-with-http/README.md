# Example: App with HTTP Transport

Этот пример демонстрирует полную интеграцию **@nestling/app** с **DI-контейнером**, **HTTP транспортом**, **endpoints** и **middleware**.

## Особенности

✅ **Автоматическое обнаружение endpoints** - декорированные `@Endpoint` классы регистрируются автоматически  
✅ **Автоматическое обнаружение middleware** - декорированные `@Middleware` классы регистрируются автоматически  
✅ **Dependency Injection** - endpoints и middleware получают зависимости из контейнера  
✅ **Модульная архитектура** - `makeAppModule` для организации кода  
✅ **Type-safe endpoints** - Zod схемы для валидации входных/выходных данных  
✅ **Lifecycle hooks** - `@OnInit` и `@OnDestroy` поддерживаются через контейнер  

## Структура

```
src/
├── logger.service.ts      # Сервис логгера с DI
├── logger.module.ts       # Модуль логгера
├── user.service.ts        # Бизнес-логика пользователей
├── timing.middleware.ts   # Middleware для измерения времени
├── get-user.endpoint.ts   # GET /api/users/:id
├── list-users.endpoint.ts # GET /api/users
├── create-user.endpoint.ts # POST /api/users
├── users.module.ts        # Модуль пользователей с endpoints/middleware
└── main.ts                # Точка входа приложения
```

## Как запустить

```bash
# Установить зависимости (из корня проекта)
yarn install

# Собрать пример
cd packages/examples.app-with-http
yarn build

# Запустить
yarn start
```

Или в dev режиме:
```bash
yarn dev
```

## Эндпоинты

**GET /api/users**  
Получить список всех пользователей

```bash
curl http://localhost:3000/api/users
```

**GET /api/users/:id**  
Получить пользователя по ID

```bash
curl http://localhost:3000/api/users/1
```

**POST /api/users**  
Создать нового пользователя

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Charlie", "email": "charlie@example.com"}'
```

## Ключевые концепции

### 1. Endpoints с DI

```typescript
@Injectable([UserService, ILogger])
@Endpoint({
  transport: 'http',
  pattern: 'GET /api/users/:id',
  input: InputSchema,
  output: OutputSchema,
})
export class GetUserEndpoint implements IEndpoint {
  constructor(
    private userService: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(payload: { id: string }) {
    // ...
  }
}
```

### 2. Middleware с DI

```typescript
@Injectable([ILogger])
@Middleware()
export class TimingMiddleware implements IMiddleware {
  constructor(private logger: ILoggerService) {}

  async apply(ctx: RequestContext, next: () => Promise<ResponseContext>) {
    const start = Date.now();
    const response = await next();
    const duration = Date.now() - start;
    this.logger.log(`Request took ${duration}ms`);
    return response;
  }
}
```

### 3. makeAppModule

```typescript
export const UsersModule = makeAppModule({
  name: 'module:users',
  providers: [UserService],
  middleware: [TimingMiddleware],
  endpoints: [GetUserEndpoint, ListUsersEndpoint, CreateUserEndpoint],
});
```

### 4. App инициализация

```typescript
const app = new App({
  transports: {
    http: new HttpTransport({ port: 3000 }),
  },
  modules: [LoggerModule, UsersModule],
});

await app.init();   // Строит контейнер, регистрирует endpoints/middleware
await app.listen(); // Запускает транспорты
```

## Что происходит при `app.init()`

1. **Строится DI-контейнер** из модулей и провайдеров
2. **Вызываются `@OnInit` hooks** всех сервисов в топологическом порядке
3. **Обнаруживаются middleware** из registry и регистрируются в транспортах
4. **Обнаруживаются endpoints** из registry и регистрируются в транспортах

## Graceful Shutdown

```typescript
process.on('SIGTERM', async () => {
  await app.close(); // Останавливает транспорты и вызывает @OnDestroy
  process.exit(0);
});
```

## Дальнейшее развитие

Можно добавить:
- **Guards** для авторизации
- **Interceptors** для pre/post обработки
- **Pipes** для трансформации данных
- **Фильтры по транспортам** для middleware
- **Request-scoped провайдеры**

