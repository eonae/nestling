# 1. Поднять сервис, который отвечает на запрос

> Гайд по текущему API; сверено с кодом `examples.users-service` (2026-09-04).
> Целевое описание: [design/composition.md](../design/composition.md),
> [design/endpoints.md](../design/endpoints.md). Почему так: записи
> [ideas.md](../decisions/ideas.md) «[2026-09-02] Модель композиции: фича,
> плагин, операция» и «[2026-09-03] Декларация приложения: `makeApp`,
> `assemble(select)`, `AssembledApp`».

Начнём с HTTP-сервиса, который отвечает JSON на `GET /users`. Он стартует
одной командой и останавливается по `SIGTERM`, не обрывая запросы, которые
уже обрабатываются. Целиком он умещается в один файл.

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

Декларация endpoint'а `ListUsers` описывает адрес, схему ответа и хендлер.
`httpEndpoint` собирает паттерн из `method` и `path`: `GET /users`. Схема
`output` задаёт форму ответа и заодно тип возвращаемого значения: хендлер,
который вернёт объект другой формы, не скомпилируется. Сам хендлер отдаёт
обычный массив, транспорт сериализует его в JSON.

Путь проверяется в момент создания декларации. Пустой путь, путь без
ведущего `/`, повторяющийся path-параметр — ошибка на импорте файла, а не
на старте приложения.

Фича `UsersFeature` перечисляет endpoint'ы под своим именем. Пока фича
одна, и приложение выглядит так, будто фич нет: что даёт деление, станет
видно, когда областей станет больше одной.

`makeApp` объявляет приложение: список фич и список транспортов. `http()`
объявляет HTTP-транспорт; порт и хост он берёт из своей секции конфига, по
умолчанию `3000` и `0.0.0.0`. Декларация — значение: она ничего не читает и
ничего не запускает. Проверяется она тоже при создании — бренды фич,
повторяющиеся имена, перечень полей, — поэтому опечатка в словаре падает на
импорте, а не на старте.

`app.assemble()` собирает приложение для этого процесса, `run()` строит
граф, проверяет его, открывает сокет и ставит обработчики `SIGTERM` и
`SIGINT`. Порядок здесь — гарантия: сокет открывается после того, как граф
собран и проверен, и принять запрос раньше готовой таблицы маршрутов
транспорт не может — метода запуска без неё у него нет. По сигналу
транспорт перестаёт принимать новые запросы, сообщает текущим об отмене и
закрывается, когда они завершатся.

## Как это лежит в примере

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

Хендлер здесь — класс, а не функция: поле `handler` принимает обе формы.

```typescript
// packages/examples.users-service/src/users.feature.ts (фрагмент)
export const UsersFeature = makeFeature({
  name: 'users',
  endpoints: [ListUsers /* … */],
  // …
});
```

Файл `app.ts` объявляет приложение и экспортирует одно значение — `app`:

```typescript
// packages/examples.users-service/src/app.ts (фрагмент)
export const app = makeApp({
  features: [UsersFeature],
  transports: [http()],
  // …
});
```

Файл `main.ts` импортирует `app` и запускает его. Больше в нём нет ничего:
ни функции-обёртки, ни обработчика ошибок, ни печати адресов. Обработчики
сигналов ставит `run()`, а упавший старт роняет процесс сам.

```typescript
// packages/examples.users-service/src/main.ts
import { app } from './app';

await app.assemble().run();
```

Деление на два файла нужно потому, что декларацию читает не только точка
входа: её же берут тесты и проверка топологий. Правила именования файлов
собраны в [conventions.md](../conventions.md).

## Запуск

```bash
API_TOKEN=secret yarn workspace examples.users-service start:dev
```

Переменная `API_TOKEN` нужна итоговому примеру: одна из его секций конфига
объявляет её обязательной, и без неё приложение не стартует. Пока задайте
любую строку.

При старте приложение печатает состав сборки:

```
[nestling] features: users; transports: http
```

Проверьте ответ:

```bash
curl localhost:3000/users
# [{"id":"1","name":"Alice"},{"id":"2","name":"Bob"}]
```

Сервис отвечает на запрос без параметров. Дальше он научится принимать
данные от клиента и проверять их: [2. Принять данные и не пропустить
мусор](./02-input.md).
