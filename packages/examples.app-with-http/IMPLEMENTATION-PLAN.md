# План расширения examples.app-with-http

## 🎯 Цели

1. Продемонстрировать все возможности фреймворка для обработки HTTP-запросов
2. Показать различные варианты возврата результатов (Success/Fail patterns)
3. Добавить примеры работы с заголовками, стримингом, файлами
4. Покрыть код тестами (unit + e2e)
5. Улучшить структуру проекта

---

## 📋 Текущее состояние

### Что уже есть ✅

- ✅ Базовые CRUD эндпоинты (GET list, GET by id, POST create)
- ✅ DI с Injectable/Providers
- ✅ Middleware (TimingMiddleware)
- ✅ Модульная структура (LoggerModule, UsersModule)
- ✅ Базовая валидация через Zod схемы
- ✅ Один пример обработки ошибки (throw Fail.notFound)
- ✅ Использование `new Ok()` и `Ok.created()`

### Чего не хватает ❌

#### 1. Варианты возврата Success
- ❌ Возврат напрямую объектом (без `new Ok()`)
- ❌ `Ok.accepted()` - для асинхронных операций
- ❌ `Ok.noContent()` - для DELETE операций
- ❌ Success с кастомными заголовками

#### 2. Обработка ошибок (Failure patterns)
- ❌ `Fail.badRequest()` - невалидные данные
- ❌ `Fail.forbidden()` - недостаточно прав
- ❌ `Fail.internalError()` - серверные ошибки
- ❌ Failure с details для дополнительной информации

#### 3. Продвинутые кейсы
- ❌ **Стриминг данных на выход** (AsyncIterableIterator)
- ❌ **Стриминг данных на вход** (обработка входящего stream)
- ❌ **Работа с файлами** (загрузка файлов, multipart/form-data)
- ❌ Работа с кастомными заголовками (Cache-Control, ETag, etc)
- ❌ Обработка query параметров
- ❌ Валидация с детальными ошибками

#### 4. Тестирование
- ❌ Unit тесты для эндпоинтов
- ❌ Unit тесты для сервисов
- ❌ Unit тесты для middleware
- ❌ E2E тесты для HTTP запросов
- ❌ Тестирование ошибочных сценариев

#### 5. Структура проекта
- ❌ Разделение по фичам/модулям
- ❌ Shared типы и константы

---

## 🏗️ Новая структура проекта

```
packages/examples.app-with-http/
├── src/
│   ├── common/                      # Общие утилиты
│   │   ├── constants.ts            # HTTP статус коды, сообщения ошибок
│   │   └── types.ts                # Shared типы
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
│   │       │   ├── update-user.endpoint.ts         # новый
│   │       │   ├── update-user.endpoint.spec.ts
│   │       │   ├── delete-user.endpoint.ts         # новый
│   │       │   ├── delete-user.endpoint.spec.ts
│   │       │   ├── search-users.endpoint.ts        # новый (query params)
│   │       │   ├── search-users.endpoint.spec.ts
│   │       │   ├── export-users.endpoint.ts        # новый (streaming output)
│   │       │   ├── export-users.endpoint.spec.ts
│   │       │   ├── import-users.endpoint.ts        # новый (streaming input)
│   │       │   ├── import-users.endpoint.spec.ts
│   │       │   ├── upload-avatar.endpoint.ts       # новый (file upload)
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
├── package.json
└── README.md                          # обновлённая документация
```

---

## 📝 Детальный план реализации

### Этап 1: Рефакторинг существующего кода

#### 1.1 Реорганизация файлов
- [ ] Создать папку `src/common/` для общих типов и констант
- [ ] Переместить существующие файлы в `src/modules/logger/` и `src/modules/users/`
- [ ] Создать `src/modules/users/endpoints/` и переместить туда эндпоинты
- [ ] Создать `src/modules/users/middleware/` и переместить туда TimingMiddleware
- [ ] Обновить импорты во всех файлах

#### 1.2 Общие типы и константы
- [ ] Создать `src/common/types.ts` с интерфейсом User и другими shared типами
- [ ] Создать `src/common/constants.ts` с константами (если понадобятся)

---

### Этап 2: Расширение функциональности Users

#### 2.1 Обновление UserService
**Файл:** `src/modules/users/user.service.ts`

Добавить методы:
- [ ] `update(id: string, data: Partial<User>): Promise<User | null>` - обновление пользователя
- [ ] `delete(id: string): Promise<boolean>` - удаление пользователя
- [ ] `search(query: string): Promise<User[]>` - поиск по имени/email
- [ ] `*exportAll(): AsyncIterableIterator<User>` - генератор для стриминга
- [ ] `importUsers(stream: AsyncIterableIterator<User>): Promise<{ imported: number, failed: number }>` - импорт из стрима
- [ ] `findByEmail(email: string): Promise<User | null>` - поиск по email
- [ ] `updateAvatar(userId: string, avatarUrl: string): Promise<User | null>` - обновление аватара
- [ ] Добавить валидацию email при создании (проверка на дубликаты)
- [ ] Добавить проверку на "защищенных" пользователей (например, admin с id='1')

#### 2.2 Новые endpoints

##### 2.2.1 UpdateUserEndpoint (PATCH /api/users/:id)
**Файл:** `src/modules/users/endpoints/update-user.endpoint.ts`

**Демонстрирует:**
- ✅ Возврат через просто объект (без `new Ok()`)
- ✅ `Fail.notFound()` если пользователь не найден
- ✅ `Fail.badRequest()` если невалидные данные

