# Приложение с DI: `assemble`, модули, декларации endpoint'ов

> Гайд по **текущему API**; сверено с кодом `examples.app-with-http` (2026-09-02).
> Полное описание деклараций — [design/endpoints.md](../design/endpoints.md).
> Запускаемый код — [`packages/examples.app-with-http/`](../../packages/examples.app-with-http/).

Этот гайд описывает приложение на полном уровне фреймворка: DI-контейнер,
модули, декларации endpoint'ов с зависимостями в хендлере, поиск
endpoint'ов по дереву модулей (discovery) и корректную остановку.

Схемы в примерах написаны на zod. Ядро принимает любую
[Standard Schema](https://standardschema.dev) (valibot, arktype, TypeBox,
Effect Schema) и от конкретного валидатора не зависит.

## Декларация endpoint'а

```typescript
import { httpEndpoint } from '@nestling/transport.http';

export const SearchUsers = httpEndpoint({
  method: 'GET',
  path: '/api/users/search',
  input: SearchUsersInput,
  output: SearchUsersOutput,
  errors: [SearchQueryRequired],
  pipeline: basePipeline,
  handle: SearchUsersHandler,
});
```

Endpoint объявляется конструктором своего транспорта: `httpEndpoint` для
HTTP, `cliEndpoint` для CLI. Результат — обычное значение: его экспортируют,
перечисляют в модуле и вызывают в тестах. Поля транспорта (`method`,
`path`) есть только в конструкторе; пайплайн и хендлер о транспорте не
знают.

Декораторов endpoint'а и интерфейса `IEndpoint` нет. Сигнатуру `handle`
компилятор сверяет со схемами `input` и `output` прямо в точке объявления.

## Куда попадают поля входа

```typescript
export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/api/users/:id',
  input: GetUserInput,     // { id } берётся из пути
  …
});

export const UpdateUser = httpEndpoint({
  method: 'PATCH',
  path: '/api/users/:id',
  input: UpdateUserInput,  // { id } из пути, { name, email } из тела
  …
});
```

У endpoint'а одна схема `input` на весь запрос. Где каждое поле лежит в
HTTP-запросе, определяет правило:

1. Имя поля совпадает с path-параметром шаблона (`:id`) — поле берётся из
   пути.
2. Поле помечено в `bind` — поле берётся из указанного места.
3. Остальные поля берутся из query для методов без тела (`GET`, `HEAD`,
   `DELETE`, `OPTIONS`, `TRACE`) и из тела для остальных методов.

Приём строгий: payload собирается только из этих мест. Поле, присланное
не туда, в payload не попадает, и схема отвечает обычной ошибкой валидации
(400 с `issues`). Слияния «поле принимается отовсюду» нет, ошибок конфликта
источников тоже нет. Path-параметр и одноимённое поле тела не
конкурируют: `PATCH /api/users/42` с телом `{"id":"7"}` даёт `id: '42'`.

Повторный ключ в query даёт массив: `?tag=a&tag=b` превращается в
`['a','b']`, одно вхождение остаётся строкой. Чтобы поле всегда было
массивом, пометьте его `query({ multiple: true })`. Преобразование строк
из query в числа и булевы значения (`?page=2`) делает схема — `z.coerce`,
`z.stringbool()`, — а не транспорт.

## Пометка `query()`

```typescript
import { httpEndpoint, query } from '@nestling/transport.http';

const CreateUserInput = z.object({
  name: z.string().min(1),
  email: z.email(),
  dryRun: z.stringbool().optional(),   // для POST попало бы в тело
});

export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/api/users',
  input: CreateUserInput,
  bind: { dryRun: query() },           // пометка переносит поле в query
  …
});
```

Если поле должно лежать не там, куда его кладёт правило по умолчанию,
укажите место в `bind`. Пометки (`query()`, `body()`) — значения из
`@nestling/transport.http`, а не строки. Ключи `bind` типизированы полями
схемы без path-параметров, поэтому опечатка в имени поля или пометка на
path-параметре — ошибка компиляции.

