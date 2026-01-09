# Example: App with HTTP Transport

Этот пример демонстрирует полную интеграцию **@nestling/app** с **DI-контейнером**, **HTTP транспортом**, **endpoints** и **middleware**, включая все возможности фреймворка для обработки HTTP-запросов.

## Особенности

✅ **Автоматическое обнаружение endpoints** - декорированные `@Endpoint` классы регистрируются автоматически  
✅ **Автоматическое обнаружение middleware** - декорированные `@Middleware` классы регистрируются автоматически  
✅ **Dependency Injection** - endpoints и middleware получают зависимости из контейнера  
✅ **Модульная архитектура** - `makeAppModule` для организации кода  
✅ **Type-safe endpoints** - Zod схемы для валидации входных/выходных данных  
✅ **Success/Failure patterns** - различные способы возврата результатов  
✅ **Streaming** - поддержка стриминга данных на вход и выход  
✅ **File uploads** - работа с multipart/form-data  
✅ **Кастомные заголовки** - ETag, Cache-Control, Location и др.  
✅ **Полное тестирование** - unit и E2E тесты

## Структура проекта

```
packages/examples.app-with-http/
├── src/
│   ├── common/                      # Общие утилиты
│   │   ├── constants.ts            # HTTP статус коды, константы
│   │   └── types.ts                # Shared типы (User, ImportResult)
│   │
│   ├── modules/
│   │   ├── logger/                 # Модуль логирования
│   │   │   ├── logger.service.ts
│   │   │   └── logger.module.ts
│   │   │
│   │   └── users/                  # Модуль пользователей
│   │       ├── user.service.ts
│   │       ├── user.service.spec.ts        # unit-тест для сервиса
│   │       ├── users.module.ts
│   │       ├── endpoints/
│   │       │   ├── get-user.endpoint.ts
│   │       │   ├── get-user.endpoint.spec.ts
│   │       │   ├── list-users.endpoint.ts
│   │       │   ├── list-users.endpoint.spec.ts
│   │       │   ├── create-user.endpoint.ts
│   │       │   ├── create-user.endpoint.spec.ts
│   │       │   ├── update-user.endpoint.ts
│   │       │   ├── update-user.endpoint.spec.ts
│   │       │   ├── delete-user.endpoint.ts
│   │       │   ├── delete-user.endpoint.spec.ts
│   │       │   ├── search-users.endpoint.ts
│   │       │   ├── search-users.endpoint.spec.ts
│   │       │   ├── export-users.endpoint.ts
│   │       │   ├── export-users.endpoint.spec.ts
│   │       │   ├── import-users.endpoint.ts
│   │       │   ├── import-users.endpoint.spec.ts
│   │       │   ├── upload-avatar.endpoint.ts
│   │       │   └── upload-avatar.endpoint.spec.ts
│   │       └── middleware/
│   │           ├── timing.middleware.ts
│   │           └── timing.middleware.spec.ts
│   │
│   └── main.ts
│
├── e2e/                                # E2E тесты
│   ├── helpers/
│   │   ├── create-test-app.ts         # Создание тестового приложения
│   │   └── http-client.ts             # HTTP клиент для тестов
│   ├── setup.ts                       # Глобальный setup
│   ├── teardown.ts                    # Глобальный teardown
│   ├── users-crud.e2e.spec.ts         # E2E тесты CRUD операций
│   ├── users-search.e2e.spec.ts       # E2E тесты поиска
│   ├── streaming.e2e.spec.ts          # E2E тесты стриминга
│   └── files.e2e.spec.ts              # E2E тесты работы с файлами
│
├── jest.config.js                     # Базовый jest config (unit)
├── jest.e2e.config.js                 # Jest config для e2e
└── package.json
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
yarn start:dev
```

## Эндпоинты

### CRUD операции

#### GET /api/users
Получить список всех пользователей (возврат напрямую, без `new Ok()`)

```bash
curl http://localhost:3000/api/users
```

#### GET /api/users/:id
Получить пользователя по ID с заголовками ETag и Cache-Control

```bash
curl http://localhost:3000/api/users/1
```

**Заголовки ответа:**
- `ETag: "1-alice@example.com"`
- `Cache-Control: max-age=300`