**Схема input:**
```typescript
const UpdateUserInput = z.object({
  id: z.string(),           // из params
  name: z.string().optional(),
  email: z.email().optional(),
});
```

**Сценарии:**
1. ✅ Успешное обновление - возврат объекта напрямую
2. ❌ Пользователь не найден - `throw Fail.notFound('User not found')`
3. ❌ Email уже занят - `throw Fail.badRequest('Email already taken', { field: 'email' })`
4. ❌ Нет данных для обновления - `throw Fail.badRequest('No data to update')`

**Unit-тесты (`update-user.endpoint.spec.ts`):**
- Успешное обновление имени
- Успешное обновление email
- Ошибка если пользователь не найден
- Ошибка если email дублируется
- Ошибка если нет данных для обновления

##### 2.2.2 DeleteUserEndpoint (DELETE /api/users/:id)
**Файл:** `src/modules/users/endpoints/delete-user.endpoint.ts`

**Демонстрирует:**
- ✅ `Ok.noContent()` для успешного удаления
- ✅ `Fail.notFound()` если пользователь не найден
- ✅ `Fail.forbidden()` если нельзя удалить (например, admin user с id='1')

**Схема input:**
```typescript
const DeleteUserInput = z.object({
  id: z.string(),
});
```

**Сценарии:**
1. ✅ Успешное удаление - `return Ok.noContent()`
2. ❌ Пользователь не найден - `throw Fail.notFound('User not found')`
3. ❌ Нельзя удалить admin - `throw Fail.forbidden('Cannot delete admin user')`

**Unit-тесты (`delete-user.endpoint.spec.ts`):**
- Успешное удаление обычного пользователя
- Ошибка если пользователь не найден
- Ошибка при попытке удалить admin (id='1')

##### 2.2.3 SearchUsersEndpoint (GET /api/users/search?q=...)
**Файл:** `src/modules/users/endpoints/search-users.endpoint.ts`

**Демонстрирует:**
- ✅ Работа с query параметрами
- ✅ Возврат с кастомными заголовками (X-Total-Count, Cache-Control)
- ✅ `Fail.badRequest()` если query параметр отсутствует или невалидный

**Схема input:**
```typescript
const SearchUsersInput = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.string().transform(Number).optional(),
});
```

**Сценарии:**
1. ✅ Успешный поиск - возврат с заголовками:
   ```typescript
   return new Ok(users, {
     'X-Total-Count': String(users.length),
     'Cache-Control': 'max-age=60',
   });
   ```
2. ❌ Отсутствует query параметр - `throw Fail.badRequest('Query parameter required')`
3. ✅ Пустой результат поиска (не ошибка, просто пустой массив)

**Unit-тесты (`search-users.endpoint.spec.ts`):**
- Успешный поиск с результатами
- Успешный поиск без результатов (пустой массив)
- Проверка заголовков (X-Total-Count, Cache-Control)
- Ошибка если query отсутствует

##### 2.2.4 ExportUsersEndpoint (GET /api/users/export)
**Файл:** `src/modules/users/endpoints/export-users.endpoint.ts`

**Демонстрирует:**
- ✅ **Streaming данных на выход** через AsyncIterableIterator
- ✅ Кастомные заголовки (Content-Type, Content-Disposition)

**Схема output:**
```typescript
// Каждый chunk - это User
const ExportUsersOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});
```

**Реализация:**
```typescript
async handle(): Output<AsyncIterableIterator<User>> {
  const stream = this.userService.exportAll();
  
  return new Ok(stream, {
    'Content-Type': 'application/x-ndjson',
    'Content-Disposition': 'attachment; filename="users.ndjson"',
  });
}
```

**Unit-тесты (`export-users.endpoint.spec.ts`):**
- Возвращает AsyncIterableIterator
- Проверка заголовков
- Мок стрима генерирует ожидаемые данные

##### 2.2.5 ImportUsersEndpoint (POST /api/users/import)
**Файл:** `src/modules/users/endpoints/import-users.endpoint.ts`

**Демонстрирует:**
- ✅ **Streaming данных на вход** (обработка входящего stream)
- ✅ Валидация каждого chunk'а стрима
- ✅ Возврат статистики импорта

**Схема input:**
```typescript
// Используем модификатор Stream
const ImportUsersInput = Stream(
  z.object({
    name: z.string(),
    email: z.email(),
  })
);
```

**Схема output:**
```typescript
const ImportUsersOutput = z.object({
  imported: z.number(),
  failed: z.number(),
  errors: z.array(z.object({
    line: z.number(),
    error: z.string(),
  })).optional(),
});
```

**Реализация:**
```typescript
async handle(stream: AsyncIterableIterator<Partial<User>>): Output<ImportResult> {
  const result = await this.userService.importUsers(stream);
  
  return new Ok(result, {
    'X-Import-Status': result.failed > 0 ? 'partial' : 'complete',
  });
}
```

**Сценарии:**
1. ✅ Успешный импорт всех пользователей
2. ✅ Частичный импорт (некоторые невалидны)
3. ❌ Ошибка валидации chunk'а

**Unit-тесты (`import-users.endpoint.spec.ts`):**
- Успешный импорт всех записей
- Частичный импорт с ошибками
- Проверка статистики (imported, failed)

##### 2.2.6 UploadAvatarEndpoint (POST /api/users/:id/avatar)
**Файл:** `src/modules/users/endpoints/upload-avatar.endpoint.ts`