Запрос `POST /api/users?dryRun=true` с телом `{"name":…,"email":…}`
пройдёт. Тот же `dryRun`, присланный в теле, в payload не попадёт: у поля
ровно одно место.

Часть ошибок проверяется в момент создания декларации, а не на первом
запросе: пометка на path-параметре, `body()` у метода без тела, `bind` или
path-параметр при потоковом или файловом `input`.

> В примере `GetUser` и `CreateUser` объявлены через операция
> (`httpEndpoint({ contract, … })`): адрес, схемы и `errors` живут в
> операции `src/api.contracts.ts`, который импортирует и внешний клиент.
> Форма с `method`/`path` выше делает то же самое, когда второго
> потребителя нет. Подробнее — [`typed-client.md`](./typed-client.md).

## Зависимости хендлера: `deps` и фабрика

Первый способ подключить зависимости: перечислить токены в `deps` и
написать `handle` как фабрику, которая принимает зависимости и
возвращает хендлер. Фабрика вызывается один раз при старте приложения;
замыкание играет роль инстанса.

```typescript
// сокращённый вариант packages/examples.app-with-http/src/modules/users/endpoints/create-user.endpoint.ts
import type { Output } from '@nestling/pipeline';
import { Ok } from '@nestling/pipeline';
import type { Port } from '@nestling/ports';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

import { basePipeline } from '../../../common/pipelines';
import { ClaimQuota, QuotaExceeded } from '../../../contracts';
import { ILogger, type ILoggerService } from '../../logger';
import { EmailTaken } from '../user.errors';
import { UserService } from '../user.service';

const CreateUserInput = z.object({ name: z.string().min(1), email: z.email() });
const CreateUserOutput = z.object({ id: z.string(), name: z.string(), email: z.string() });
type CreateUserInput = z.infer<typeof CreateUserInput>;
type CreateUserOutput = z.infer<typeof CreateUserOutput>;

export const createUserHandler =
  (users: UserService, logger: ILoggerService, quotas: Port<typeof ClaimQuota>) =>
  async (
    payload: CreateUserInput,
  ): Output<
    CreateUserOutput,
    ReturnType<typeof EmailTaken> | ReturnType<typeof QuotaExceeded>
  > => {
    const existing = await users.findByEmail(payload.email);
    if (existing) {
      return EmailTaken({ email: payload.email });
    }

    // Соседняя фича вызывается через порт — обычную зависимость (см. ports.md)
    const claimed = await quotas.call({ email: payload.email });
    if (claimed.isFail) {
      return claimed;
    }

    const user = await users.create(payload);
    return Ok.created(user, { Location: `/api/users/${user.id}` });
  };

export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/api/users',
  input: CreateUserInput,
  output: CreateUserOutput,
  errors: [EmailTaken, QuotaExceeded],   // все отказы, которые endpoint может вернуть
  pipeline: basePipeline,
  deps: [UserService, ILogger, ClaimQuota.caller],
  handle: createUserHandler,
});
```

В файле примера у хендлера больше зависимостей (эмиттеры событий и
`ActivityHub`), а декларация объявлена через операция; здесь оставлено
только то, что нужно для разбора.

`ClaimQuota.caller` — такая же зависимость, как токен сервиса, но за ней
стоит операция соседней фичи. Вызов через порт всегда асинхронный и
возвращает `Ok` или `Fail`. Если соседняя фича переедет в другой
процесс, этот код не изменится ([ports.md](./ports.md)).

Хендлер может объявить второй параметр `meta` — поля, которые накопили
pre-юниты пайплайна. Объявляйте в нём только то, что используете; в
примере выше он не нужен и опущен. Два ключа есть в `meta` всегда:

- `signal: AbortSignal` — сигнал отмены запроса. Он срабатывает при
  отключении клиента и при остановке приложения; отмена кооперативная.
- `fail(e): never` — типизированный ранний выход. Принимает только отказы
  из `errors`.

