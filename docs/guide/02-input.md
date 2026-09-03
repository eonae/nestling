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

/**
 * Данные для создания пользователя: идентификатор выдаёт хранилище.
 *
 * `dryRun` — проверить данные, не создавая запись. Поле приходит из
 * query-строки, остальные — из тела: место задаёт пометка `bind` в
 * операции.
 */
export const CreateUserInput = User.pick({ name: true, email: true }).extend({
  dryRun: z.coerce.boolean().optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserInput>;
```

Схема описывает то, что передаётся по сети. Из неё же выводится тип
для хендлера, поэтому отдельного интерфейса `User` писать не нужно.
Схема входа называется по операции с суффиксом `Input`:
`CreateUserInput`, `ListUsersInput` ([conventions.md](../conventions.md)).
Nestling принимает любую схему, реализующую Standard Schema: zod,
valibot, arktype. В примерах используется zod.

### Тело запроса

```typescript
// шаг главы 2; итоговая версия: packages/examples.users-service/src/users/endpoints/create-user.endpoint.ts
export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/users',
  input: CreateUserInput,
  output: User,
  handler: async (input) => ({ id: '1', ...input }),
});
```

Поле `input` задаёт схему входа. Рантайм проверяет вход по ней перед
вызовом хендлера, и хендлер получает данные типа `CreateUserInput`.
Запрос, который схему не проходит, получает `400` с кодом `bad_request`:

```bash
curl -X POST localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"nope"}'
# {"error":"Bad request","code":"bad_request",
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
  handler: async ({ id }) => ({ id, name: 'Alice', email: 'alice@example.com' }),
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
  handler: async (input) => [alice, bob].slice(0, input.limit ?? 20),
});
```

Константы `alice` и `bob` здесь заменяют хранилище, которое появится в
главе 5. У `GET` нет тела, поэтому поля `input` читаются из query-строки. Query
несёт строки, число из строки делает схема: `z.coerce.number()`. Запрос
`GET /users?limit=abc` получает `400` с путём `["limit"]` в `details`.

### Правило размещения полей

Поля `input` раскладываются по частям HTTP-запроса по фиксированному
правилу.

1. Имя поля совпало с path-параметром шаблона: поле берётся из пути.
2. Поле помечено в `bind`: поле берётся из указанного места.
3. Остальные поля берутся из query для методов без тела (`GET`, `HEAD`,
   `DELETE`, `OPTIONS`, `TRACE`) и из тела для остальных.

Слияния полей из нескольких мест нет. Поле `name` у `POST /users`,
присланное в query-строке, во входные данные не попадёт и даст ошибку
проверки.

### Пометка места: `query()` и `body()`

Умолчание правила иногда не совпадает с адресом, который вы хотите
получить. Флаг «только проверить, не записывать» естественно передавать
в query-строке, а данные пользователя — в теле:

```typescript
// packages/examples.users-service/src/api/operations.ts
export const CreateUser = makeRequest({
  name: 'users.create',
  http: {
    method: 'POST',
    path: '/users',
    bind: { dryRun: query(), name: body() },
  },
  input: CreateUserInput,
  output: User,
  // …
});
```

Теперь `POST /users?dryRun=true` с телом `{"name":"Carol","email":"…"}`
даёт хендлеру `{ name: 'Carol', email: '…', dryRun: true }`. Пометка
`body()` у `name` записывает вслух то же, что дало бы умолчание: у
POST-запроса непомеченные поля читаются из тела.

Пометки — значения из `@nestling/operations`: `query()`,
`query({ multiple: true })` для повторяющегося параметра и `body()`.
Карта `bind` вычисляется при создании декларации, поэтому нарушение
правила видно сразу: `body()` у метода без тела, пометка на
path-параметре и `bind` при неструктурном входе (поток, `multipart`,
сырые байты) дают ошибку на импорте.

Здесь `bind` объявлен на операции, а не на endpoint'е: адрес и схемы
этого endpoint'а вынесены в `api/operations.ts` ради типизированного
клиента (глава 11). У анонимной декларации `httpEndpoint({ method, path,
bind })` пометки лежат прямо в словаре.

### Как это лежит в примере

В итоговом примере хендлеры этих трёх endpoint'ов — классы (глава 4),
они получают зависимости из контейнера (глава 5) и подключают слой
пайплайна (глава 8). `GetUser` и `CreateUser` объявлены не через `method`
и `path`, а через операцию: адрес, схемы и пометки `bind` вынесены в
`api/operations.ts`, чтобы их импортировал типизированный клиент. Это
объясняет глава 11.

## Что гарантирует фреймворк

- Вход проверяется всегда: это обязанность рантайма, а не юнита
  пайплайна. Отключить проверку нельзя; принять любое значение можно
  схемой `z.unknown()`.
- Тип входных данных в хендлере совпадает с выходом схемы. Обращение к
  полю, которого в схеме нет, не компилируется.
- Поле читается ровно из одного места запроса. Значение из другого места
  не подмешивается и не перекрывает объявленное.

## Как проверить

Тест из главы 7 вызывает `GetUser` и `ListUsers` через полный пайплайн
без открытия сокета:

```typescript
// packages/examples.users-service/src/app.spec.ts
expect(unwrap(await testApp.call(GetUser, { id: '1' }))).toEqual(alice);
expect(unwrap(await testApp.call(ListUsers, {}))).toHaveLength(2);
```

Входные данные в `testApp.call` типизированы схемой `input`: передать
`{ id: 1 }` вместо строки нельзя.

## Пока не нужно

- Отказы с машинным кодом, `404` и `409`: глава 3.
- Файлы и потоки на входе: глава 10.

## Запускаемый код

- `packages/examples.users-service/src/users/user.ts`
- `packages/examples.users-service/src/api/operations.ts`
- `packages/examples.users-service/src/users/endpoints/create-user.endpoint.ts`
- `packages/examples.users-service/src/users/endpoints/get-user.endpoint.ts`
- `packages/examples.users-service/src/users/endpoints/list-users.endpoint.ts`

```bash
API_TOKEN=secret yarn workspace examples.users-service start:dev
curl localhost:3000/users/1
curl 'localhost:3000/users?limit=1'
curl -X POST 'localhost:3000/users?dryRun=true' \
  -H 'authorization: Bearer secret' \
  -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"carol@example.com"}'
```

## Дальше

Хендлер получает проверенные данные, но пока не умеет отказать:
пользователя с таким `id` может не быть. Следующая глава: [3. Сказать
клиенту, что пошло не так](./03-errors.md).