**Демонстрирует:**
- ✅ **Работа с файлами** (multipart/form-data)
- ✅ Валидация типа и размера файла
- ✅ `Fail.badRequest()` для невалидных файлов

**Схема input:**
```typescript
// Используем модификатор WithFiles
const UploadAvatarInput = WithFiles(
  z.object({
    id: z.string(), // userId из params
  }),
  z.object({
    avatar: z.object({
      filename: z.string(),
      mime: z.string().refine(
        (mime) => mime.startsWith('image/'),
        'Only images are allowed'
      ),
      size: z.number().max(5_000_000, 'File too large (max 5MB)'),
    }),
  })
);
```

**Схема output:**
```typescript
const UploadAvatarOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string(),
});
```

**Реализация:**
```typescript
async handle(payload: { 
  data: { id: string }, 
  files: { avatar: FilePart } 
}): Output<User> {
  const { id } = payload.data;
  const { avatar } = payload.files;
  
  // Сохраняем файл (мок - просто сохраняем имя файла)
  const avatarUrl = `/uploads/${id}/${avatar.filename}`;
  
  const user = await this.userService.updateAvatar(id, avatarUrl);
  
  if (!user) {
    throw Fail.notFound('User not found');
  }
  
  return new Ok(user);
}
```

**Сценарии:**
1. ✅ Успешная загрузка изображения
2. ❌ Пользователь не найден
3. ❌ Файл не является изображением
4. ❌ Файл слишком большой (>5MB)

**Unit-тесты (`upload-avatar.endpoint.spec.ts`):**
- Успешная загрузка валидного файла
- Ошибка если пользователь не найден
- Проверка типа файла через мок
- Проверка размера файла через мок

##### 2.2.7 Обновление CreateUserEndpoint
**Файл:** `src/modules/users/endpoints/create-user.endpoint.ts`

**Добавить сценарии:**
- ❌ Email уже существует - `throw Fail.badRequest('Email already taken', { field: 'email' })`
- ✅ Добавить кастомный заголовок Location с URL созданного ресурса

**Обновлённая реализация:**
```typescript
async handle(payload: CreateUserInput): Output<CreateUserOutput> {
  // Проверка на дубликат email
  const existing = await this.users.findByEmail(payload.email);
  if (existing) {
    throw Fail.badRequest('Email already taken', { field: 'email' });
  }

  const user = await this.users.create(payload);
  
  return Ok.created(user, {
    'Location': `/api/users/${user.id}`,
  });
}
```

**Обновлённые unit-тесты (`create-user.endpoint.spec.ts`):**
- Успешное создание
- Проверка заголовка Location
- Ошибка при дубликате email

##### 2.2.8 Обновление GetUserEndpoint
**Файл:** `src/modules/users/endpoints/get-user.endpoint.ts`

**Добавить:**
- ✅ Кастомные заголовки (ETag, Cache-Control)

**Обновлённая реализация:**
```typescript
async handle(payload: GetUserInput): Output<GetUserOutput> {
  const user = await this.userService.getById(payload.id);
  
  if (!user) {
    throw Fail.notFound('User not found');
  }
  
  // Генерируем ETag на основе данных
  const etag = `"${user.id}-${user.email}"`;
  
  return new Ok(user, {
    'ETag': etag,
    'Cache-Control': 'max-age=300',
  });
}
```

**Обновлённые unit-тесты (`get-user.endpoint.spec.ts`):**
- Успешный запрос с проверкой заголовков
- Ошибка если не найден

##### 2.2.9 Обновление ListUsersEndpoint
**Файл:** `src/modules/users/endpoints/list-users.endpoint.ts`

**Изменить:**
- ✅ Возврат напрямую объектом (изменить с `new Ok()` на просто `return users`)

**Обновлённая реализация:**
```typescript
async handle(): Output<ListUsersOutput> {
  this.logger.log('Handling GET /api/users');
  
  const users = await this.users.getAll();
  
  // Возвращаем напрямую - автоматически обернется в Ok
  return users;
}
```

**Unit-тесты (`list-users.endpoint.spec.ts`):**
- Успешный запрос возвращает массив
- Проверка, что не используется new Ok (тестируем напрямую)

---

### Этап 3: Настройка тестирования

#### 3.1 Unit тесты (Jest)

##### 3.1.1 Конфигурация
**Файл:** `jest.config.js`

```javascript
const baseConfig = require('../../jest.config.base.js');

module.exports = {
  ...baseConfig,
  displayName: 'examples.app-with-http',
  testMatch: ['**/*.spec.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
  ],
};
```

##### 3.1.2 Структура unit-тестов для endpoint

**Шаблон теста:**
```typescript
import { Ok, Fail } from '@nestling/pipeline';
import { GetUserEndpoint } from './get-user.endpoint';
import type { UserService } from '../user.service';
import type { ILoggerService } from '../../logger/logger.service';

describe('GetUserEndpoint', () => {
  let endpoint: GetUserEndpoint;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    // Создаем моки
    userService = {
      getById: jest.fn(),
    } as any;
    
    logger = {
      log: jest.fn(),
    } as any;
    
    // Создаем endpoint с моками
    endpoint = new GetUserEndpoint(userService, logger);
  });

  describe('Успешные сценарии', () => {
    it('должен вернуть пользователя с заголовками', async () => {
      const user = { id: '1', name: 'Alice', email: 'alice@test.com' };
      userService.getById.mockResolvedValue(user);
      
      const result = await endpoint.handle({ id: '1' });
      
      expect(result).toBeInstanceOf(Ok);
      expect(result.value).toEqual(user);
      expect(result.headers).toHaveProperty('ETag');
      expect(result.headers).toHaveProperty('Cache-Control', 'max-age=300');
      expect(userService.getById).toHaveBeenCalledWith('1');
    });
  });

  describe('Ошибочные сценарии', () => {
    it('должен бросить Fail.notFound если пользователь не найден', async () => {
      userService.getById.mockResolvedValue(null);
      
      await expect(endpoint.handle({ id: '999' }))
        .rejects.toThrow(Fail);
      
      await expect(endpoint.handle({ id: '999' }))
        .rejects.toMatchObject({
          status: 'NOT_FOUND',
          message: 'User not found',
        });
    });
  });
});
```

