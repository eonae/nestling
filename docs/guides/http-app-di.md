# Приложение с DI: `assemble`, модули, декларации endpoint'ов

✅ **Статус: актуально** — сверено с кодом `examples.app-with-http`
(2026-07-31). Канон деклараций описан в
[design/endpoints.md](../design/endpoints.md).
Запускаемый код — в
[`packages/examples.app-with-http/`](../../packages/examples.app-with-http/).

Полный уровень фреймворка: DI-контейнер, модули, декларации-значения
с инъекцией зависимостей в хендлер, регистрация ручек обходом дерева
модулей, graceful shutdown.
zod в примерах — **один из вариантов**: ядро принимает любую
[Standard Schema](https://standardschema.dev) (valibot, arktype, TypeBox,
Effect Schema …) и валидатором не зависит.

## Декларация — значение

Ручка объявляется конструктором своего транспорта: `httpEndpoint` для
HTTP, `cliEndpoint` для CLI. Транспортный словарь (`method`, `path`)
легален только здесь; пайплайн и хендлер остаются транспорт-слепыми.
Декораторов эндпоинта и интерфейса `IEndpoint` нет — сверка сигнатуры
`handle` со схемами `input`/`output` идёт в точке декларации.

## Куда попадают поля: канон размещения

`input` — одна схема на всю ручку; куда каждое поле кладётся в HTTP-запросе,
определяет детерминированное правило:

1. имя поля совпало с path-параметром шаблона (`:id`) → **путь**;
2. поле помечено в `bind` → указанное пометкой место;
3. всё остальное → **query** для методов без тела (`GET`, `HEAD`, `DELETE`,
   `OPTIONS`, `TRACE`) и **тело** для остальных.

```typescript
export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/api/users/:id',
  input: GetUserInput,   // { id } → путь
  …
});

export const UpdateUser = httpEndpoint({
  method: 'PATCH',
  path: '/api/users/:id',
  input: UpdateUserInput,  // { id } → путь, { name, email } → тело
  …
});
```

**Приём strict.** Payload собирается только из канонических мест: поле,
присланное не туда, в payload не попадает и падает обычной ошибкой
валидации (400 с `issues`). Слияния «поле принимается отовсюду» нет, как
и ошибок конфликта источников. Одноимённые path-параметр и поле тела не
соревнуются: `PATCH /api/users/42` с телом `{"id":"7"}` даёт `id: '42'`.

**Повторный query-ключ даёт массив**: `?tag=a&tag=b` → `['a','b']`; одно
вхождение — скаляр. Чтобы поле было массивом всегда, помечают
`query({ multiple: true })`. Коерсию провод-строк (`?page=2` → число)
делает схема (`z.coerce`, `z.stringbool()`), а не транспорт.

## Пометка `query()`: поле не из канонического места

Пометки — значения из `@nestling/transport.http`, а не строки. Ключи `bind`
типизированы полями схемы за вычетом path-параметров: опечатка и пометка на
path-параметре — ошибки компиляции.

```typescript
import { httpEndpoint, query } from '@nestling/transport.http';

const CreateUserInput = z.object({
  name: z.string().min(1),
  email: z.email(),
  dryRun: z.stringbool().optional(),   // POST → уехало бы в тело…
});

export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/api/users',
  input: CreateUserInput,
  bind: { dryRun: query() },           // …пометка переносит его в query
  …
});
```

`POST /api/users?dryRun=true` с телом `{"name":…,"email":…}`. Тот же
`dryRun`, присланный в теле, в payload не попадёт — место у поля ровно одно.

Словарь проверяется **в момент создания значения**: пометка на
path-параметре, `body()` у метода без тела, `bind` или path-параметр при
потоковом/файловом `input` — ошибка сразу, а не на первом запросе.

## DI хендлера: `deps` + каррированная фабрика

Первая форма подключения зависимостей: `deps` — явный массив токенов,
`handle` — фабрика, возвращающая хендлер. Внешний вызов происходит **один
раз** при гашении зависимостей на старте App; замыкание играет роль
инстанса.

```typescript
import type { Output } from '@nestling/pipeline';
import { Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

import { basePipeline } from '../../../common/pipelines';
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

    // Соседняя фича зовётся портом — обычная зависимость (см. ports.md)
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
  errors: [EmailTaken, QuotaExceeded],   // ← множество отказов ручки
  bind: { dryRun: query() },
  pipeline: basePipeline,
  deps: [UserService, ILogger, ClaimQuota.port],
  handle: createUserHandler,
});
```

`ClaimQuota.port` — такая же зависимость, как токен сервиса, только за ней
стоит **контракт** соседней фичи: вызов всегда async и Fail-able, и переезд
той фичи в другой процесс call-site не тронет ([ports.md](./ports.md)).

