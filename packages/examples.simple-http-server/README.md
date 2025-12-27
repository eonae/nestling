# Simple HTTP Server Example

Простой пример использования `@nestling/transport` для создания HTTP сервера.

## Возможности

- ✅ Middleware для логирования запросов
- ✅ Роутинг с параметрами пути
- ✅ Парсинг JSON body
- ✅ Query параметры
- ✅ Streaming responses
- ✅ Обработка ошибок

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

### GET /users
Список пользователей

```bash
curl http://localhost:3000/users
```

### GET /users/:id
Получить пользователя по ID

```bash
curl http://localhost:3000/users/42
```

### POST /users
Создать пользователя (с JSON body)

```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com"}'
```

### GET /echo
Эхо query параметров и заголовков

```bash
curl http://localhost:3000/echo?foo=bar&baz=qux
```

### GET /stream
Streaming response (10 чанков с задержкой)

```bash
curl http://localhost:3000/stream
```

## Архитектура

Пример демонстрирует:

1. **Middleware** - логирование запросов с измерением времени выполнения
2. **Роутинг** - использование `find-my-way` для сопоставления URL
3. **Парсинг** - JSON body, query параметры
4. **Streaming** - отправка данных потоком
5. **Обработка ошибок** - централизованная обработка ошибок

Весь код находится в `src/main.ts` для простоты понимания.