Успешный ответ возвращают через `Ok.created`, `Ok.accepted`,
`Ok.noContent` или `new Ok(value)`. Голое значение тоже подходит: рантайм
обернёт его в `Ok`.

### Отказы

```typescript
// packages/examples.app-with-http/src/modules/users/user.errors.ts
export const EmailTaken = defineFail('EMAIL_TAKEN', {
  status: 'CONFLICT',                        // HTTP 409
  details: z.object({ email: z.string() }),  // схема и для деталей
  message: (d) => `Email ${d.email} already taken`,
});
```

Отказ — значение. Объявите его через `defineFail` и перечислите в `errors`
декларации. Вернуть отказ можно и через `return`, и через `throw`; для
ответа это одно и то же. Клиент получает
`{"error": "…", "code": "EMAIL_TAKEN", "details": {…}}`.

Отказ, которого нет в `errors`, до клиента не доходит. Сюда попадает и
анонимный `Fail.badRequest(...)`: у него нет кода. На выходе из пайплайна
такой отказ заменяется на `UNKNOWN` с HTTP 500 и общим телом ответа, а
оригинал передаётся в хук `onUnknownFail`. Забытая декларация отказа
проявляется сразу и заметно.

## Зависимости хендлера: класс

```typescript
import { Injectable } from '@nestling/container';

@Injectable([UserService, ILogger])
export class SearchUsersHandler {
  constructor(
    private readonly users: UserService,
    private readonly logger: ILoggerService,
  ) {}

  async handle(payload: SearchUsersInput): Output<SearchUsersOutput> {
    /* ... */
  }
}

export const SearchUsers = httpEndpoint({
  method: 'GET',
  path: '/api/users/search',
  input: SearchUsersInput,
  output: SearchUsersOutput,
  pipeline: basePipeline,
  handle: SearchUsersHandler,
});
```

Второй способ — класс с `@Injectable` и методом `handle`. Декларация при
этом остаётся тем же значением; класс только подключает зависимости.
`implements` не нужен: сигнатура `handle` сверяется со схемами в точке
объявления.

Класс-хендлер — обычный провайдер. Перечислите его в `providers` модуля,
как любую другую зависимость; автоматической регистрации нет.

Пайплайн endpoint'а — тоже значение (`makePipeline`, `compose`); общие
пайплайны экспортируются константами
(`examples.app-with-http/src/common/pipelines.ts`). Классы-юниты
(`.pre(WithTracing)`, где `WithTracing` — класс, а не инстанс) тоже
обычные провайдеры: приложение получает их из контейнера при старте
вместе с `deps`. Если
класс не зарегистрирован ни в одном модуле, старт завершается ошибкой с
именем зависимости, паттерном endpoint'а и именем модуля.

## Сырые байты тела: `rawBody`

```typescript
import { compose, makePipeline } from '@nestling/pipeline';

// Слой объявляет требование к стартовому контексту
export const verifySignature = (
  secret: string,
): PreUnitFn<{ rawBody: Uint8Array }, undefined> => (ctx) => {
  const expected = createHmac('sha256', secret).update(ctx.input.rawBody).digest('hex');
  if (String(ctx.raw.attributes['x-signature']) !== expected) {
    throw InvalidSignature();   // объявлен в `errors` самого endpoint'а
  }
};

export const UserWebhook = httpEndpoint({
  method: 'POST',
  path: '/api/hooks/users',
  input: UserEventInput,
  errors: [InvalidSignature],        // отказ объявляет endpoint, а не слой
  rawBody: true,                     // без этого поля pipeline ниже не компилируется
  pipeline: compose(
    makePipeline<{ rawBody: Uint8Array }>().pre(verifySignature(SECRET)),
    basePipeline,
  ),
  deps: [UserService, ILogger],
  handle: userWebhookHandler,        // получает уже разобранный payload
});
```

Проверка HMAC-подписи webhook'а требует исходных байтов тела:
пересериализованный JSON дал бы другой хеш. Поле `rawBody: true` кладёт
байты в стартовый контекст — то, что транспорт добавляет в контекст до
первого pre-юнита.