Хендлер может объявить второй параметр `meta` — поля, накопленные pre-юнитами
пайплайна; декларирует только то, что использует (в примере он не нужен,
поэтому опущен). В `meta` всегда есть два **зарезервированных** ключа:
`signal: AbortSignal` — сигнал отмены запроса (взводится при дисконнекте
клиента и при graceful shutdown; отмена кооперативная) — и
`fail(e): never` — типизированный ранний выход, принимающий только отказы
из `errors:`.

Результаты: `Ok.created / Ok.accepted / Ok.noContent` (или значение напрямую —
обернётся в `Ok`).

**Отказы — значения.** Доменный отказ объявляется `defineFail` и попадает
в `errors:` декларации; отдать его можно и возвратом, и броском — для
ответа это одно и то же:

```typescript
// packages/examples.app-with-http/src/modules/users/user.errors.ts
export const EmailTaken = defineFail('EMAIL_TAKEN', {
  status: 'CONFLICT',                        // → HTTP 409
  details: z.object({ email: z.string() }),  // schema-first и для деталей
  message: (d) => `Email ${d.email} already taken`,
});
```

Клиент получает `{"error": "…", "code": "EMAIL_TAKEN", "details": {…}}`.
Отказ, **не** объявленный в `errors:` (в том числе анонимный
`Fail.badRequest(...)` — у него нет кода), граница пайплайна превращает в
`UNKNOWN`/500 и отдаёт клиенту generic-тело; оригинал уходит в
`onUnknownFail`. Забытая декларация ломается громко и сразу — на это и
расчёт.

## DI хендлера: класс-хендлер

Вторая форма — класс с `@Injectable` и методом `handle`. Это **форма
подключения DI, а не второй стиль деклараций**: сама декларация остаётся
тем же значением. `implements` не нужен.

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

Класс-хендлер — обычный провайдер: его **надо перечислить в `providers:`**
модуля, как любую другую зависимость. Автоматической регистрации нет —
это была бы асимметрия «класс волшебный, токен нет».

Пайплайн endpoint'а — значение (`makePipeline` / `compose`), общие
пайплайны экспортируются константами (см.
`examples.app-with-http/src/common/pipelines.ts`). Классы-юниты
(`.pre(WithTracing)` — класс, не инстанс) — обычные провайдеры: App
резолвит их контейнером на старте вместе с `deps`; если класс не
зарегистрирован в модулях — ошибка старта с именем зависимости, паттерном
ручки и модулем-объявителем.

## Сырые байты тела: `rawBody` и webhook-подписи

Проверка HMAC-подписи требует **исходных байтов**: пересериализованный JSON
дал бы другой хеш. `rawBody: true` кладёт их в **стартовый контекст** —
то, что транспорт добавляет в контекст ещё до первого pre-юнита.

```typescript
import { compose, makePipeline } from '@nestling/pipeline';

// Слой объявляет требование к стартовому контексту
export const verifySignature = (
  secret: string,
): PreUnitFn<{ rawBody: Uint8Array }, undefined> => (ctx) => {
  const expected = createHmac('sha256', secret).update(ctx.input.rawBody).digest('hex');
  if (String(ctx.raw.attributes['x-signature']) !== expected) {
    throw InvalidSignature();   // объявляется в `errors:` самой ручки
  }
};

export const UserWebhook = httpEndpoint({
  method: 'POST',
  path: '/api/hooks/users',
  input: UserEventInput,
  errors: [InvalidSignature],        // контракт принадлежит ручке, не слою
  rawBody: true,                     // ← без неё pipeline ниже не компилируется
  pipeline: compose(
    makePipeline<{ rawBody: Uint8Array }>().pre(verifySignature(SECRET)),
    basePipeline,
  ),
  deps: [UserService, ILogger],
  handle: userWebhookHandler,        // получает уже разобранный payload
});
```

Забытая пометка — **ошибка компиляции в точке декларации**, а не 500 в
рантайме: тип стартового контекста зависит от `rawBody`, и слот `pipeline`
это проверяет. Тело читается один раз (значение парсится из тех же байтов),
лимит `maxBodySize` действует как обычно, а память платится только там, где
байты запрошены. С потоковыми и multipart-формами `rawBody` несовместим —
ошибка при создании декларации.

## Загрузка файлов: `multipart` + `upload`

```typescript
export const UploadAvatar = httpEndpoint({
  method: 'POST',
  path: '/api/users/:id/avatar',
  input: multipart({
    fields: z.object({ id: z.string() }),   // :id подмешивается к полям формы
    files: {
      avatar: upload({
        maxSize: MAX_AVATAR_SIZE,
        mime: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
      }),
    },
  }),
  output: UploadAvatarOutput,
  errors: [InvalidAvatar, UserNotFound],
  pipeline: noValidationPipeline,
  handle: UploadAvatarHandler,              // класс-хендлер: DI как обычно
});
```