#### POST /api/users
Создать нового пользователя с заголовком Location

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Charlie", "email": "charlie@example.com"}'
```

**Заголовки ответа:**
- `Location: /api/users/3`
- `Status: 201 Created`

**Ошибки:**
- `400 Bad Request` - если email уже существует или невалидный

#### PATCH /api/users/:id
Обновить пользователя (возврат напрямую, без `new Ok()`)

```bash
curl -X PATCH http://localhost:3000/api/users/1 \
  -H "Content-Type: application/json" \
  -d '{"name": "Updated Name"}'
```

**Ошибки:**
- `404 Not Found` - пользователь не найден
- `400 Bad Request` - email уже занят или нет данных для обновления

#### DELETE /api/users/:id
Удалить пользователя (возвращает `204 No Content`)

```bash
curl -X DELETE http://localhost:3000/api/users/2
```

**Ошибки:**
- `404 Not Found` - пользователь не найден
- `403 Forbidden` - попытка удалить admin пользователя (id=1)

### Поиск

#### GET /api/users/search?q=...
Поиск пользователей по имени или email с кастомными заголовками

```bash
curl "http://localhost:3000/api/users/search?q=Alice"
```

**Заголовки ответа:**
- `X-Total-Count: 1`
- `Cache-Control: max-age=60`

**Ошибки:**
- `400 Bad Request` - если query параметр отсутствует или пустой

### Streaming

#### GET /api/users/export
Экспорт всех пользователей через NDJSON stream

```bash
curl http://localhost:3000/api/users/export
```

**Заголовки ответа:**
- `Content-Type: application/x-ndjson`
- `Content-Disposition: attachment; filename="users.ndjson"`

**Формат ответа:** Каждая строка - валидный JSON объект пользователя

#### POST /api/users/import
Импорт пользователей из NDJSON stream

```bash
curl -X POST http://localhost:3000/api/users/import \
  -H "Content-Type: application/x-ndjson" \
  -d $'{"name":"User1","email":"user1@test.com"}\n{"name":"User2","email":"user2@test.com"}'
```

**Заголовки ответа:**
- `X-Import-Status: complete` или `partial`

**Формат ответа:**
```json
{
  "imported": 2,
  "failed": 0,
  "errors": [] // опционально, если были ошибки
}
```

### Работа с файлами

#### POST /api/users/:id/avatar
Загрузка аватара пользователя (multipart/form-data)

```bash
curl -X POST http://localhost:3000/api/users/1/avatar \
  -F "avatar=@/path/to/image.png"
```

**Ошибки:**
- `404 Not Found` - пользователь не найден
- `400 Bad Request` - файл не является изображением или слишком большой (>5MB)

## Success/Failure Patterns

### Success patterns

#### 1. `new Ok(data)` - явный успех
```typescript
return new Ok(user, {
  'ETag': etag,
  'Cache-Control': 'max-age=300',
});
```

#### 2. `return data` - автоматический Ok
```typescript
// Возвращаем напрямую - автоматически обернется в Ok
return users;
```

#### 3. `Ok.created(data)` - статус 201
```typescript
return Ok.created(user, {
  'Location': `/api/users/${user.id}`,
});
```

#### 4. `Ok.noContent()` - статус 204
```typescript
return Ok.noContent();
```

### Failure patterns

#### 1. `Fail.badRequest()` - невалидные данные
```typescript
throw Fail.badRequest('Email already taken', { field: 'email' });
```

#### 2. `Fail.notFound()` - ресурс не найден
```typescript
throw Fail.notFound('User not found');
```

#### 3. `Fail.forbidden()` - нет прав
```typescript
throw Fail.forbidden('Cannot delete admin user');
```

## Кастомные заголовки

Примеры использования кастомных заголовков:

- **ETag** - для кэширования (`GetUserEndpoint`)
- **Cache-Control** - управление кэшем (`GetUserEndpoint`, `SearchUsersEndpoint`)
- **Location** - URL созданного ресурса (`CreateUserEndpoint`)
- **X-Total-Count** - количество найденных записей (`SearchUsersEndpoint`)
- **X-Import-Status** - статус импорта (`ImportUsersEndpoint`)
- **Content-Disposition** - для скачивания файлов (`ExportUsersEndpoint`)

## Streaming

### Streaming output

```typescript
async handle(): Output<AsyncIterableIterator<User>> {
  const stream = this.userService.exportAll();
  
  return new Ok(stream, {
    'Content-Type': 'application/x-ndjson',
    'Content-Disposition': 'attachment; filename="users.ndjson"',
  });
}
```

### Streaming input

```typescript
@Endpoint({
  input: stream(UserSchema),
})
async handle(payload: AsyncIterableIterator<User>): Output<ImportResult> {
  const result = await this.userService.importUsers(payload);
  return new Ok(result);
}
```

## File Upload

```typescript
@Endpoint({
  input: withFiles(FormSchema),
})
async handle(payload: { data: FormData; files: FilePart[] }): Output<User> {
  const avatarFile = payload.files.find(f => f.field === 'avatar');
  
  // Валидация типа и размера файла
  if (!avatarFile.mime.startsWith('image/')) {
    throw Fail.badRequest('Only images are allowed');
  }
  
  // ...
}
```

## Тестирование

### Unit тесты

```bash
# Запустить все unit тесты
yarn test:unit