Тип стартового контекста зависит от `rawBody`, и слот `pipeline` это
проверяет. Поэтому забытое поле — ошибка компиляции в точке объявления,
а не 500 в рантайме. Тело читается один раз: значение для схемы
разбирается из тех же байтов. Лимит `maxBodySize` действует как обычно;
память расходуется только у endpoint'ов, которые запросили байты. С
потоковыми и multipart-формами `rawBody` несовместим: такая декларация
не создаётся.

## Загрузка файлов: `multipart` и `upload`

```typescript
export const UploadAvatar = httpEndpoint({
  method: 'POST',
  path: '/api/users/:id/avatar',
  input: multipart({
    fields: z.object({ id: z.string() }),   // :id добавляется к полям формы
    files: {
      avatar: upload({
        maxSize: MAX_AVATAR_SIZE,
        mime: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
      }),
    },
  }),
  output: UploadAvatarOutput,
  errors: [InvalidAvatar, UserNotFound],
  pipeline: basePipeline,
  handle: UploadAvatarHandler,              // класс-хендлер: DI как обычно
});
```

Хендлер получает `{ fields, files }`; файлы лежат под именами объявленных
полей (`files.avatar: FilePart`). Размер и MIME транспорт проверяет во
время разбора и отвечает `413` или `400` раньше, чем файл целиком попадёт
в память. Хендлеру остаётся доменная логика.

Для `multipart` роль структурного входа играют `fields`: path-параметры и
поля, помеченные `query()`, добавляются именно туда.

## Лента событий: `events` и `Topic`

```typescript
@Injectable([ILogger])
export class ActivityHub {
  readonly #topic = new Topic<ActivityEvent>({ buffer: 256 });
  #sequence = 0;

  publish(kind: ActivityEvent['kind'], userId: string): void {
    this.#sequence += 1;
    this.#topic.push({ id: String(this.#sequence), kind, userId, at: new Date().toISOString() });
  }

  subscribe(signal?: AbortSignal): AsyncIterableIterator<ActivityEvent> {
    return this.#topic.subscribe(signal);   // подписка снимается по сигналу запроса
  }
}

export const ActivityStream = httpEndpoint({
  method: 'GET',
  path: '/api/users/activity',
  output: events(ActivityEventSchema),      // кадрирование — SSE
  sse: { id: (e) => e.id, event: (e) => e.kind },
  pipeline: compose(basePipeline, subscriptionObserver),
  deps: [ActivityHub],
  handle:
    (hub: ActivityHub) =>
    async (_payload, meta: { signal: AbortSignal; lastEventId?: string }) =>
      new Ok(hub.subscribe(meta.signal)),
});
```

Источник событий — обычный singleton-провайдер, а не особый вид
endpoint'а. Он живёт в `providers` и публикует события независимо от
того, есть ли подписчики.

- `events(T)` — открытая подписка. Она нормально завершается отключением
  клиента; `.finally` получает исход `disconnected`. Для конечных данных
  есть другая форма — `stream(T)` (NDJSON).
- Всё, что относится к SSE, задаётся в HTTP-поле `sse`, а не в форме:
  форма от транспорта не зависит. Если `id` и `event` не заданы, эти поля
  кадра не пишутся. Heartbeat задаётся опцией транспорта `sseHeartbeat`
  (по умолчанию 15 секунд).
- Заголовок `Last-Event-ID` попадает в типизированный стартовый контекст
  как `meta.lastEventId` — тем же механизмом, что `rawBody`. Откуда
  продолжить ленту, решает хендлер.
- Отмена сквозная: клиент отключился, `meta.signal` сработал, итерация
  подписки завершилась, `Topic` снял подписку. Закрывать что-либо вручную
  не нужно.

В примере `ActivityStream` дополнительно композирует слой `tracked` из
реестра подписок и берёт сигнал из `meta.subscription.signal` — см.
[subscriptions.md](./subscriptions.md).