##### 3.1.3 Unit-тесты для UserService

**Файл:** `src/modules/users/user.service.spec.ts`

```typescript
import { UserService } from './user.service';
import type { ILoggerService } from '../logger/logger.service';

describe('UserService', () => {
  let service: UserService;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    logger = { log: jest.fn() } as any;
    service = new UserService(logger);
  });

  describe('getById', () => {
    it('должен вернуть пользователя если существует', async () => {
      const user = await service.getById('1');
      expect(user).toBeDefined();
      expect(user?.id).toBe('1');
    });

    it('должен вернуть null если не существует', async () => {
      const user = await service.getById('999');
      expect(user).toBeNull();
    });
  });

  describe('create', () => {
    it('должен создать пользователя с автоинкрементным ID', async () => {
      const initialLength = (await service.getAll()).length;
      
      const newUser = await service.create({
        name: 'Test',
        email: 'test@example.com',
      });
      
      expect(newUser).toBeDefined();
      expect(newUser.id).toBeDefined();
      expect(newUser.name).toBe('Test');
      
      const allUsers = await service.getAll();
      expect(allUsers.length).toBe(initialLength + 1);
    });
  });

  describe('update', () => {
    it('должен обновить существующего пользователя', async () => {
      const updated = await service.update('1', { name: 'Updated' });
      
      expect(updated).toBeDefined();
      expect(updated?.name).toBe('Updated');
    });

    it('должен вернуть null для несуществующего пользователя', async () => {
      const updated = await service.update('999', { name: 'Test' });
      expect(updated).toBeNull();
    });
  });

  describe('delete', () => {
    it('должен удалить пользователя', async () => {
      // Сначала создаем пользователя
      const created = await service.create({
        name: 'ToDelete',
        email: 'delete@test.com',
      });
      
      const result = await service.delete(created.id);
      expect(result).toBe(true);
      
      const deleted = await service.getById(created.id);
      expect(deleted).toBeNull();
    });

    it('должен вернуть false для несуществующего пользователя', async () => {
      const result = await service.delete('999');
      expect(result).toBe(false);
    });
  });

  describe('search', () => {
    it('должен найти пользователей по имени', async () => {
      const results = await service.search('Alice');
      
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toContain('Alice');
    });

    it('должен вернуть пустой массив если ничего не найдено', async () => {
      const results = await service.search('NonExistent');
      expect(results).toEqual([]);
    });
  });

  describe('findByEmail', () => {
    it('должен найти пользователя по email', async () => {
      const user = await service.findByEmail('alice@example.com');
      
      expect(user).toBeDefined();
      expect(user?.email).toBe('alice@example.com');
    });

    it('должен вернуть null если email не найден', async () => {
      const user = await service.findByEmail('notfound@example.com');
      expect(user).toBeNull();
    });
  });

  describe('exportAll', () => {
    it('должен вернуть AsyncIterableIterator', async () => {
      const stream = service.exportAll();
      
      expect(stream[Symbol.asyncIterator]).toBeDefined();
      
      const users = [];
      for await (const user of stream) {
        users.push(user);
      }
      
      expect(users.length).toBeGreaterThan(0);
    });
  });
});
```

##### 3.1.4 Unit-тесты для TimingMiddleware

**Файл:** `src/modules/users/middleware/timing.middleware.spec.ts`

```typescript
import { TimingMiddleware } from './timing.middleware';
import type { ILoggerService } from '../../logger/logger.service';
import type { RequestContext, ResponseContext } from '@nestling/pipeline';

describe('TimingMiddleware', () => {
  let middleware: TimingMiddleware;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    logger = { log: jest.fn() } as any;
    middleware = new TimingMiddleware(logger);
  });

  it('должен вызвать next() и вернуть его результат', async () => {
    const ctx: RequestContext = {
      transport: 'http',
      pattern: 'GET /test',
      payload: {},
      metadata: {},
    };
    
    const expectedResponse: ResponseContext = {
      status: 'OK',
      value: { data: 'test' },
    };
    
    const next = jest.fn().mockResolvedValue(expectedResponse);
    
    const result = await middleware.apply(ctx, next);
    
    expect(next).toHaveBeenCalled();
    expect(result).toEqual(expectedResponse);
  });

  it('должен логировать время выполнения', async () => {
    const ctx: RequestContext = {
      transport: 'http',
      pattern: 'GET /test',
      payload: {},
      metadata: {},
    };
    
    const next = jest.fn().mockResolvedValue({
      status: 'OK',
      value: {},
    });
    
    await middleware.apply(ctx, next);
    
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringMatching(/Request took \d+ms/)
    );
  });

  it('должен пропустить ошибки из next()', async () => {
    const ctx: RequestContext = {
      transport: 'http',
      pattern: 'GET /test',
      payload: {},
      metadata: {},
    };
    
    const error = new Error('Test error');
    const next = jest.fn().mockRejectedValue(error);
    
    await expect(middleware.apply(ctx, next)).rejects.toThrow(error);
  });
});
```