# В watch режиме
yarn test:watch

# С покрытием
yarn test:coverage
```

### E2E тесты

```bash
# Запустить все E2E тесты
yarn test:e2e

# Запустить все тесты (unit + e2e)
yarn test:all
```

## Ключевые концепции

### 1. Endpoints с DI

```typescript
@Injectable([UserService, ILogger])
@Endpoint({
  transport: 'http',
  pattern: 'GET /api/users/:id',
  input: GetUserInput,
  output: GetUserOutput,
})
export class GetUserEndpoint implements IEndpoint {
  constructor(
    private userService: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(payload: GetUserInput): Output<GetUserOutput> {
    const user = await this.userService.getById(payload.id);
    if (!user) {
      throw Fail.notFound('User not found');
    }
    return new Ok(user);
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
    response.headers = response.headers || {};
    response.headers['X-Response-Time'] = `${duration}ms`;
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
  endpoints: [
    GetUserEndpoint,
    ListUsersEndpoint,
    CreateUserEndpoint,
    UpdateUserEndpoint,
    DeleteUserEndpoint,
    SearchUsersEndpoint,
    ExportUsersEndpoint,
    ImportUsersEndpoint,
    UploadAvatarEndpoint,
  ],
});
```

### 4. App инициализация

```typescript
const app = new App({
  modules: [LoggerModule, UsersModule],
  transports: {
    http: new HttpTransport({ port: 3000 }),
  },
});

await app.run(); // init + listen + graceful shutdown
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

## Покрытие функциональности

| Функциональность | Endpoint | Unit Test | E2E Test |
|-----------------|----------|-----------|----------|
| **Success patterns** |
| `new Ok(data)` | ✅ GetUser | ✅ | ✅ |
| `return data` (direct) | ✅ ListUsers, UpdateUser | ✅ | ✅ |
| `Ok.created()` | ✅ CreateUser | ✅ | ✅ |
| `Ok.noContent()` | ✅ DeleteUser | ✅ | ✅ |
| **Failure patterns** |
| `Fail.notFound()` | ✅ GetUser, UpdateUser, DeleteUser, UploadAvatar | ✅ | ✅ |
| `Fail.badRequest()` | ✅ CreateUser, UpdateUser, Search, Import, Upload | ✅ | ✅ |
| `Fail.forbidden()` | ✅ DeleteUser (admin) | ✅ | ✅ |
| `Fail с details` | ✅ CreateUser (email duplicate) | ✅ | ✅ |
| **Advanced features** |
| Кастомные заголовки | ✅ GetUser, Search, Create, Export | ✅ | ✅ |
| Query параметры | ✅ Search | ✅ | ✅ |
| Streaming output | ✅ ExportUsers | ✅ | ✅ |
| Streaming input | ✅ ImportUsers | ✅ | ✅ |
| File upload | ✅ UploadAvatar | ✅ | ✅ |
| Middleware | ✅ TimingMiddleware | ✅ | ✅ |

## Дальнейшее развитие

Можно добавить:
- **Guards** для авторизации
- **Interceptors** для pre/post обработки
- **Pipes** для трансформации данных
- **Фильтры по транспортам** для middleware
- **Request-scoped провайдеры**