Наблюдатель подписки — обычный `.finally`-юнит. Для потоковой формы он
вызывается после того, как поток закончился или оборвался:

```typescript
const subscriptionObserver = makePipeline<{ requestId: string }>().finally(
  (outcome, _res, ctx) => {
    console.log(`подписка завершена: ${outcome}, отдано: ${ctx.summary.itemsOut}`);
  },
);
```

```bash
curl -N http://localhost:3000/api/users/activity
curl -F avatar=@photo.png http://localhost:3000/api/users/1/avatar
```

## Модуль

```typescript
// сокращённый вариант packages/examples.app-with-http/src/users.feature.ts
import { makeFeature } from '@nestling/app';
import { CreateUser, SearchUsers, SearchUsersHandler } from './modules/users/endpoints';
import { UserService } from './modules/users/user.service';

export const UsersModule = makeFeature({
  name: 'module:users',
  providers: [UserService, SearchUsersHandler],
  endpoints: [CreateUser, SearchUsers],
});
```

Модуль — обычный объект, созданный `makeFeature`. В `providers`
перечисляются зависимости хендлеров: токены из `deps`, классы-хендлеры,
классы-юниты пайплайнов. В `endpoints` — сами декларации. Инстанцировать
декларацию не нужно, поэтому `makeFeature` ничего в `providers` не
добавляет.

Приложение обслуживает ровно те endpoint'ы, которые перечислены в
`endpoints` модулей, переданных в `assemble` (вместе с транзитивными
`imports`). Создание декларации не имеет побочных эффектов, глобального
реестра нет: импорт файла с декларацией ничего не регистрирует.

Элемент `endpoints`, который не является декларацией (сервис, конфиг,
`undefined`), — ошибка старта с именем модуля и индексом элемента.
Декларация помечена symbol-брендом, поэтому пропустить чужое значение
молча приложение не может.

## Запуск приложения

```typescript
import { assemble } from '@nestling/app';
import { http } from '@nestling/transport.http';
import { UsersModule } from './users.feature';

const app = assemble({
  // логирование подключается через imports внутри UsersModule:
  // инфраструктура — обычный модуль, отдельного поля под неё нет
  features: [UsersFeature],
  transports: [http({ port: 3000 })],   // провайдер, а не инстанс
});

await app.run(); // фазы 0–5: сборка, @OnInit, wiring, @OnStart, приём запросов
```

`assemble` — единственный composition root; конструктора `App` нет.
`app.run()` проводит приложение по фазам:

1. собирает контейнер;
2. вызывает `@OnInit` в топологическом порядке;
3. обходит дерево `modules` и `imports`, получает зависимости найденных
   деклараций из контейнера (`endpoint.resolve(resolver)`) и строит
   `dispatch` для каждого транспорта;
4. вызывает `@OnStart` и только после этого запускает транспорты
   (`serve(dispatch, signal)`);
5. вешает обработчики SIGTERM и SIGINT. При остановке транспорты
   закрываются в обратном порядке, затем вызывается `@OnDestroy`.

Если endpoint требует транспорт, которого нет в графе, сборка падает на
фазе ASSEMBLE с именем транспорта, паттерном и именем модуля. Обход
модулей доступен и без запуска приложения: `discoverEndpoints(modules)`
из `@nestling/app`.

Фичи и `select`, фазы жизненного цикла и standalone-запуск описаны в
отдельном гайде — [composition.md](./composition.md).

## Ambient-контекст: `Ctx`

Хендлер видит накопленный `input`, а репозиторий тремя слоями ниже — уже
нет. Чтобы не протаскивать `requestId` параметром через все сигнатуры,
есть ambient-переменная: значение передаётся неявно, а зависимость от
него объявляется явно.

### 1. Объявите переменную

```typescript
import { contextVar } from '@nestling/pipeline';

export const TenantId = contextVar<string>()('tenantId');
```

Вызов двойной: первый фиксирует тип, второй задаёт ключ. Ключ — это имя
поля в накопленном `input`, а не ячейка отдельного хранилища.

