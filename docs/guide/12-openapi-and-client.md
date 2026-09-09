# 12. Отдать фронтенду документацию и клиент

> Гайд по текущему API; сверено с кодом `users-service`, `app-with-http` (2026-09-09).
> Целевое описание: [design/schemas.md](../design/schemas.md) §2.1 и
> [design/operations.md](../design/operations.md) §5. Почему так: записи
> [ideas.md](../decisions/ideas.md) «Схемы: Standard Schema вместо привязки
> к zod; OpenAPI через явные конвертеры» и «Типизированные клиенты из
> контрактов».

Команде фронтенда нужен документ OpenAPI, чтобы смотреть API и
генерировать по нему код. Соседнему сервису на TypeScript нужен клиент
с типами запросов, ответов и отказов. Ни документ, ни клиент не должны
описываться второй раз руками: у сервера уже есть схемы, адреса и списки
отказов в декларациях.

```typescript
// examples/users-service/src/app.ts
import { openapi } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';

export const app = makeApp({
  features: [UsersFeature],
  plugins: [
    openapi({
      info: { title: 'Users API', version: '1.0.0' },
      converters: [zodConverter()],
      pipeline: observability,
    }),
  ],
  transports: [http()],
  // …
});
```

`openapi()` — плагин: пакет, который подключается к корню и работает на
всё приложение, а не на одну фичу. Здесь достаточно поставить его в
`plugins:`.

Плагин строит документ OpenAPI 3.1 из тех же деклараций, которые
обслуживают запросы, и отдаёт его endpoint'ом `GET /openapi.json`. Три
опции:

- `info` — заголовок документа.
- `converters` — кто переводит схемы в JSON Schema. Ядро принимает любой
  валидатор Standard Schema и не умеет заглядывать внутрь схемы, поэтому
  конвертер называется явно даже в приложении целиком на zod. Схема, для
  которой нет конвертера, останавливает запуск: документ строится на фазе
  ASSEMBLE, а не при первом запросе к `/openapi.json`.
- `pipeline` — слой для endpoint'а `GET /openapi.json`. Политика из
  [главы 10](./10-auth.md) требует `observability` от каждого
  HTTP-endpoint'а, и endpoint плагина не исключение.

```bash
curl -s http://localhost:3000/openapi.json | jq '.paths | keys'
# ["/users", "/users/export", "/users/import", "/users/{id}", "/users/{id}/avatar"]
curl -s http://localhost:3000/openapi.json | jq '.paths["/users"].post.responses | keys'
# ["201", "400", "401", "409", "default"]
```

Ответы выведены из декларации: `201` из статуса успеха, `400` для
проверки входа, `401` и `409` из `errors:`, `default` для `internal_error`.
Форма `stream(User)` выгрузки описана как `application/x-ndjson`.

## Документ в CI

Плагин отдаёт документ работающего приложения. В CI приложение поднимать
незачем: документ строится из декларации чистой функцией.

```typescript
// examples/app-with-http/src/openapi.ts
import { writeFileSync } from 'node:fs';

import { app, openapiOptions } from './app.js';

import { buildOpenApiDocument } from '@nestling/openapi';

/** Аргумент сборки — аргумент командной строки; без него выбраны все фичи */
const args = process.argv[2];

const { endpoints } = app.discover(args);

const document = buildOpenApiDocument(endpoints, openapiOptions);

// `file` — `openapi.json` в корне пакета примера
writeFileSync(file, `${JSON.stringify(document, undefined, 2)}\n`);
```

`app.discover(args)` выполняет фазу 0 и останавливается: разбирает
аргумент сборки, раскрывает ветки переключателей, разрешает выбор фич и
проходит discovery. Дальше он не идёт — источники конфига не
поднимаются, граф не строится, транспорты не создаются. Поэтому вызов
синхронный, и `await` ему не нужен.

Аргумент сборки нужен ему по той же причине, по какой нужен `assemble`:
без аргумента документ описывал бы все объявленные фичи, а процесс
поднимал бы выбранные. `app-with-http` объявляет три фичи и переключатель
`docs`, и разница видна сразу:

```bash
yarn workspace @examples/app-with-http openapi
# …/openapi.json: 11 path(s)

yarn workspace @examples/app-with-http openapi users
# …/openapi.json: 8 path(s) — три пути `/ops/subscriptions…` в документ не попали
```

