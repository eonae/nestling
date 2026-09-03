# 3. Сказать клиенту, что пошло не так

> Гайд по текущему API; сверено с кодом `examples.users-service` (2026-09-03).
> Целевое описание: [design/errors.md](../design/errors.md). Почему так:
> запись [ideas.md](../decisions/ideas.md) «[2026-07-10] Модель ошибок:
> Fail — значение, code-идентичность, `defineFail`, ошибки в контракте».

## Задача

`GET /users/:id` должен отвечать `404`, если пользователя нет, а
`POST /users` должен отвечать `409`, если email занят. Клиент должен
отличать эти случаи по машинному коду, а не по тексту сообщения.
Создание должно отвечать `201` с заголовком `Location`, удаление
должно отвечать `204`.

## Решение

### Объявить отказы

```typescript
// packages/examples.users-service/src/users/users.errors.ts
import { defineFail } from '@nestling/operations';
import { z } from 'zod';

export const UserNotFound = defineFail('USER_NOT_FOUND', {
  status: 'NOT_FOUND',
  details: z.object({ id: z.string() }),
  message: (d) => `User ${d.id} not found`,
});

/** Статус `CONFLICT`: занятый email — конфликт с данными, а не ошибка формата */
export const EmailTaken = defineFail('EMAIL_TAKEN', {
  status: 'CONFLICT',
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} is already taken`,
});
```

`defineFail` объявляет отказ: машинный код, статус, схему деталей и
сообщение. Статус не зависит от транспорта: `NOT_FOUND`, `CONFLICT`,
`UNAUTHORIZED` и другие. HTTP-транспорт переводит его в код ответа:
`404`, `409`, `401`. Результат `defineFail` вызывается как функция и
возвращает значение отказа: `UserNotFound({ id })`.

### Вернуть отказ из хендлера

```typescript
// шаг главы 3; итоговая версия: packages/examples.users-service/src/users/endpoints/get-user.endpoint.ts
export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: z.object({ id: z.string() }),
  output: User,
  errors: [UserNotFound],
  handle: async ({ id }) => (id === '1' ? alice : UserNotFound({ id })),
});
```

Константа `alice` заменяет хранилище из главы 4. Поле `errors`
перечисляет отказы, которые endpoint может вернуть.
Хендлер возвращает отказ значением, как обычный результат. Клиент
получает тело с кодом и деталями:

```bash
curl localhost:3000/users/9
# {"error":"User 9 not found","code":"USER_NOT_FOUND","details":{"id":"9"}}
```

В итоговом примере хендлер вынесен в отдельную функцию и типизирован
явно:

```typescript
// packages/examples.users-service/src/users/endpoints/get-user.endpoint.ts
export const getUserHandler =
  (users: UsersRepository) =>
  async (payload: GetUserInput): Output<User, FailOf<typeof UserNotFound>> => {
    const user = await users.byId(payload.id);

    // Отказ возвращается значением. Для ответа это то же, что бросок
    return user ?? UserNotFound({ id: payload.id });
  };
```

`Output<T, E>` описывает всё, что хендлер может вернуть: значение `T`,
`Ok<T>` или отказ из `E`. `FailOf<typeof UserNotFound>` даёт тип отказа
по его определению. Аргумент `users` объясняет глава 4.

### Успех со статусом и заголовками

```typescript
// packages/examples.users-service/src/users/endpoints/create-user.endpoint.ts
export const createUserHandler =
  (users: UsersRepository) =>
  async (payload: NewUser): Output<User, FailOf<typeof EmailTaken>> => {
    if (await users.byEmail(payload.email)) {
      return EmailTaken({ email: payload.email });
    }

    const user = await users.insert(payload);

    // Статус 201 и заголовок задаются на успешном ответе
    return Ok.created(user, { Location: `/users/${user.id}` });
  };
