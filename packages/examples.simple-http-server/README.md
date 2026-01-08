# Simple HTTP Server Example

Простой пример использования `@nestling/transport.http` напрямую, без `@nestling/app`.

## Возможности

- ✅ Прямая работа с `HttpTransport`
- ✅ Middleware для логирования запросов
- ✅ Функциональный стиль создания эндпоинтов (`makeEndpoint`)
- ✅ Парсинг JSON body
- ✅ Обработка потоковых данных (streaming)
- ✅ Обработка ошибок
- ✅ Graceful shutdown

## Запуск

### Development режим (с автоперезагрузкой)

```bash
cd packages/examples.simple-http-server
yarn dev
```

### Production режим

```bash
cd packages/examples.simple-http-server
yarn start
```

Или из корня проекта:

```bash
yarn workspace examples.simple-http-server dev
```

Сервер запустится на `http://localhost:3000`

## Доступные роуты

### GET /
Приветственное сообщение

```bash
curl http://localhost:3000/
```

### POST /users
Создать пользователя (с JSON body и валидацией через Zod)

```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","address":{"street":"Main St","city":"NYC"}}'
```

### POST /logs/stream
Обработка потоковых логов

```bash
echo '{"timestamp":1234567890,"level":"info","message":"Test log"}' | \
  curl -X POST http://localhost:3000/logs/stream \
  -H "Content-Type: application/json" \
  -d @-
```

## Архитектура

Пример демонстрирует прямую работу с `HttpTransport` без использования `@nestling/app`.

### Функциональный стиль (`makeEndpoint`)

Все эндпоинты создаются через `makeEndpoint`:

- `SayHello` - простой GET эндпоинт
- `CreateUser` - POST с валидацией через Zod
- `StreamLogs` - обработка потоковых данных

**Преимущества:**
- Простота и читаемость
- Минимум кода
- Типы выводятся автоматически из схем
- Не требует дополнительной инфраструктуры

**Пример:**

```typescript
import { makeEndpoint } from '@nestling/pipeline';

export const SayHello = makeEndpoint({
  transport: 'http',
  pattern: 'GET /',
  output: SayHelloOutput,
  handle: async () => ({
    status: 'OK',
    value: {
      message: 'Hello from Nestling HTTP Transport!',
      timestamp: new Date().toISOString(),
    },
  }),
});
```

### Регистрация эндпоинтов

Эндпоинты регистрируются напрямую в транспорте:

```typescript
import { HttpTransport } from '@nestling/transport.http';
import { SayHello, CreateUser, StreamLogs } from './endpoints.functional';

const httpTransport = new HttpTransport({ port: 3000 });

// Регистрируем эндпоинты
httpTransport.endpoint(SayHello);
httpTransport.endpoint(CreateUser);
httpTransport.endpoint(StreamLogs);

// Запускаем транспорт
await httpTransport.listen();
```

### Middleware

Пример демонстрирует два стиля middleware:

1. **Функциональный стиль** (`RequestResponseLogging`) - простая функция
2. **Классовый стиль** (`TimingMiddleware`) - класс с методом `process()`

Middleware добавляются напрямую в транспорт:

```typescript
httpTransport.use(RequestResponseLogging);
httpTransport.use(TimingMiddleware);
```

### Структура проекта

```
src/
├── endpoints.functional/    # Функциональные эндпоинты
│   ├── index.ts
│   ├── say-hello.handler.ts
│   ├── create-user.handler.ts
│   └── stream-logs.handler.ts
├── middleware/              # Middleware
│   ├── index.ts
│   ├── logging.middleware.ts
│   └── timing.middleware.ts
├── common/                  # Общие типы
│   ├── index.ts
│   └── product.model.ts
└── main.ts                  # Entry point
```

### Возможности

1. **Прямая работа с транспортом** - без дополнительного слоя абстракции `App`
2. **Middleware** - логирование запросов с измерением времени выполнения
3. **Роутинг** - встроенный HTTP роутер в `HttpTransport`
4. **Валидация** - автоматическая валидация входных данных через Zod
5. **Stream processing** - обработка потоковых данных
6. **Graceful shutdown** - корректное завершение работы по SIGTERM/SIGINT

## См. также

Для примеров с классовыми эндпоинтами и использованием `@nestling/app` см.:
- `@examples.app-with-http` - полноценное приложение с HTTP транспортом и классовыми эндпоинтами