Опции документа лежат рядом с плагином одним значением: `info` и
`converters` объявлены в `src/app.ts` как `openapiOptions`, а плагин
добавляет к ним только `pipeline`. Документ из CI и документ по
`GET /openapi.json` описывают одно API, и второго `info` рядом не заводится.

Метод бросает ошибки фазы 0: неизвестное имя фичи, значение переключателя
вне словаря, дубликат паттерна на экземпляре транспорта. Соберётся ли
граф — вопрос к `app.check(args)` из [главы 17](./17-select.md):
неудовлетворённая зависимость и нарушенная политика `discover()` не
мешают.

## Слот `doc:`

JSON Schema описывает данные, но не саму операцию. Название, теги и
статус успеха объявляются в слоте `doc:`:

```typescript
// examples/users-service/src/users/endpoints/delete-user.endpoint.ts
export const DeleteUser = httpEndpoint({
  method: 'DELETE',
  path: '/users/:id',
  input: DeleteUserInput,
  errors: [UserNotFound],
  doc: {
    summary: 'Удалить пользователя',
    tags: ['users'],
    status: 'no_content',
  },
  pipeline: transactional,
  handler: DeleteUserHandler,
});
```

| Поле | Что делает |
|---|---|
| `summary`, `description` | название и описание операции |
| `tags` | группировка операций в документе |
| `deprecated` | пометка устаревания |
| `status` | статус успешного ответа; по умолчанию `ok`, без `output` `no_content` |
| `hidden` | причина, по которой endpoint не попадает в документ |

`operationId` не объявляется. Он берётся из имени операции, если
endpoint реализует операцию, иначе из метода и пути: у `GET /users` это
`get_users`.

Служебный endpoint убирается из документа полем `hidden` с причиной:

```typescript
// examples/users-service/src/ops.plugin.ts
export const BuildInfo = httpEndpoint({
  method: 'GET',
  path: '/ops/version',
  output: z.object({ version: z.string() }),
  detached:
    'служебный endpoint эксплуатации: строка аудита на каждый опрос заслоняет полезные записи',
  doc: { hidden: 'служебный endpoint, не часть публичного API' },
  handler: async () => ({ version: process.env.BUILD_VERSION ?? 'dev' }),
});
```

Формы `hidden: true` нет: причина обязательна, как у `detached`, и
скрыть endpoint из документа можно только с ней. Список скрытых
endpoint'ов плагин печатает при старте:

```
[nestling] hidden from the API document: GET /ops/version (declared in 'ops') — служебный endpoint, не часть публичного API
```

Печать отключается опцией `announceHidden: false`.

## Операция: адрес и схемы в одном месте

Клиенту нужны адрес, схемы и список отказов, но не хендлер и не
зависимости. Эти части выносятся из декларации в операцию:

```typescript
// examples/users-service/src/api/operations.ts
import { makeRequest } from '@nestling/operations';

export const GetUserInput = z.object({ id: z.string() });

export const GetUser = makeRequest({
  name: 'users.get',
  http: 'GET /users/:id',
  input: GetUserInput,
  output: User,
  errors: [UserNotFound],
  doc: { summary: 'Пользователь по идентификатору', tags: ['users'] },
});

export const CreateUser = makeRequest({
  name: 'users.create',
  http: { method: 'POST', path: '/users' },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken, Unauthorized],
  doc: { summary: 'Создать пользователя', tags: ['users'], status: 'created' },
});
```

Операция — значение: имя, схемы `input` и `output`, список `errors:` и
слот `doc:`. Секция `http:` описывает адрес; операция без неё отвергается
в момент создания декларации `httpEndpoint({ operation })`. Строка
`'GET /users/:id'` подходит для операции без пометок; объект
`{ method, path }` нужен, когда есть `bind`, `rawBody` или `sse`.

Отказ `Unauthorized` объявлен в `errors:` операции наравне с
`EmailTaken`: клиент должен знать те же отказы, что получает от сервера,
а слой `authed` для него невидим.

Файл импортирует только `@nestling/operations`, `zod` и определения
отказов. В нём нет ни контейнера, ни пайплайна, ни транспорта, поэтому
его можно импортировать во фронтенд.

Реализация подключает операцию через `operation:`:

```typescript
// examples/users-service/src/users/endpoints/get-user.endpoint.ts
@Handler([UsersRepository$])
export class GetUserHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(input: GetUserInput): Output<User, typeof UserNotFound> {
    const user = await this.users.byId(input.id);

    return user ?? UserNotFound({ id: input.id });
  }
}

export const GetUser = httpEndpoint({
  operation: GetUserOperation,
  pipeline: observability,
  handler: GetUserHandler,
});
```

Поле `operation:` заменяет `method`, `path`, `input`, `output`, `errors`
и `doc`: всё это берётся из операции. Повторное объявление любого из них
в декларации не компилируется, поэтому сервер не может разойтись с
клиентом в схемах. Остаются `pipeline` и `handler`. Так же
устроен `CreateUser` в `create-user.endpoint.ts`: он подключает слой
`transactional` ([глава 27](./27-database-and-transaction.md)) и отвечает
`Ok.created`.

## Клиент

```typescript
// examples/users-service/src/api/client.ts
import { makeClient } from '@nestling/client';

/** Имена методов задаёт потребитель: ключи объекта */
const api = makeClient(
  { createUser: CreateUser, getUser: GetUser },
  {
    baseUrl: process.env.API_URL ?? 'http://localhost:3000',
    // Функция, а не объект: заголовки вычисляются на каждый запрос
    headers: () => ({ authorization: `Bearer ${process.env.API_TOKEN ?? ''}` }),
  },
);

async function main(): Promise<void> {
  const created = await api.createUser({
    name: 'Carol',
    email: `carol-${Date.now().toString()}@example.com`,
  });

  if (EmailTaken.is(created)) {
    console.log(`email taken: ${created.details.email}`);
    return;
  }

  if (created.isFail) {
    console.log(`request failed: ${created.code} ${created.message}`);
    return;
  }

  console.log(`created ${created.value.id}`);

  const fetched = await api.getUser({ id: created.value.id });
  // …
}

await main();
```

`makeClient(record, config)` возвращает объект с методом на каждую
операцию. Имена методов задают ключи записи. Клиент раскладывает payload
по адресу операции: `id` подставляется в путь, остальные поля уходят в
тело или query по тому же правилу, по которому транспорт разбирает
запрос. `makeClient` проверяет запись при создании и бросает `TypeError`
с именем метода: операция без `http:`, потоковая или `multipart` форма,
неабсолютный `baseUrl`.

Метод возвращает `Ok` или `Fail`, а не бросает исключение. Отказ
узнаётся по коду через `EmailTaken.is(created)`; после сериализации
`instanceof` не работает. `details` восстановленного отказа типизированы
схемой из `makeFail`. Всё, что не объявлено в `errors:`, включая сетевые
ошибки и тело не по схеме, приходит как `InternalError` с оригиналом в
`cause`. Проверка `created.isFail` закрывает и этот случай.

`headers` — функция, поэтому DI-токен читается на каждый запрос. Успешный
ответ клиент проверяет схемой `output`; это отключается опцией
`validateOutput: false`. Вторым аргументом метод принимает `signal` для
отмены и `deadline` для бюджета времени.

Запустите сервер и скрипт:

```bash
API_TOKEN=secret yarn workspace @examples/users-service start:dev
API_TOKEN=secret yarn workspace @examples/users-service client
# created 3
# fetched Carol
```

Скрипт импортирует два пакета: операции приложения и `@nestling/client`.
Контейнер, пайплайн и транспорт в его граф импортов не попадают.

## Проверка

В `src/app.spec.ts` теста на документ нет. Документ доступен в графе
тестовой сборки значением под DI-токеном `OpenApiDocument$`:

```typescript
// иллюстрация; в src/app.spec.ts этого теста нет
import { OpenApiDocument$ } from '@nestling/openapi';

it('описывает каждый публичный endpoint и скрывает служебный', async () => {
  await using testApp = await assembleTest(app, {
    config: testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });

  const document = testApp.get(OpenApiDocument$);

  expect(Object.keys(document?.paths ?? {})).toContain('/users/{id}');
  expect(document?.paths['/health']).toBeUndefined();
});
```

Клиент проверяется против запущенного сервера скриптом из раздела
«Клиент».

Сервис растёт, и рядом с пользователями появляется вторая область:
[глава 13](./13-features.md).