`RequestId` объявлять не нужно: ядро экспортирует её вместе с `Signal`
(сигнал отмены запроса; эта переменная только для чтения).

### 2. Положите значение слоем

```typescript
export const observability = makePipeline()
  .pre(withRequestId())            // штатный юнит, тот же RequestId.provide(…)
  .pre(TenantId.provide((ctx) => ctx.raw.attributes['x-tenant'] as string))
  .finally(AuditOutcome);
```

Писатель — сама переменная: `Var.provide()` возвращает обычный pre-юнит,
поэтому накопительная типизация, конфликты и требования к контексту
работают как всегда. (В примере слой `observability` кладёт только
`RequestId`; `TenantId` здесь для иллюстрации.)

Объявителем считается только `Var.provide(…)`. Юнит, который кладёт то же
поле вручную (`return { tenantId }`), для чтения работает, но политику из
шага 4 не удовлетворит.

### 3. Прочитайте ридером

```typescript
// packages/examples.app-with-http/src/modules/users/users.repository.ts
@Injectable(UsersRepository, [UsersStore, ILogger, Ctx(RequestId)])
export class StoredUsersRepository implements IUsersRepository {
  constructor(
    private readonly store: UsersStore,
    private readonly logger: ILoggerService,
    private readonly requestId: CtxReader<string>,
  ) {}

  async byId(id: string) {
    this.logger.debug(`[${this.requestId.peek() ?? 'n/a'}] byId ${id}`);
    // …
  }
}
```

`Ctx(Var)` — обычный токен. Он подходит для `deps` класса, фабрики и
декларации, виден в `explain()` и подменяется в тестах.

У ридера два метода, и выбор между ними зависит от места вызова:

| | `get(): T` | `peek(): T \| undefined` |
| --- | --- | --- |
| pre-юнит, хендлер | значение | значение |
| `.catch`, `.finally`, поток | бросает, если pre-юниты не дошли до писателя | `undefined` |
| `@OnInit`, `@OnStart`, cron, фоновая задача | бросает: контекста запроса нет | `undefined` |

Используйте `get()` там, где переменная обязана быть по инварианту: текст
ошибки назовёт, что починить. Используйте `peek()` в коде, который
работает и внутри запроса, и вне его. Логирование — второй случай.

### 4. Закрепите инвариант политикой

```typescript
assemble({
  policies: [
    everyEndpoint({ transport: HttpTransport$('default') }).hasVar(RequestId, 'requestId'),
  ],
  /* … */
});
```

Компилятор проверяет только чтение из юнита: pre-юнит, который читает
`ctx.input.requestId`, потребует переменную типом. Чтение из глубины
графа типами не выражается, поэтому за него отвечает проверка на
собранном графе.

Endpoint, чей пайплайн не кладёт переменную, роняет сборку (до `@OnInit`
и до открытия сокета), а не запрос. Исключить endpoint из проверки можно
полем `detached: '<причина>'` в декларации. Набор политик описан в
[design/pipeline.md §7](../design/pipeline.md).

В тесте ридер подменяется как любой другой провайдер:
`overrides: [contextValue(RequestId, 'req-1')]` — см.
[testing.md](./testing.md).

## Тестирование хендлера

```typescript
// фабрика — вызов с фейками
const handle = createUserHandler(mockUserService, mockLogger, fakePort);
const result = await handle({ name: 'Alice', email: 'a@b.c' });

// класс-хендлер — обычный new
const handler = new SearchUsersHandler(mockUserService, mockLogger);
const found = await handler.handle({ q: 'Alice' });
```

Для теста хендлера не нужны ни контейнер, ни транспорт, ни импорты из
`@nestling/app`.

Можно подготовить и декларацию целиком:
`CreateUser.resolve([users, logger, port])` возвращает новое исполняемое
значение, а исходная декларация остаётся нетронутой. Тесты через полный
пайплайн без сокета описаны в [testing.md](./testing.md).
