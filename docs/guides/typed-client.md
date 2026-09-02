# Типизированный клиент из операций

> Гайд по **текущему API**; сверено с кодом `examples.app-with-http` (2026-09-02).

У операции три потребителя. Два из них живут внутри приложения: реализация
(`implement` или форма с операцией `httpEndpoint`) и вызыватель по шине
(`.caller`/`.emitter`). Третий — внешний: фронтенд, сервис на другом стеке,
скрипт. У него нет DI, и ему нужен HTTP-адрес операции.

Для внешнего потребителя операция объявляет HTTP-адрес в секции `http:`, а
пакет `@nestling/client` строит из таких операций типизированный клиент
одной функцией `makeClient`.

## Два пакета

```typescript
// packages/examples.app-with-http/src/api.client.ts
import { CreateUser, GetUser } from './api.operations';   // ваши операции
import { makeClient } from '@nestling/client';
```

`@nestling/operations` содержит всё, что не зависит от направления вызова:
`makeRequest` / `makeCommand` / `makeEvent`, `defineFail`, `Ok`/`Fail`, перечень статусов, формы io,
пометки размещения `query()`/`body()` и bind-карту. У пакета нет
runtime-зависимостей: в его графе импортов только типы Standard Schema, без
контейнера, пайплайна, транспортов и `node:*`. Это проверяет тест: он
обходит замыкание импортов собранного `dist/` и падает, называя модуль и
запрещённый импорт.

`@nestling/client` зависит только от `@nestling/operations` и ходит в сеть
через `fetch`. Оба пакета собираются в браузерный бандл без полифиллов.

Импортируйте `makeRequest` / `makeCommand` / `makeEvent` из `@nestling/operations`. `@nestling/ports` его
не реэкспортирует: у этого пакета есть серверные зависимости.

## Адрес в операции: секция `http:`

```typescript
// packages/examples.app-with-http/src/api.operations.ts
import { makeRequest, query } from '@nestling/operations';

export const CreateUser = makeRequest({
  name: 'api.users.create',
  http: { method: 'POST', path: '/api/users', bind: { dryRun: query() } },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken, QuotaExceeded],
});

export const GetUser = makeRequest({
  name: 'api.users.get',
  http: 'GET /api/users/:id',            // короткая запись без пометок
  input: z.object({ id: z.string() }),
  output: User,
  errors: [UserNotFound],
});
```

Секция `http:` принимает две формы. Строка `'<METHOD> <path>'` — короткая
запись для операции без пометок; разбирается она строго: ровно один
пробел, метод и путь непустые. Объект `{ method, path, bind?, rawBody?, sse? }`
нужен, когда есть `bind`, `rawBody` или `sse`.

Bind-карту `makeRequest` / `makeCommand` / `makeEvent` вычисляет сразу, тем же кодом, которым
`httpEndpoint` обслуживает обычную HTTP-декларацию. Из этого следуют два
свойства.

- Все проверки размещения срабатывают при импорте модуля с операциями, то
  есть у владельца декларации, а не при сборке приложения и не при первом
  вызове клиента. Проверяется: пометка на path-параметре, `body()` у метода
  без тела, path-параметр при неструктурном `input`, `rawBody` с потоковой
  формой, `sse` при выходе не `events`.
- Готовая карта лежит на самом значении: `CreateUser.http` — это
  `{ method, path, fields, rest, rawBody }`.

На вызовы по шине секция `http:` не влияет: вид операции, `.caller` и
`.emitter`, `implement` и вызов через порт работают как раньше. Один
операция обслуживает и шину, и HTTP.

## Серверная сторона: форма с операцией `httpEndpoint`

```typescript
// packages/examples.app-with-http/src/modules/users/endpoints/get-user.endpoint.ts
export const GetUser = httpEndpoint({
  operation: GetUserOperation,
  pipeline: basePipeline,
  deps: [UserService, ILogger],
  handle: getUserHandler,
});
```

