# 1. Поднять сервис, который отвечает на запрос

> Гайд по текущему API; сверено с кодом `examples.users-service` (2026-09-03).
> Целевое описание: [design/composition.md](../design/composition.md),
> [design/endpoints.md](../design/endpoints.md). Почему так: записи
> [ideas.md](../decisions/ideas.md) «[2026-09-02] Модель композиции: фича,
> плагин, операция» и «[2026-09-03] Декларация приложения: `makeApp`,
> `assemble(select)`, `AssembledApp`».

## Задача

Вам нужен HTTP-сервис, который отвечает JSON на `GET /users`. Он должен
стартовать одной командой и останавливаться по `SIGTERM` без обрыва
запросов, которые уже обрабатываются.

## Решение

### Endpoint, фича и корень в одном файле

```typescript
// шаг главы 1; итоговая версия: packages/examples.users-service/src/main.ts
import { makeApp, makeFeature } from '@nestling/app';
import { http, httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const User = z.object({ id: z.string(), name: z.string() });

const ListUsers = httpEndpoint({
  method: 'GET',
  path: '/users',
  output: z.array(User),
  handler: async () => [
    { id: '1', name: 'Alice' },
    { id: '2', name: 'Bob' },
  ],
});

const UsersFeature = makeFeature({ name: 'users', endpoints: [ListUsers] });

const app = makeApp({
  features: [UsersFeature],
  transports: [http()],
});

await app.assemble().run();
```

Приложение состоит из трёх значений плюс сборка.

Декларация endpoint'а `ListUsers` описывает адрес, схему ответа и
хендлер. `httpEndpoint` собирает паттерн из `method` и `path`:
`GET /users`. Схема `output` задаёт форму ответа и тип возвращаемого
значения хендлера. Хендлер возвращает обычный массив, транспорт
сериализует его в JSON. Пользователи пока лежат в самом хендлере: откуда
брать их из базы, показывает глава 5.

Фича `UsersFeature` перечисляет endpoint'ы под своим именем. Пока фича
одна, и приложение выглядит так, будто фич нет. Что даёт деление на фичи,
показывает глава 12.

`makeApp` объявляет приложение: список фич и список транспортов. `http()`
объявляет HTTP-транспорт: порт и хост он читает из своей секции конфига,
по умолчанию `3000` и `0.0.0.0`. Декларация — значение: она ничего не
читает и ничего не запускает.

`app.assemble()` собирает приложение для этого процесса, `run()` строит
граф, проверяет его, открывает сокет и ставит обработчики `SIGTERM` и
`SIGINT`. По сигналу транспорт перестаёт принимать новые запросы,
сообщает текущим об отмене через `meta.signal` и закрывается, когда они
завершатся.

### Как это лежит в примере

В итоговом примере каждое значение живёт в своём файле.

```typescript
// packages/examples.users-service/src/users/endpoints/list-users.endpoint.ts
export const ListUsers = httpEndpoint({
  method: 'GET',
  path: '/users',
  output: z.array(User),
  handler: ListUsersHandler,
});
```

Хендлер здесь — класс, а не функция: так его удобнее тестировать и
дополнять зависимостями. Классовую форму показывает глава 4, а пока
достаточно знать, что поле `handler` принимает и функцию, и класс.

```typescript
// packages/examples.users-service/src/users.feature.ts
export const UsersFeature = makeFeature({
  name: 'users',
  providers: [
    // … главы 5, 6 и 8
  ],
  endpoints: [
    ListUsers,
    // … главы 2, 3 и 10
  ],
});
```

Файл `app.ts` объявляет приложение и экспортирует одно значение — `app`:

```typescript
// packages/examples.users-service/src/app.ts
export const app = makeApp({
  features: [UsersFeature],
  plugins: [
    // … главы 11 и 23
  ],
  transports: [http()],
  policies: [
    // … глава 9
  ],
});
```

Файл `main.ts` импортирует `app` и запускает его. Других экспортов у него
нет:

```typescript
// packages/examples.users-service/src/main.ts
async function main(): Promise<void> {
  await app.assemble().run();

  console.log('users-service: GET /health, GET /users, GET /openapi.json');
}

main().catch((error: unknown) => {
  console.error('failed to start:', error);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
});
```

Деление на два файла нужно потому, что декларацию читают не только точка
входа: её же берут тесты (глава 7) и проверка топологий (глава 16).
Аргумент `assemble(select)` выбирает, какие фичи поднимает этот процесс;
до главы 16 он не нужен, и вызов остаётся пустым. Правила именования
файлов собраны в [conventions.md](../conventions.md).

### Запуск

```bash
API_TOKEN=secret yarn workspace examples.users-service start:dev
```

Переменная `API_TOKEN` нужна итоговому примеру: секция конфига объявляет
её обязательной, и без неё приложение не стартует. Что это значит и
откуда берутся остальные значения, объясняет глава 6. Пока задайте любую
строку.

При старте приложение печатает состав сборки:

```
[nestling] features: users; transports: http
users-service: GET /health, GET /users, GET /openapi.json
```

Проверьте ответ:

```bash
curl localhost:3000/users
# [{"id":"1","name":"Alice"},{"id":"2","name":"Bob"}]
```

## Что гарантирует фреймворк

- Путь проверяется в момент создания декларации. Пустой путь, путь без
  ведущего `/` и повторяющийся path-параметр дают ошибку на этапе
  импорта модуля, а не на старте приложения.
- Тип возвращаемого значения хендлера сверяется со схемой `output` в точке
  декларации. Хендлер, который возвращает объект другой формы, не
  компилируется.
- `makeApp` проверяет декларацию при создании: бренды фич и плагинов,
  повторяющиеся имена фич, перечень полей. Опечатка в словаре — ошибка на
  импорте, а не на старте.
- Сокет открывается после того, как граф собран и проверен. Транспорт
  не может принять запрос раньше, чем готова таблица маршрутов: у него нет
  метода запуска без неё.

## Как проверить

Тесты, которые вызывают endpoint без открытия сокета, появляются в
главе 7. Для первой главы достаточно `curl` из раздела «Запуск».

## Пока не нужно

- Пайплайн, то есть код до и после хендлера: глава 8.
- Хендлер как класс: глава 4.
- Зависимости хендлера и провайдеры: глава 5.
- Конфиг и переменные окружения: глава 6.
- Выбор фич в `assemble(select)`: глава 16.

## Запускаемый код

- `packages/examples.users-service/src/users/endpoints/list-users.endpoint.ts`
- `packages/examples.users-service/src/users.feature.ts`
- `packages/examples.users-service/src/app.ts`
- `packages/examples.users-service/src/main.ts`

```bash
API_TOKEN=secret yarn workspace examples.users-service start:dev
curl localhost:3000/users
```

## Дальше

Сервис отвечает на запрос без параметров. Следующая глава принимает
данные от клиента и проверяет их: [2. Принять данные и не пропустить
мусор](./02-input.md).