#### 3.2 E2E тесты

##### 3.2.1 Структура E2E тестов

**Файл:** `jest.e2e.config.js`

```javascript
const base = require('./jest.config');

module.exports = {
  ...base,
  rootDir: __dirname,
  displayName: 'examples.app-with-http:e2e',
  testMatch: ['**/e2e/**/*.e2e.spec.ts'],
  testTimeout: 60_000, // 1 минута на тест
  maxWorkers: 1, // Последовательное выполнение

  globalSetup: '<rootDir>/e2e/setup.ts',
  globalTeardown: '<rootDir>/e2e/teardown.ts',
};
```

##### 3.2.2 Helpers

**Файл:** `e2e/helpers/create-test-app.ts`

```typescript
import { App } from '@nestling/app';
import { HttpTransport } from '@nestling/transport.http';
import { LoggerModule } from '../../src/modules/logger/logger.module';
import { UsersModule } from '../../src/modules/users/users.module';

export interface TestAppContext {
  app: App;
  baseUrl: string;
}

/**
 * Создает тестовое приложение на случайном порту
 */
export async function createTestApp(): Promise<TestAppContext> {
  const port = 3000 + Math.floor(Math.random() * 1000); // Случайный порт 3000-4000
  
  const app = new App({
    modules: [LoggerModule, UsersModule],
    transports: {
      http: new HttpTransport({ port }),
    },
  });
  
  await app.init();
  await app.listen();
  
  const baseUrl = `http://localhost:${port}`;
  
  return { app, baseUrl };
}

/**
 * Закрывает тестовое приложение
 */
export async function closeTestApp(context: TestAppContext): Promise<void> {
  if (context.app) {
    await context.app.close();
  }
}
```

**Файл:** `e2e/helpers/http-client.ts`

```typescript
/**
 * Простой HTTP клиент для e2e тестов
 */
export class HttpClient {
  constructor(private baseUrl: string) {}

  async get(path: string, headers?: Record<string, string>): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers,
    });
  }

  async post(
    path: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch(
    path: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete(path: string, headers?: Record<string, string>): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers,
    });
  }

  async upload(
    path: string,
    file: { name: string; content: Buffer; type: string }
  ): Promise<Response> {
    const formData = new FormData();
    const blob = new Blob([file.content], { type: file.type });
    formData.append('avatar', blob, file.name);

    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      body: formData,
    });
  }
}
```

##### 3.2.3 Setup/Teardown

**Файл:** `e2e/setup.ts`

```typescript
/**
 * Глобальная настройка перед запуском E2E тестов
 * Здесь можно настроить общее окружение, если нужно
 */
export default async function globalSetup() {
  console.log('🚀 Starting E2E tests...');
  
  // Для этого примера ничего не нужно делать,
  // так как каждый тест создает свой экземпляр приложения
}
```

**Файл:** `e2e/teardown.ts`

```typescript
/**
 * Глобальная очистка после E2E тестов
 */
export default async function globalTeardown() {
  console.log('✅ E2E tests completed');
}
```

##### 3.2.4 E2E тесты для CRUD операций

**Файл:** `e2e/users-crud.e2e.spec.ts`

```typescript
import {
  createTestApp,
  closeTestApp,
  type TestAppContext,
} from './helpers/create-test-app';
import { HttpClient } from './helpers/http-client';

