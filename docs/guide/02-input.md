# 2. Принять данные и не пропустить мусор

> Гайд по текущему API; сверено с кодом `examples.users-service` (2026-09-03).
> Целевое описание: [design/endpoints.md](../design/endpoints.md),
> [design/schemas.md](../design/schemas.md). Почему так: записи
> [ideas.md](../decisions/ideas.md) «[2026-07-13] Канонизация HTTP-input:
> канон размещения + bind-карта» и «[2026-08-29] Проверка входа по
> `input`: обязанность рантайма, точка после `.pre`-юнитов».

## Задача

Сервису нужны три endpoint'а: `POST /users` принимает пользователя в
теле, `GET /users/:id` отдаёт его по идентификатору, `GET /users?limit=10`
отдаёт список. Хендлер должен получать уже проверенные данные нужного
типа, а невалидный запрос должен получать `400` до вызова хендлера.

## Решение

### Схема данных

```typescript
// packages/examples.users-service/src/users/user.ts
import { z } from 'zod';

/** Пользователь в ответах API. Одна схема на все endpoint'ы. */
export const User = z.object({
  id: z.string(),
  name: z.string().min(1),
  email: z.email(),
  avatarUrl: z.string().optional(),
});

export type User = z.infer<typeof User>;

/** Данные для создания пользователя: идентификатор выдаёт хранилище */
export const NewUser = User.pick({ name: true, email: true });

export type NewUser = z.infer<typeof NewUser>;
```

Схема описывает то, что передаётся по сети. Из неё же выводится тип
для хендлера, поэтому отдельного интерфейса `User` писать не нужно.
Nestling принимает любую схему, реализующую Standard Schema: zod,
valibot, arktype. В примерах используется zod.

### Тело запроса

```typescript
// шаг главы 2; итоговая версия: packages/examples.users-service/src/users/endpoints/create-user.endpoint.ts
export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/users',
  input: NewUser,
  output: User,
  handle: async (payload) => ({ id: '1', ...payload }),
});
```

Поле `input` задаёт схему входа. Рантайм проверяет вход по ней перед
вызовом хендлера, и хендлер получает `payload` типа `NewUser`. Запрос,
который схему не проходит, получает `400` с кодом `VALIDATION_FAILED`:

```bash
curl -X POST localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"nope"}'
# {"error":"Validation failed","code":"VALIDATION_FAILED",
#  "details":[{"message":"Invalid email address","path":["email"]}]}
```

Поле `details` описывает каждую проблему в формате Standard Schema, без
полей конкретного валидатора.

### Параметр пути

```typescript
// шаг главы 2; итоговая версия: packages/examples.users-service/src/users/endpoints/get-user.endpoint.ts
export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: z.object({ id: z.string() }),
  output: User,
  handle: async ({ id }) => ({ id, name: 'Alice', email: 'alice@example.com' }),
});
```

Поле схемы с именем `id` совпало с path-параметром `:id`, поэтому его
значение берётся из пути. Отдельно объявлять, откуда читать поле, не
нужно.

### Query-строка

```typescript
// шаг главы 2; итоговая версия: packages/examples.users-service/src/users/endpoints/list-users.endpoint.ts
const ListUsersInput = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

export const ListUsers = httpEndpoint({
  method: 'GET',
  path: '/users',
  input: ListUsersInput,
  output: z.array(User),
  handle: async (payload) => [alice, bob].slice(0, payload.limit ?? 20),
});
```

Константы `alice` и `bob` здесь заменяют хранилище, которое появится в
главе 4. У `GET` нет тела, поэтому поля `input` читаются из query-строки. Query
несёт строки, число из строки делает схема: `z.coerce.number()`. Запрос
`GET /users?limit=abc` получает `400` с путём `["limit"]` в `details`.

### Правило размещения полей

Поля `input` раскладываются по частям HTTP-запроса по фиксированному
правилу.

1. Имя поля совпало с path-параметром шаблона: поле берётся из пути.
2. Поле помечено в `bind`: поле берётся из указанного места. Пометки
   `query()` и `body()` описаны в приложении А.
3. Остальные поля берутся из query для методов без тела (`GET`, `HEAD`,
   `DELETE`, `OPTIONS`, `TRACE`) и из тела для остальных.

Слияния полей из нескольких мест нет. Поле `name` у `POST /users`,
присланное в query-строке, в payload не попадёт и даст ошибку валидации.

### Как это лежит в примере

В итоговом примере хендлеры этих трёх endpoint'ов получают зависимости
из контейнера (глава 4) и подключают слой пайплайна (глава 7). `GetUser`
и `CreateUser` объявлены не через `method` и `path`, а через операцию:
адрес и схемы вынесены в `api/operations.ts`, чтобы их импортировал
типизированный клиент. Это объясняет глава 10.

## Что гарантирует фреймворк

- Вход проверяется всегда: это обязанность рантайма, а не юнита
  пайплайна. Отключить проверку нельзя; принять любое значение можно
  схемой `z.unknown()`.
- Тип `payload` в хендлере совпадает с выходом схемы. Обращение к полю,
  которого в схеме нет, не компилируется.
- Поле читается ровно из одного места запроса. Значение из другого места
  не подмешивается и не перекрывает объявленное.

## Как проверить

Тест из главы 6 вызывает `GetUser` и `ListUsers` через полный пайплайн
без открытия сокета:

```typescript
// packages/examples.users-service/src/app.spec.ts
expect(unwrap(await app.call(GetUser, { id: '1' }))).toEqual(alice);
expect(unwrap(await app.call(ListUsers, {}))).toHaveLength(2);
```

Payload в `app.call` типизирован схемой `input`: передать `{ id: 1 }`
вместо строки нельзя.

## Пока не нужно

- Отказы с машинным кодом, `404` и `409`: глава 3.
- Пометки `bind`, `query()` и `body()`: приложение А.
- Файлы и потоки на входе: глава 9.

## Запускаемый код

- `packages/examples.users-service/src/users/user.ts`
- `packages/examples.users-service/src/users/endpoints/create-user.endpoint.ts`
- `packages/examples.users-service/src/users/endpoints/get-user.endpoint.ts`
- `packages/examples.users-service/src/users/endpoints/list-users.endpoint.ts`

```bash
API_TOKEN=secret yarn workspace examples.users-service start:dev
curl localhost:3000/users/1
curl 'localhost:3000/users?limit=1'
```

## Дальше

Хендлер получает проверенные данные, но пока не умеет отказать:
пользователя с таким `id` может не быть. Следующая глава: [3. Сказать
клиенту, что пошло не так](./03-errors.md).