Хендлер получает `{ fields, files }` с файлами **по именам объявленных
полей** (`files.avatar: FilePart`). Размер и MIME проверил транспорт во
время разбора — `413` и `400` до того, как файл попал в память целиком;
ручке остаётся домен. Для `multipart` роль структурного input играют
`fields`: path-параметры и помеченные query-поля подмешиваются именно
туда.

## Лента событий: `events` + `Topic`

Источник событий — **обычный singleton-провайдер**, а не особый вид
ручки: он живёт в `providers:` и публикует независимо от того, есть ли
подписчики.

```typescript
@Injectable([ILogger])
export class ActivityHub {
  readonly #topic = new Topic<ActivityEvent>({ buffer: 256 });

  publish(kind: ActivityEvent['kind'], userId: string): void {
    this.#topic.push({ id: nextId(), kind, userId, at: new Date().toISOString() });
  }

  subscribe(signal?: AbortSignal): AsyncIterableIterator<ActivityEvent> {
    return this.#topic.subscribe(signal);   // отписка — по сигналу запроса
  }
}

export const ActivityStream = httpEndpoint({
  method: 'GET',
  path: '/api/users/activity',
  output: events(ActivityEventSchema),      // framing — SSE
  sse: { id: (e) => e.id, event: (e) => e.kind },
  pipeline: compose(noValidationPipeline, subscriptionObserver),
  deps: [ActivityHub],
  handle:
    (hub: ActivityHub) =>
    async (_payload, meta: { signal: AbortSignal; lastEventId?: string }) =>
      new Ok(hub.subscribe(meta.signal)),
});
```

- `events(T)` — открытая подписка: нормальное завершение — дисконнект,
  исход `.finally` — `disconnected`. Конечные данные — это `stream(T)`
  (NDJSON), другая форма.
- Всё SSE-специфичное живёт в **HTTP-словаре** (`sse`), а не в форме:
  форма транспортно нейтральна. `id`/`event` не заданы — поля кадра не
  пишутся; heartbeat берётся из опции транспорта (`sseHeartbeat`, 15s).
- `Last-Event-ID` приезжает в **типизированном стартовом контексте**
  (`meta.lastEventId`) — тем же механизмом, что `rawBody`. Откуда
  продолжить, решает хендлер.
- Отмена сквозная: клиент ушёл → `meta.signal` взведён → итерация
  подписки завершилась → `Topic` снял подписку. Ничего закрывать руками
  не нужно.

Наблюдатель подписки — обычный `.finally`-юнит, но для потоковой формы он
вызывается **после** того, как поток дотёк или оборвался:

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

Модуль — plain object через `makeAppModule`: провайдеры + декларации.
В `providers` идут зависимости хендлеров (токены из `deps`, классы-хендлеры,
классы-юниты пайплайнов); в `endpoints` — сами декларации-значения.
`makeAppModule` ничего в `providers` не подмешивает: инстанцировать
декларацию не нужно.

```typescript
import { makeAppModule } from '@nestling/app';
import { CreateUser, SearchUsers, SearchUsersHandler } from './modules/users/endpoints';
import { UserService } from './modules/users/user.service';

export const UsersModule = makeAppModule({
  name: 'module:users',
  providers: [UserService, SearchUsersHandler],
  endpoints: [CreateUser, SearchUsers],
});
```

**`endpoints:` — единственный способ подключить ручку.** Создание
декларации не имеет побочных эффектов: приложение обслуживает ровно те
ручки, что перечислены в `endpoints:` модуля, переданного в `App` (вместе
с транзитивными `imports`). Импорт файла с декларацией ничего не
регистрирует — глобального реестра нет.

Элемент `endpoints:`, не являющийся декларацией (положили сервис,
конфиг или `undefined`), — ошибка старта с именем модуля и индексом
элемента: декларация помечена symbol-брендом, и молчаливого пропуска нет.

## Bootstrap

```typescript
import { assemble } from '@nestling/app';
import { http } from '@nestling/transport.http';
import { UsersModule } from './users.module';

const app = assemble({
  // логирование приезжает импортом модуля внутри UsersModule:
  // инфраструктура — обычный модуль, отдельного поля под неё нет
  modules: [UsersModule],
  transports: [http({ port: 3000 })],   // провайдер, а не инстанс
});

await app.run(); // фазы 0–5: сборка, @OnInit, wiring, @OnStart, go-live
```