describe('Users CRUD (E2E)', () => {
  let testContext: TestAppContext;
  let client: HttpClient;
  
  beforeAll(async () => {
    testContext = await createTestApp();
    client = new HttpClient(testContext.baseUrl);
  }, 60_000);
  
  afterAll(async () => {
    await closeTestApp(testContext);
  });

  describe('GET /api/users', () => {
    it('должен вернуть список пользователей', async () => {
      const response = await client.get('/api/users');
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      
      // Проверяем структуру первого пользователя
      expect(data[0]).toHaveProperty('id');
      expect(data[0]).toHaveProperty('name');
      expect(data[0]).toHaveProperty('email');
    });
  });

  describe('GET /api/users/:id', () => {
    it('должен вернуть пользователя с заголовками', async () => {
      const response = await client.get('/api/users/1');
      
      expect(response.status).toBe(200);
      expect(response.headers.get('etag')).toBeDefined();
      expect(response.headers.get('cache-control')).toBe('max-age=300');
      
      const user = await response.json();
      expect(user).toHaveProperty('id', '1');
      expect(user).toHaveProperty('name');
      expect(user).toHaveProperty('email');
    });

    it('должен вернуть 404 если пользователь не найден', async () => {
      const response = await client.get('/api/users/999');
      
      expect(response.status).toBe(404);
      
      const error = await response.json();
      expect(error).toHaveProperty('error', 'User not found');
    });
  });

  describe('POST /api/users', () => {
    it('должен создать пользователя с заголовком Location', async () => {
      const newUser = {
        name: 'Test User',
        email: `test-${Date.now()}@example.com`, // Уникальный email
      };
      
      const response = await client.post('/api/users', newUser);
      
      expect(response.status).toBe(201);
      expect(response.headers.get('location')).toBeDefined();
      expect(response.headers.get('location')).toMatch(/^\/api\/users\/\d+$/);
      
      const user = await response.json();
      expect(user).toHaveProperty('id');
      expect(user.name).toBe(newUser.name);
      expect(user.email).toBe(newUser.email);
    });

    it('должен вернуть 400 если email дублируется', async () => {
      const duplicate = {
        name: 'Duplicate',
        email: 'alice@example.com', // Уже существует
      };
      
      const response = await client.post('/api/users', duplicate);
      
      expect(response.status).toBe(400);
      
      const error = await response.json();
      expect(error).toHaveProperty('error', 'Email already taken');
      expect(error).toHaveProperty('details', { field: 'email' });
    });

    it('должен вернуть 400 для невалидного email', async () => {
      const invalid = {
        name: 'Test',
        email: 'not-an-email',
      };
      
      const response = await client.post('/api/users', invalid);
      
      expect(response.status).toBe(400);
      
      const error = await response.json();
      expect(error).toHaveProperty('error');
    });
  });

  describe('PATCH /api/users/:id', () => {
    it('должен обновить пользователя', async () => {
      // Сначала создаем пользователя
      const created = await client.post('/api/users', {
        name: 'To Update',
        email: `update-${Date.now()}@example.com`,
      });
      const createdUser = await created.json();
      
      // Обновляем
      const update = { name: 'Updated Name' };
      const response = await client.patch(`/api/users/${createdUser.id}`, update);
      
      expect(response.status).toBe(200);
      
      const user = await response.json();
      expect(user.name).toBe('Updated Name');
      expect(user.email).toBe(createdUser.email); // email не изменился
    });

    it('должен вернуть 404 если пользователь не найден', async () => {
      const response = await client.patch('/api/users/999', {
        name: 'Test',
      });
      
      expect(response.status).toBe(404);
    });

    it('должен вернуть 400 если email занят', async () => {
      const response = await client.patch('/api/users/2', {
        email: 'alice@example.com', // Уже занят пользователем с id=1
      });
      
      expect(response.status).toBe(400);
      
      const error = await response.json();
      expect(error).toHaveProperty('error', 'Email already taken');
    });

    it('должен вернуть 400 если нет данных для обновления', async () => {
      const response = await client.patch('/api/users/1', {});
      
      expect(response.status).toBe(400);
      
      const error = await response.json();
      expect(error).toHaveProperty('error', 'No data to update');
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('должен удалить пользователя с 204 No Content', async () => {
      // Создаем пользователя для удаления
      const created = await client.post('/api/users', {
        name: 'To Delete',
        email: `delete-${Date.now()}@example.com`,
      });
      const createdUser = await created.json();
      
      // Удаляем
      const response = await client.delete(`/api/users/${createdUser.id}`);
      
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      
      // Проверяем, что пользователь действительно удален
      const checkResponse = await client.get(`/api/users/${createdUser.id}`);
      expect(checkResponse.status).toBe(404);
    });

    it('должен вернуть 404 если пользователь не найден', async () => {
      const response = await client.delete('/api/users/999');
      
      expect(response.status).toBe(404);
    });

    it('должен вернуть 403 при попытке удалить admin (id=1)', async () => {
      const response = await client.delete('/api/users/1');
      
      expect(response.status).toBe(403);
      
      const error = await response.json();
      expect(error).toHaveProperty('error', 'Cannot delete admin user');
    });
  });
});
```

##### 3.2.5 E2E тесты для поиска

**Файл:** `e2e/users-search.e2e.spec.ts`

```typescript
import {
  createTestApp,
  closeTestApp,
  type TestAppContext,
} from './helpers/create-test-app';
import { HttpClient } from './helpers/http-client';

describe('Users Search (E2E)', () => {
  let testContext: TestAppContext;
  let client: HttpClient;
  
  beforeAll(async () => {
    testContext = await createTestApp();
    client = new HttpClient(testContext.baseUrl);
  }, 60_000);
  
  afterAll(async () => {
    await closeTestApp(testContext);
  });

  describe('GET /api/users/search', () => {
    it('должен найти пользователей по имени с заголовками', async () => {
      const response = await client.get('/api/users/search?q=Alice');
      
      expect(response.status).toBe(200);
      expect(response.headers.get('x-total-count')).toBeDefined();
      expect(response.headers.get('cache-control')).toBe('max-age=60');
      
      const users = await response.json();
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeGreaterThan(0);
      
      // Проверяем, что все найденные пользователи содержат "Alice"
      for (const user of users) {
        expect(user.name.toLowerCase()).toContain('alice');
      }
    });

    it('должен найти пользователей по email', async () => {
      const response = await client.get('/api/users/search?q=bob@example.com');
      
      expect(response.status).toBe(200);
      
      const users = await response.json();
      expect(users.length).toBeGreaterThan(0);
      expect(users[0].email).toBe('bob@example.com');
    });

    it('должен вернуть пустой массив если ничего не найдено', async () => {
      const response = await client.get('/api/users/search?q=NonExistentUser12345');
      
      expect(response.status).toBe(200);
      expect(response.headers.get('x-total-count')).toBe('0');
      
      const users = await response.json();
      expect(users).toEqual([]);
    });

    it('должен вернуть 400 если query параметр отсутствует', async () => {
      const response = await client.get('/api/users/search');
      
      expect(response.status).toBe(400);
      
      const error = await response.json();
      expect(error).toHaveProperty('error');
    });

    it('должен вернуть 400 если query параметр пустой', async () => {
      const response = await client.get('/api/users/search?q=');
      
      expect(response.status).toBe(400);
    });
  });
});
```

##### 3.2.6 E2E тесты для стриминга

**Файл:** `e2e/streaming.e2e.spec.ts`

```typescript
import {
  createTestApp,
  closeTestApp,
  type TestAppContext,
} from './helpers/create-test-app';
import { HttpClient } from './helpers/http-client';

describe('Streaming (E2E)', () => {
  let testContext: TestAppContext;
  let client: HttpClient;
  
  beforeAll(async () => {
    testContext = await createTestApp();
    client = new HttpClient(testContext.baseUrl);
  }, 60_000);
  
  afterAll(async () => {
    await closeTestApp(testContext);
  });

  describe('GET /api/users/export (streaming output)', () => {
    it('должен вернуть NDJSON stream с заголовками', async () => {
      const response = await client.get('/api/users/export');
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/x-ndjson');
      expect(response.headers.get('content-disposition')).toContain('users.ndjson');
      
      // Читаем stream
      const text = await response.text();
      const lines = text.trim().split('\n');
      
      expect(lines.length).toBeGreaterThan(0);
      
      // Каждая строка должна быть валидным JSON
      for (const line of lines) {
        const user = JSON.parse(line);
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('name');
        expect(user).toHaveProperty('email');
      }
    });
  });

  describe('POST /api/users/import (streaming input)', () => {
    it('должен импортировать пользователей из NDJSON stream', async () => {
      const timestamp = Date.now();
      const usersToImport = [
        { name: 'Import User 1', email: `import1-${timestamp}@example.com` },
        { name: 'Import User 2', email: `import2-${timestamp}@example.com` },
        { name: 'Import User 3', email: `import3-${timestamp}@example.com` },
      ];
      
      // Формируем NDJSON
      const ndjson = usersToImport.map(u => JSON.stringify(u)).join('\n');
      
      const response = await fetch(`${testContext.baseUrl}/api/users/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-ndjson',
        },
        body: ndjson,
      });
      
      expect(response.status).toBe(200);
      expect(response.headers.get('x-import-status')).toBe('complete');
      
      const result = await response.json();
      expect(result).toHaveProperty('imported', 3);
      expect(result).toHaveProperty('failed', 0);
    });

    it('должен обработать частичный импорт с ошибками', async () => {
      const timestamp = Date.now();
      const usersToImport = [
        { name: 'Valid User', email: `valid-${timestamp}@example.com` },
        { name: 'Invalid', email: 'not-an-email' }, // Невалидный email
        { name: 'Valid User 2', email: `valid2-${timestamp}@example.com` },
      ];
      
      const ndjson = usersToImport.map(u => JSON.stringify(u)).join('\n');
      
      const response = await fetch(`${testContext.baseUrl}/api/users/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-ndjson',
        },
        body: ndjson,
      });
      
      expect(response.status).toBe(200);
      expect(response.headers.get('x-import-status')).toBe('partial');
      
      const result = await response.json();
      expect(result.imported).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('должен вернуть 400 для невалидного Content-Type', async () => {
      const response = await fetch(`${testContext.baseUrl}/api/users/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', // Неверный тип
        },
        body: JSON.stringify({ name: 'Test', email: 'test@test.com' }),
      });
      
      expect(response.status).toBe(400);
    });
  });
});
```

##### 3.2.7 E2E тесты для файлов

**Файл:** `e2e/files.e2e.spec.ts`

```typescript
import {
  createTestApp,
  closeTestApp,
  type TestAppContext,
} from './helpers/create-test-app';
import { HttpClient } from './helpers/http-client';

describe('File Upload (E2E)', () => {
  let testContext: TestAppContext;
  let client: HttpClient;
  
  beforeAll(async () => {
    testContext = await createTestApp();
    client = new HttpClient(testContext.baseUrl);
  }, 60_000);
  
  afterAll(async () => {
    await closeTestApp(testContext);
  });

  describe('POST /api/users/:id/avatar', () => {
    it('должен загрузить аватар для пользователя', async () => {
      // Создаем тестовый файл (простое изображение PNG)
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      ]);
      
      const response = await client.upload('/api/users/1/avatar', {
        name: 'avatar.png',
        content: pngHeader,
        type: 'image/png',
      });
      
      expect(response.status).toBe(200);
      
      const user = await response.json();
      expect(user).toHaveProperty('id', '1');
      expect(user).toHaveProperty('avatarUrl');
      expect(user.avatarUrl).toContain('avatar.png');
    });

    it('должен вернуть 404 если пользователь не найден', async () => {
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      ]);
      
      const response = await client.upload('/api/users/999/avatar', {
        name: 'avatar.png',
        content: pngHeader,
        type: 'image/png',
      });
      
      expect(response.status).toBe(404);
    });

    it('должен вернуть 400 для не-изображения', async () => {
      const textContent = Buffer.from('This is not an image');
      
      const response = await client.upload('/api/users/1/avatar', {
        name: 'document.txt',
        content: textContent,
        type: 'text/plain',
      });
      
      expect(response.status).toBe(400);
      
      const error = await response.json();
      expect(error).toHaveProperty('error');
      expect(error.error).toContain('image');
    });

    it('должен вернуть 400 для слишком большого файла', async () => {
      // Создаем файл больше 5MB (мок)
      const largeFile = Buffer.alloc(6_000_000); // 6MB
      
      const response = await client.upload('/api/users/1/avatar', {
        name: 'large.png',
        content: largeFile,
        type: 'image/png',
      });
      
      expect(response.status).toBe(400);
      
      const error = await response.json();
      expect(error).toHaveProperty('error');
      expect(error.error).toContain('large');
    });
  });
});
```

#### 3.3 Команды в package.json

```json
{
  "scripts": {
    "test": "jest",
    "test:unit": "jest --config jest.config.js",
    "test:e2e": "jest --config jest.e2e.config.js",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:all": "yarn test:unit && yarn test:e2e"
  }
}
```

---

### Этап 4: Документация

#### 4.1 Обновление README.md

Разделы:
- [ ] Краткое описание примера
- [ ] Список всех endpoints с примерами curl
- [ ] Описание Success/Failure patterns
- [ ] Примеры работы с заголовками
- [ ] Примеры streaming (input/output)
- [ ] Примеры работы с файлами
- [ ] Инструкции по запуску тестов
- [ ] Архитектура проекта

#### 4.2 Inline документация

- [ ] JSDoc комментарии для всех эндпоинтов
- [ ] JSDoc комментарии для всех методов сервисов
- [ ] Примеры использования в комментариях

---

## 📊 Матрица покрытия функциональности

| Функциональность | Endpoint | Unit Test | E2E Test |
|-----------------|----------|-----------|----------|
| **Success patterns** |
| `new Ok(data)` | ✅ GetUser | ✅ | ✅ |
| `return data` (direct) | ✅ ListUsers | ✅ | ✅ |
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

---

## 🚀 Порядок выполнения

### Шаг 1: Подготовка (1-2 часа)
1. Создать новую структуру папок
2. Переместить существующие файлы
3. Обновить импорты
4. Добавить `src/common/types.ts`

### Шаг 2: Расширение UserService (1 час)
1. Добавить методы: update, delete, search, exportAll, importUsers, findByEmail, updateAvatar
2. Обновить существующие методы

### Шаг 3: Обновление существующих endpoints (1 час)
1. CreateUserEndpoint - добавить проверку дубликата, заголовок Location
2. GetUserEndpoint - добавить заголовки ETag, Cache-Control
3. ListUsersEndpoint - изменить на прямой возврат (без `new Ok()`)

### Шаг 4: Новые endpoints (3-4 часа)
1. UpdateUserEndpoint
2. DeleteUserEndpoint
3. SearchUsersEndpoint
4. ExportUsersEndpoint (streaming output)
5. ImportUsersEndpoint (streaming input)
6. UploadAvatarEndpoint (file upload)

### Шаг 5: Unit тесты (4-5 часов)
1. Настроить Jest config
2. UserService тесты
3. TimingMiddleware тесты
4. Тесты для каждого endpoint (9 файлов)

### Шаг 6: E2E тесты (3-4 часа)
1. Настроить E2E окружение (helpers, setup, teardown)
2. users-crud.e2e.spec.ts
3. users-search.e2e.spec.ts
4. streaming.e2e.spec.ts
5. files.e2e.spec.ts

### Шаг 7: Документация (1-2 часа)
1. Обновить README
2. Добавить JSDoc комментарии
3. Примеры в коде

**Общее время: ~14-20 часов**

---

## ✅ Критерии успеха

1. ✅ Все Success patterns продемонстрированы (Ok, created, noContent, direct return)
2. ✅ Все основные Failure patterns продемонстрированы (badRequest, forbidden, notFound)
3. ✅ Есть пример streaming endpoint (input и output)
4. ✅ Есть пример работы с файлами (upload)
5. ✅ Есть примеры кастомных заголовков (минимум 4 endpoint)
6. ✅ Есть примеры работы с query параметрами
7. ✅ Покрытие unit-тестами >80%
8. ✅ Все E2E тесты проходят
9. ✅ README обновлён и содержит все примеры
10. ✅ Код хорошо структурирован (модули, separation of concerns)
11. ✅ Все endpoints имеют валидацию и обработку ошибок

---

## 📝 Примечания

### Технические детали

- UserService использует in-memory storage (массив), не БД
- Для простоты не используем UUID, ID - простые строки (автоинкремент)
- ETag генерируется простым способом для примера (id + email)
- Streaming endpoint возвращает NDJSON (newline-delimited JSON)
- Файлы не сохраняются на диск, только мок (сохраняем путь в памяти)
- Admin user с id='1' защищен от удаления

### Модификаторы input схем

Для продвинутых кейсов используем специальные модификаторы:

```typescript
// Streaming input
const StreamInput = Stream(UserSchema);

// File upload
const FileInput = WithFiles(
  z.object({ id: z.string() }),
  z.object({ avatar: FileSchema })
);

// Только файлы
const FilesOnlyInput = Files(z.array(FileSchema));
```

### Структура FilePart

```typescript
interface FilePart {
  fieldname: string;
  filename: string;
  encoding: string;
  mime: string;
  size: number;
  stream: Readable;
}
```

---

## 🎯 Что будет продемонстрировано

### 1. Success patterns (4 варианта)
- `new Ok(data)` - явный успех
- `return data` - автоматический Ok
- `Ok.created(data)` - статус 201
- `Ok.noContent()` - статус 204

### 2. Failure patterns (3 основных)
- `Fail.badRequest()` - невалидные данные
- `Fail.notFound()` - ресурс не найден
- `Fail.forbidden()` - нет прав

### 3. Кастомные заголовки (4+ примера)
- ETag
- Cache-Control
- Location
- X-Total-Count
- X-Import-Status
- Content-Disposition

### 4. Продвинутые кейсы
- Query параметры (search)
- Streaming output (export)
- Streaming input (import)
- File upload (avatar)
- Middleware (timing)

### 5. Тестирование
- Unit тесты для всех endpoints
- Unit тесты для сервисов
- Unit тесты для middleware
- E2E тесты для всех сценариев
- Покрытие >80%