```

Голое значение из хендлера превращается в `Ok` со статусом `OK`. Когда
нужен другой статус или заголовки, хендлер возвращает `Ok` явно:
`Ok.created(value, headers)` отвечает `201`, `Ok.accepted(value)`
отвечает `202`, `new Ok(value, headers)` отвечает `200` с заголовками.

```typescript
// packages/examples.users-service/src/users/endpoints/delete-user.endpoint.ts
export const deleteUserHandler =
  (users: UsersRepository) =>
  async (
    payload: DeleteUserInput,
  ): Output<null, FailOf<typeof UserNotFound>> => {
    const removed = await users.remove(payload.id);

    return removed ? Ok.noContent() : UserNotFound({ id: payload.id });
  };
```

`Ok.noContent()` отвечает `204` без тела. У декларации `DeleteUser` нет
поля `output`.

```typescript
// шаг главы 3; итоговая версия: packages/examples.users-service/src/users/endpoints/delete-user.endpoint.ts
export const DeleteUser = httpEndpoint({
  method: 'DELETE',
  path: '/users/:id',
  input: DeleteUserInput,
  errors: [UserNotFound],
  deps: [UsersRepository$],
  handle: deleteUserHandler,
});
```

В итоговом файле у `DeleteUser` есть ещё отказ `Unauthorized` и слой
`authed`: удаление требует токен. Это глава 8.

### Незадекларированная ошибка

Всё, что дошло до границы пайплайна без объявления в `errors`, клиент
получает как `UNKNOWN` со статусом `500`: брошенное исключение, отказ
из глубины сервиса, отказ, которого нет в списке. Оригинал ошибки
попадает в лог сервера, тело ответа общее. Так детали внутренних ошибок
не уходят наружу.

Встроенные коды входят в список каждого endpoint'а без объявления:
`VALIDATION_FAILED` (проверка входа), `PAYLOAD_TOO_LARGE`,
`STREAM_LIMIT_EXCEEDED`, `STREAM_GAP_TIMEOUT`, `DEADLINE_EXCEEDED` и
`UNKNOWN`.

## Что гарантирует фреймворк

- Хендлер не может вернуть отказ, которого нет в `errors`: тип `E` в
  `Output<T, E>` выводится из списка, и такой `return` не компилируется.
- Отказ, который всё же дошёл до границы пайплайна без объявления,
  заменяется на `UNKNOWN`. Список `errors` описывает всё, что клиент
  может получить, кроме встроенных кодов.
- Отказ узнаётся по коду, а не по классу. Поле `code` переживает
  сериализацию, поэтому `UserNotFound.is(value)` работает и на клиенте.

## Как проверить

```typescript
// packages/examples.users-service/src/app.spec.ts
expect(await app.call(GetUser, { id: '404' })).toMatchObject({
  isSuccess: false,
  status: 'NOT_FOUND',
  value: { code: 'USER_NOT_FOUND', details: { id: '404' } },
});
```

Ответ `app.call` несёт статус и код из определения отказа. Юнит-тест
хендлера проверяет отказ без приложения:

```typescript
// packages/examples.users-service/src/users/endpoints/create-user.endpoint.spec.ts
const result = await handle({ name: 'Alice II', email: alice.email });

expect(EmailTaken.is(result)).toBe(true);
expect(result).toMatchObject({
  status: 'CONFLICT',
  details: { email: alice.email },
});
```

## Пока не нужно

- Бросить отказ через `throw` или выйти через `meta.fail`: приложение А.
  Для ответа это то же самое, что `return`.
- Отказ, который бросает слой до хендлера: глава 8.
- Отказы, общие для сервера и клиента: глава 10.

## Запускаемый код

- `packages/examples.users-service/src/users/users.errors.ts`
- `packages/examples.users-service/src/users/endpoints/get-user.endpoint.ts`
- `packages/examples.users-service/src/users/endpoints/create-user.endpoint.ts`
- `packages/examples.users-service/src/users/endpoints/delete-user.endpoint.ts`

```bash
API_TOKEN=secret yarn workspace examples.users-service start:dev
curl localhost:3000/users/9
curl -X DELETE localhost:3000/users/2 -H 'authorization: Bearer secret' -i
```

## Дальше

Хендлеры обращаются к `users`, но откуда он берётся, глава не сказала.
Следующая глава: [4. Хендлеру нужен репозиторий](./04-repository.md).