`assemble` — единственный публичный composition root: конструктора `App` не
существует. `app.run()` проводит приложение по фазам — собирает контейнер,
запускает `@OnInit` по топосорту, обходит дерево `modules` + `imports`,
гасит зависимости найденных деклараций контейнером
(`endpoint.resolve(resolver)`), строит `dispatch` на каждый транспорт,
выполняет `@OnStart` и только потом выводит транспорты в эфир
(`serve(dispatch, signal)`); заодно вешает обработчики SIGTERM/SIGINT
(на выходе — `close()` транспортов в реверсе, затем `@OnDestroy`).
Транспорт, затребованный ручкой, но не зарегистрированный в графе, — ошибка
фазы ASSEMBLE с именем транспорта, паттерном и модулем-объявителем.
Обход доступен и отдельно, без поднятия приложения:
`discoverEndpoints(modules)` из `@nestling/app`.

Фичи и `select`, фазы жизненного цикла и standalone-путь — отдельный гайд
[composition.md](./composition.md).

## Ambient-контекст: `Ctx` в глубине

Хендлер видит накопленный `input` — а репозиторий тремя слоями ниже уже нет.
Чтобы не протаскивать `requestId` параметром через все сигнатуры, есть
**ambient-переменная**: значение едет неявно, но зависимость от него
объявляется явно.

**1. Объявить переменную.** Вызов двойной: первый фиксирует тип, второй —
ключ. Ключ — это имя поля в накопленном `input`, а не ячейка отдельного
хранилища:

```typescript
import { contextVar } from '@nestling/pipeline';

export const TenantId = contextVar<string>()('tenantId');
```

`RequestId` объявлять не нужно — она well-known и экспортируется ядром
рядом с `Signal` (сигнал отмены запроса; он read-only).

**2. Положить значение слоем.** Писатель — сама переменная: `Var.provide()`
возвращает обычный pre-юнит, поэтому накопительная типизация, конфликты и
требования работают как всегда:

```typescript
export const observability = makePipeline()
  .pre(withRequestId())            // штатный юнит = RequestId.provide(…)
  .pre(TenantId.provide((ctx) => ctx.raw.attributes['x-tenant'] as string))
  .finally(AuditOutcome);
```

Только `Var.provide(…)` считается объявителем. Юнит, кладущий то же поле
«вручную» (`return { tenantId }`), для чтения работает, но политику из шага 4
не удовлетворит.

**3. Прочитать ридером.** `Ctx(Var)` — обычный токен: он годится в `deps`
класса, фабрики и декларации, виден в `explain()` и подменяется в тестах:

```typescript
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

**`get()` или `peek()`** — по месту вызова, а не по вкусу:

| | `get(): T` | `peek(): T \| undefined` |
| --- | --- | --- |
| pre-юнит, хендлер | значение | значение |
| `.catch`/`.finally`, поток | бросает, если pre не дошёл до писателя | `undefined` |
| `@OnInit`/`@OnStart`, cron, фон | бросает: scope'а нет | `undefined` |

Правило: `get()` там, где переменная обязана быть по инварианту (и текст
ошибки прямо назовёт починку); `peek()` — в коде, который легитимно живёт на
обоих путях. Логирование — как раз второй случай.

**4. Закрепить инвариант политикой.** Компилятор ловит только чтение из
юнита: pre-юнит, читающий `ctx.input.requestId`, потребует переменную типом.
Чтение из глубины графа типами не выражается — там за него отвечает
проверка на собранном графе:

```typescript
assemble({
  policies: [
    everyEndpoint({ transport: HttpTransport$ }).hasVar(RequestId, 'requestId'),
  ],
  /* … */
});
```

Ручка, чей пайплайн переменную не кладёт, роняет **сборку** (до `@OnInit` и
до открытия сокета), а не запрос; opt-out — `detached: '<причина>'` в
декларации. Подробности словаря политик — [design/pipeline.md
§7](../design/pipeline.md).

В тесте ридер подменяется как любой другой провайдер:
`overrides: [contextValue(RequestId, 'req-1')]` — см.
[testing.md](./testing.md).

## Тестирование хендлера

DI не мешает тестам — ни контейнера, ни транспорта, ни импортов из
`@nestling/app` не нужно:

```typescript
// каррированная фабрика — вызов с фейками
const handle = createUserHandler(mockUserService, mockLogger, fakePort);
const result = await handle({ name: 'Alice', email: 'a@b.c' });

// класс-хендлер — обычный new
const handler = new SearchUsersHandler(mockUserService, mockLogger);
const found = await handler.handle({ q: 'Alice' });
```

Декларацию можно погасить и целиком — `CreateUser.resolve([users, logger, port])`
возвращает **новое** исполнимое значение, исходное остаётся нетронутым.

> Целевой дизайн развивается — см. [decisions/ideas.md](../decisions/ideas.md):
> token families, модули-фабрики с параметром `pipeline`.