Операция-форма — способ записи обычной HTTP-декларации, а не новый
примитив. `method`, `path`, `bind`, `rawBody`, `sse`, `input`, `output` и
`errors` берутся из операции; повторное объявление любого из них здесь —
ошибка компиляции, как и в `implement`. Bind-карта берётся с операции тем
же значением, а не вычисляется заново, поэтому сервер и клиент раскладывают
поля по одной и той же карте.

Операция без секции `http:` отвергается в момент создания декларации.
Сообщение об ошибке называет операцию и предлагает два выхода: объявить
`http:` или реализовать операция через `implement`, то есть по шине.

Всё остальное работает как у любой HTTP-декларации: три формы `handle`,
`deps`, `pipeline`, `detached`, discovery, `policies` и визуализация.

## Клиент

```typescript
// packages/examples.app-with-http/src/api.client.ts
const api = makeClient(
  { createUser: CreateUser, getUser: GetUser },
  {
    baseUrl: process.env.API_URL ?? 'http://localhost:3000',
    headers: () => ({ 'x-request-source': 'example-client' }),
  },
);
```

Имена методов задаёте вы — ключами записи. Клиент не разбирает `name`
операции (`'users.create'`) во вложенные объекты: имя операции — адрес на
шине, а не форма вашего API.

Клиент — значение. Он ничего не регистрирует, не требует DI и работает в
скрипте, который импортировал два пакета.

### Вызов

| Вид операции | Вызыватель внутри приложения | Метод клиента |
|---|---|---|
| `request` | `port.call(payload, meta?)` | `Promise<Ok<Output> \| Fail<E ∪ UnknownError>>` |
| `command` | `emitter.emit(payload, meta?)` | `Promise<void>`, отказ бросается |
| `event` | `emitter.emit(...)` | отвергается в `makeClient` |

```typescript
// packages/examples.app-with-http/src/api.client.ts
const created = await api.createUser({ name: 'Alice', email: 'alice@example.com' });

if (EmailTaken.is(created)) {
  console.log(`email taken: ${created.details.email}`);   // details типизированы схемой
  return;
}

if (created.isFail) {
  console.log(`unexpected failure: ${created.message}`);  // UNKNOWN или DEADLINE_EXCEEDED
  return;
}

console.log(`created ${created.value.id}`);
```

Метод клиента возвращает то же, что `.caller`: `Ok` или `Fail`, где множество
отказов закрыто как `E ∪ UnknownError`. Код, написанный для порта, работает
с клиентом без правок. Отказ распознаётся по `code` через
`EmailTaken.is(…)`, а не через `instanceof`: после сериализации класс
отказа не сохраняется.

`event` клиент не поддерживает: у события любое число подписчиков, а
HTTP-запрос адресует одного получателя. Ошибка при создании клиента
предлагает использовать `command`.

### Сборка запроса

Клиент раскладывает payload по той же bind-карте, по которой транспорт
собирает его на сервере:

```
path   ← поля с placement.in === 'path'   → подстановка в шаблон, encodeURIComponent
query  ← поля с placement.in === 'query'  + (rest === 'query' ? остальные : ∅)
body   ← поля с placement.in === 'body'   + (rest === 'body'  ? остальные : ∅)
```

Разбор собранного клиентом запроса даёт исходный payload. Это свойство
проверяет round-trip-тест на наборе карт.

Тело сериализуется в JSON. Заголовок `Content-Type: application/json`
ставится только когда тело есть. `baseUrl` и путь склеиваются буквально:
база без хвостового слэша плюс путь, без разрешения относительных URL.

### Query-параметры

| Значение поля | Что попадает в query |
|---|---|
| `undefined`, `null` | ключ не пишется |
| скаляр (`string`/`number`/`boolean`) | `String(value)` |
| массив скаляров | ключ повторяется для каждого элемента, в порядке следования |
| объект, вложенный массив | `TypeError` в момент вызова, с именем поля |

Отсутствующее поле остаётся отсутствующим, поэтому `.optional()` и дефолты
схемы работают. Объект в query — ошибка программиста: клиент бросает
`TypeError`, а не пишет `[object Object]` и не возвращает `Fail`.

