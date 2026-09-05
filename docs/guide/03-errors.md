# 3. Сказать клиенту, что пошло не так

> Гайд по текущему API; сверено с кодом `users-service` (2026-09-05).
> Целевое описание: [design/errors.md](../design/errors.md). Почему так:
> записи [ideas.md](../decisions/ideas.md) «[2026-07-10] Модель ошибок:
> Fail — значение, code-идентичность, `makeFail`, ошибки в контракте»,
> «[2026-09-03] Код отказа: категория и уточнение; `makeFail`» и
> «[2026-09-03] Заголовки `Ok` не зависят от транспорта».

`GET /users/:id` должен отвечать `404`, если пользователя нет, а
`POST /users` должен отвечать `409`, если email занят. Клиент должен
отличать эти случаи по машинному коду, а не по тексту сообщения.
Создание должно отвечать `201` с заголовком `Location`, удаление должно
отвечать `204`.

```typescript
// examples/users-service/src/users/users.errors.ts
import { makeFail } from '@nestling/operations';
import { z } from 'zod';

export const UserNotFound = makeFail('not_found:user', {
  details: z.object({ id: z.string() }),
  message: (d) => `User ${d.id} not found`,
});

/** Категория `conflict`: занятый email — конфликт с данными, а не ошибка формата */
export const EmailTaken = makeFail('conflict:email_taken', {
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} is already taken`,
});
```

`makeFail` объявляет отказ: машинный код, схему деталей и сообщение.
Результат вызывается как функция и возвращает значение отказа:
`UserNotFound({ id })`.

Код отказа — единственная его ось. Он состоит из сегментов через
двоеточие; первый сегмент — категория, остальные уточняют её. Категория
говорит, как отвечать, уточнение — что именно случилось. Клиент сравнивает
полный код, транспорт читает категорию, и категория с кодом не
расходится: она и есть его первый сегмент, поэтому объявить отказ с кодом
`not_found:user` и ответить `409` невозможно.

| Категория | HTTP |
|---|---|
| `bad_request` | 400 |
| `unauthorized` | 401 |
| `payment_required` | 402 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `conflict` | 409 |
| `payload_too_large` | 413 |
| `too_many_requests` | 429 |
| `internal_error` | 500 |
| `not_implemented` | 501 |
| `service_unavailable` | 503 |
| `timeout` | 504 |

Перечень закрыт, и категорию проверяет компилятор: `makeFail('gone:user')`
не компилируется. Формат остальных сегментов — `[a-z_]+`, его проверяет
`makeFail` при вызове. Код из одной категории допустим, когда уточнять
нечего: `makeFail('unauthorized')`.

```typescript
// шаг главы 3; итоговая версия: examples/users-service/src/users/endpoints/get-user.endpoint.ts
export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: z.object({ id: z.string() }),
  output: User,
  errors: [UserNotFound],
  handler: async ({ id }) => (id === '1' ? alice : UserNotFound({ id })),
});
```

Константа `alice` заменяет хранилище: она стоит прямо в хендлере. Поле
`errors` перечисляет отказы, которые endpoint может вернуть. Хендлер
возвращает отказ значением, как обычный результат. Клиент получает тело с
кодом и деталями:

```bash
curl localhost:3000/users/9
# {"error":"User 9 not found","code":"not_found:user","details":{"id":"9"}}
```

Отказ доставляется `return`: возвращённый отказ виден в типе хендлера, и
компилятор сверяет его со списком `errors`. Из глубины вызовов, где
вернуть значение некому, отказ бросают: `throw UserNotFound({ id })`. Для
ответа это одно и то же, и подробнее про бросок написано в приложении А.

Тип возвращаемого значения записывается определениями отказов:

```typescript
// examples/users-service/src/users/endpoints/get-user.endpoint.ts
async function handle(input: GetUserInput): Output<User, typeof UserNotFound> {
  const user = await users.byId(input.id);

  return user ?? UserNotFound({ id: input.id });
}
```

`Output<T, E>` описывает всё, что хендлер может вернуть: значение `T`,
`Ok<T>`, отказ из `E` или отказ ядра. В `E` идут сами определения:
`Output<User, typeof UserNotFound | typeof EmailTaken>` для двух отказов.
Без `errors` множество пусто: хендлер, который вернёт доменный отказ, не
входящий в `errors`, не компилируется. Отказы ядра объявления не требуют
ни здесь, ни в `errors` — их список ниже.

У endpoint'а без `output` значения нет, и хендлер компилируется без
`return`.

## Успех со статусом и заголовками

```typescript
// examples/users-service/src/users/endpoints/create-user.endpoint.ts
async function handle(input: CreateUserInput): Output<User, typeof EmailTaken> {
  if (await users.byEmail(input.email)) {
    return EmailTaken({ email: input.email });
  }

  const user = await users.insert(input);

  // Статус `created` и заголовок — метаданные ответа
  return Ok.created(user, { Location: `/users/${user.id}` });
}
```

Голое значение из хендлера превращается в `Ok` со статусом `ok`. Когда
нужен другой статус или заголовки, хендлер возвращает `Ok` явно:
`Ok.created(value, headers)` отвечает `201`, `Ok.accepted(value)`
отвечает `202`, `new Ok(value, headers)` отвечает `200` с заголовками.

Заголовки `Ok` — метаданные ответа, а не HTTP-заголовки: хендлер о
транспорте не знает. Что с ними делать, решает транспорт. HTTP пишет их в
заголовки ответа, NATS кладёт в заголовки ответного сообщения, CLI
отбрасывает.

```typescript
// examples/users-service/src/users/endpoints/delete-user.endpoint.ts
async function handle(
  input: DeleteUserInput,
): Output<null, typeof UserNotFound> {
  const removed = await users.remove(input.id);

  return removed ? Ok.noContent() : UserNotFound({ id: input.id });
}
```

`Ok.noContent()` отвечает `204` без тела. У декларации `DeleteUser` нет
поля `output`.

```typescript
// шаг главы 3; итоговая версия: examples/users-service/src/users/endpoints/delete-user.endpoint.ts
export const DeleteUser = httpEndpoint({
  method: 'DELETE',
  path: '/users/:id',
  input: DeleteUserInput,
  errors: [UserNotFound],
  handler: async ({ id }) =>
    (await remove(id)) ? Ok.noContent() : UserNotFound({ id }),
});
```

В итоговом файле у `DeleteUser` есть ещё слой `authed`: удаление требует
токен. Отказ `Unauthorized` объявляет сам слой, поэтому в `errors:` он не
появляется ([глава 9](./09-auth.md)).

```bash
API_TOKEN=secret yarn workspace @examples/users-service start:dev
curl -X DELETE localhost:3000/users/2 -H 'authorization: Bearer secret' -i
```

## Незадекларированная ошибка

Всё, что дошло до границы пайплайна без объявления в `errors`, клиент
получает как `internal_error` со статусом `500`: брошенное исключение,
отказ из глубины сервиса, отказ, которого нет в списке. Оригинал ошибки
попадает в лог сервера, тело ответа общее. Так детали внутренних ошибок
не уходят наружу.

Отказы ядра входят в список каждого endpoint'а без объявления — и на
границе, и в типе `Output`. Каждый несёт голую категорию:

| Определение | Код | Когда |
|---|---|---|
| `BadRequest` | `bad_request` | вход не прошёл схему, запрос не разобрался |
| `PayloadTooLarge` | `payload_too_large` | тело, файл или поток больше допустимого |
| `Timeout` | `timeout` | истёк бюджет вызова, поток молчит дольше допустимого |
| `InternalError` | `internal_error` | всё незадекларированное |

Ответ `testApp.call` несёт код отказа, а его `status` равен категории
этого кода:

```typescript
// examples/users-service/src/app.spec.ts
expect(await testApp.call(GetUser, { id: '404' })).toMatchObject({
  isSuccess: false,
  status: 'not_found',
  value: { code: 'not_found:user', details: { id: '404' } },
});
```

Отказ узнаётся по коду, а не по классу: поле `code` переживает
сериализацию, и `UserNotFound.is(value)` работает даже там, где исходного
класса ошибки нет. Юнит-тест хендлера проверяет отказ тем же способом,
без приложения:

```typescript
// examples/users-service/src/users/endpoints/create-user.endpoint.spec.ts
const result = await handler.handle({ name: 'Alice II', email: alice.email });

expect(EmailTaken.is(result)).toBe(true);
expect(result).toMatchObject({
  code: 'conflict:email_taken',
  details: { email: alice.email },
});
```

Хендлеры пока живут функциями в словаре декларации. Следующая глава
переносит их в классы: [4. Хендлер как класс](./04-handler-class.md).