**Схема query-поля должна принимать строку.** Query передаёт строки, и
клиент пишет туда `String(value)`. `z.boolean()` отверг бы `?dryRun=true`;
в примере поле объявлено как `z.stringbool()`, которое понимает `'true'`,
`'false'`, `'1'` и `'0'`.

### Ответ

- Статус 2xx. HTTP-код переводится в `SuccessStatus`; `204` даёт
  `Ok('NO_CONTENT', null)`.
- Успешное тело проверяется схемой `output` операции. Так по умолчанию;
  отключается явно: `makeClient(record, { validateOutput: false })`.
  Валидация синхронная: `Promise` из `~standard.validate` считается
  ошибкой, как и в ядре.
- Статус не 2xx. Тело читается как `{ error, code?, details? }`. Если
  `code` объявлен в `errors:` операции, клиент восстанавливает отказ по его
  определению. `status` берётся из определения, потому что сервер мог
  ответить любым статусом. `message` и `details` берутся из ответа; `details`
  при этом проверяются схемой определения.
- Всё остальное даёт `UnknownError` с исходной ошибкой в `cause`: сеть
  недоступна, тело не JSON, ответ не прошёл схему `output`, код не объявлен
  в операции, детали не прошли схему. Других кодов клиент не вводит.

На сетевых сбоях и отказах операции `request`-метод не бросает, а возвращает
`Fail`. Исключение (`TypeError`) он бросает только на ошибках использования,
например на непредставимом значении query-поля.

### `meta`: отмена и бюджет

```typescript
await api.getUser({ id }, { signal, deadline: new Date(Date.now() + 2_000) });
```

`signal` передаётся в `fetch` и отменяет запрос. `deadline` — абсолютный
момент времени, как у портов. Если он уже истёк, клиент возвращает
`DeadlineExceeded`, не обращаясь к сети. Если нет — превращает его в
`AbortSignal` и объединяет с вашим `signal`.

`idempotencyKey` у клиента нет: в HTTP для него нет общепринятого заголовка.

### Конфигурация клиента

```typescript
makeClient(record, {
  baseUrl: string,
  headers?: Record<string, string> | (() => Record<string, string> | Promise<…>),
  fetch?: typeof globalThis.fetch,
  validateOutput?: boolean,   // default: true
});
```

`headers` принимает функцию, чтобы токен авторизации можно было обновлять:
статический объект зафиксировал бы его на момент создания клиента. Реализацию `fetch`
можно подменить: это нужно тестам без сети и средам со своим `fetch`.

Заголовков на отдельный вызов нет. Всё, что клиент передаёт при каждом
вызове, описано в операции: `input` и bind-карта.

## Проверки при создании клиента

`makeClient` бросает `TypeError` в момент создания, называя ключ метода,
если:

- у операции нет секции `http:`;
- операция имеет вид `event`;
- у операции потоковая (`stream`, `events`) или `multipart`-форма io;
  потоковый клиент проектируется отдельно;
- тело не JSON (`'binary'`, `'text'`);
- `baseUrl` не является абсолютным URL.

Всё, что можно проверить по записи операций, проверяется сразу; ошибок
«при первом вызове» нет.

## Чего клиент не делает

- Не поддерживает стриминг. NDJSON для `stream` и SSE с реконнектом по
  `Last-Event-ID` для `events` появятся отдельно, вместе с AsyncAPI.
- Не генерирует код: типы выводятся из операции. Для потребителей не на
  TypeScript есть [`@nestling/openapi`](../design/schemas.md).
- Не ходит по шине: `makeClient` работает только с HTTP. Для шины есть
  `@nestling/transport.nats`.

## Смотри также

- [design/operations.md](../design/operations.md) — целевое состояние
  операций, портов и клиентов.
- [guides/ports.md](./ports.md) — вызов операции изнутри приложения.
- [design/errors.md](../design/errors.md) — модель ошибок и восстановление
  `Fail` на клиенте.
