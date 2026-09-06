# 8. Видеть каждый запрос в логе

> Гайд по текущему API; сверено с кодом `users-service` (2026-09-06).
> Целевое описание: [design/pipeline.md](../design/pipeline.md) и
> [design/container.md](../design/container.md), раздел «Логгер ядра».
> Почему так: записи [ideas.md](../decisions/ideas.md) «Pipeline v2:
> плоские фазы, слои, композиция константами», «Асинхронный контекст:
> read-only ALS-проекция pipeline-контекста» и «Логгер ядра: `RootLogger$`,
> семейство `Logger$` с `.auto` и `child`» [2026-09-06].

Сервис отвечает клиентам, но что с ним происходит, видно только по
ответам. Каждый запрос должен оставлять запись в логе: адрес, статус и
то, чем он закончился. Записи одного запроса, даже из глубины кода,
должны связываться между собой по общему идентификатору.

## Логгер ядра

Свой логгер объявлять не нужно: он есть у ядра, и им пользуются и
фреймворк, и приложение. Сервис берёт его как обычную зависимость:

```typescript
// examples/users-service/src/database.ts
import type { Config, Logger } from '@nestling/app';
import { Logger$ } from '@nestling/app';
import { Injectable, OnDestroy, OnInit } from '@nestling/container';

@Injectable([AppConfig, Logger$.auto])
export class Database {
  // …
  @OnInit()
  connect(): void {
    // В лог уходит только хост: значение поля секретное
    this.logger.info('database connected', {
      host: new URL(this.config.databaseUrl).host,
    });
    // …
  }

  @OnDestroy()
  disconnect(): void {
    this.#users = undefined;
    this.logger.info('database disconnected');
  }
}
```

`Logger` — интерфейс из `@nestling/app`. `Logger$` — семейство токенов:
`Logger$('db')` даёт логгер с областью `db`, а `Logger$.auto` — с областью
по имени класса-потребителя, здесь `Database`. Область попадает в каждую
запись полем `scope`, поэтому по логу видно, кто написал строку. Как
устроены семейства токенов, рассказывает глава
[21](./21-token-families.md).

У логгера четыре уровня: `debug`, `info`, `warn`, `error`. У каждого три
формы вызова:

| Форма | Что получается |
|---|---|
| `logger.info('database connected', { host })` | сообщение и поля |
| `logger.error(error, { operation })` | сообщение из `error.message`, сама ошибка в поле `err` |
| `logger.debug({ rows: 3 })` | только поля, без сообщения |

Отказ из [главы 3](./03-errors.md) проходит формой ошибки:
`logger.warn(UserNotFound({ id }))`. Ключ `err` зарезервирован за
ошибкой: логгер записывает её имя, сообщение, стек и `cause`.

`logger.child({ orderId })` возвращает логгер, который добавляет
`orderId` к каждой записи. Так пишется серия записей об одном объекте.

Записи уходят в `stderr` одной строкой каждая. Уровень и формат задают
две переменные окружения:

| Переменная | Значения | По умолчанию |
|---|---|---|
| `NESTLING_LOG_LEVEL` | `debug`, `info`, `warn`, `error` | `info` |
| `NESTLING_LOG_FORMAT` | `text`, `json` | `text` |

Запись уровня ниже заданного отбрасывается. Опечатка в значении
останавливает старт: это обычная секция конфига, и невалидное значение
проверяется на сборке, как в [главе 6](./06-config.md).

## Слой наблюдаемости

Всё, что происходит вокруг хендлера, описывает пайплайн —
последовательность юнитов. Юнит — одна функция или класс. Пайплайн
объявляется вызовом `makePipeline()` и читается сверху вниз как порядок
исполнения:

| Метод | Когда выполняется | Что видит |
|---|---|---|
| `.pre(unit)` | до хендлера, в порядке объявления | накопленный контекст; каждый юнит добавляет в него свои поля |
| `.ok(unit)` | только для успешного ответа | полный контекст |
| `.catch(unit)` | только для ответа-отказа | поля своего слоя как необязательные |
| `.finally(unit)` | всегда, последним | то же, что `.catch`, плюс исход запроса |

Для лога нужны две фазы: `.pre`, чтобы положить идентификатор запроса в
контекст, и `.finally`, чтобы записать итог.

```typescript
// examples/users-service/src/observability.ts
import type {
  ExtendableContext,
  Logger,
  Outcome,
  ResponseContext,
} from '@nestling/app';
import { Logger$, makePipeline, withRequestId } from '@nestling/app';
import { Injectable } from '@nestling/container';

/**
 * Юнит `.finally`: пишет строку аудита по завершении каждого запроса.
 */
@Injectable([Logger$.auto])
export class AuditOutcome {
  constructor(private readonly logger: Logger) {}

  handle(
    outcome: Outcome,
    res: ResponseContext,
    ctx: ExtendableContext<{ requestId?: string }>,
  ): void {
    // Идентификатор запроса в запись кладёт логгер ядра: он читает его из
    // контекста сам, и руками префикс не пишется
    this.logger.info(`${ctx.raw.pattern} ${res.status}`, { outcome });
  }
}

export const observability = makePipeline()
  .pre(withRequestId())
  .finally(AuditOutcome);
```

`withRequestId()` — готовый pre-юнит из `@nestling/app`. Он берёт
идентификатор из заголовка `x-request-id` или генерирует случайный и
кладёт его в контекст полем `requestId`.

`AuditOutcome` — юнит `.finally` в форме класса. Класс нужен, потому что
юниту требуется логгер из контейнера: зависимости объявлены в
`@Injectable`, как у любого провайдера. Метод `handle` получает три
аргумента.

- `outcome` — чем закончился запрос: `completed`, `failed`,
  `disconnected` или `aborted`. `.finally` вызывается при любом из них,
  включая обрыв соединения и остановку приложения, и ошибка внутри
  `.finally` не меняет ответ.
- `res` — итоговый ответ. `res.status` не зависит от транспорта: `ok`,
  `created`, `not_found`. В HTTP-код его переводит транспорт.
- `ctx` — контекст запроса. `ctx.input` — поля, накопленные pre-юнитами;
  `ctx.raw.pattern` — паттерн endpoint'а, например `GET /users/:id`.

Тип `ExtendableContext<{ requestId?: string }>` описывает, что юнит ждёт
от контекста: поле объявлено необязательным, потому что в `.finally`
попадают и запросы, на которых pre-юнит не успел выполниться. Поле вне
объявленного типа не компилируется.

Идентификатор запроса в записи аудита есть, хотя юнит его не передаёт.
Логгер ядра читает `requestId` из контекста запроса сам и добавляет его
полем к каждой записи, сделанной внутри запроса. Вне запроса, например в
`@OnInit`, поля нет.

`observability` — слой: один вызов `makePipeline()` с цепочкой методов,
обычное значение. Оно экспортируется и подключается к каждому endpoint'у.

## Подключение к endpoint'ам

```typescript
// examples/users-service/src/users/endpoints/list-users.endpoint.ts
export const ListUsers = httpEndpoint({
  method: 'GET',
  path: '/users',
  input: ListUsersInput,
  output: z.array(User),
  doc: { summary: 'Список пользователей', tags: ['users'] },
  pipeline: observability,
  handler: ListUsersHandler,
});
```

Поле `pipeline:` принимает слой. Endpoint без этого поля тоже работает:
у `CheckHealth` из [главы 1](./01-first-service.md) пайплайна нет.

Класс-юнит создаёт контейнер, поэтому `AuditOutcome` регистрируется в
`providers:` фичи. Класс-юнит, которого нет в `providers:`, останавливает
сборку на фазе ASSEMBLE, до открытия сокета.

```typescript
// examples/users-service/src/users.feature.ts
export const UsersFeature = makeFeature({
  name: 'users',
  providers: [Database, DbUsersRepository, AuditOutcome, Authenticate],
  // …
});
```

Запустите сервис и выполните запрос:

```bash
API_TOKEN=secret NESTLING_LOG_LEVEL=debug \
  yarn workspace @examples/users-service start:dev
curl -H 'x-request-id: req-42' http://localhost:3000/users/1
```

В логе появятся две записи с одним идентификатором:

```
2026-09-06T12:00:00.000Z DEBUG DbUsersRepository byId 1 requestId=req-42
2026-09-06T12:00:00.001Z INFO  AuditOutcome GET /users/:id ok requestId=req-42 outcome=completed
```

Первую запись пишет хранилище, вторую пишет `AuditOutcome`. Без заголовка
`x-request-id` на месте `req-42` будет случайный UUID. Без
`NESTLING_LOG_LEVEL=debug` первой записи не будет: уровень по умолчанию
`info`. С `NESTLING_LOG_FORMAT=json` те же записи выходят объектами с
полями `time`, `level`, `scope`, `requestId`, `msg` и полями вызова.

## Идентификатор запроса в глубине графа

Запись `byId 1` пишет `DbUsersRepository`. Хендлер не передаёт ему
`requestId` параметром: хранилище читает значение из контекста само.

```typescript
// examples/users-service/src/users/users.repository.ts
import type { CtxReader, Logger } from '@nestling/app';
import { Ctx, Logger$, RequestId } from '@nestling/app';

@Injectable(UsersRepository$, [Database, Logger$.auto, Ctx(RequestId)])
export class DbUsersRepository implements UsersRepository {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    private readonly requestId: CtxReader<string>,
  ) {}

  async byId(id: string): Promise<User | null> {
    this.trace(`byId ${id}`);

    return this.db.users.find((user) => user.id === id) ?? null;
  }

  // …

  private trace(operation: string): void {
    this.logger.debug(operation, { requestId: this.requestId.peek() ?? 'n/a' });
  }
}
```

`RequestId` — переменная контекста, которую объявляет `withRequestId()`.
`Ctx(RequestId)` — токен читателя этой переменной, типизированный
значением переменной как `CtxReader<string>`. Читатель — обычный узел
графа: зависимость хранилища от контекста запроса видна в `deps` и в
визуализации графа, а тест подменяет её через `contextValue`.

Пока выполняется запрос, накопленный контекст пайплайна доступен любому
коду, который был вызван из хендлера, на любой глубине. Читатель даёт
два метода.

- `get()` возвращает значение или бросает ошибку с указанием причины,
  если запроса нет или переменная не объявлена в пайплайне.
- `peek()` возвращает значение или `undefined`. Хранилище использует его,
  потому что тот же метод может быть вызван из `@OnInit`, где запроса
  ещё нет.

Хранилище кладёт `requestId` полем записи само, потому что значение ему
нужно: это его способ прочитать контекст. Для записи логгера этого не
требуется: поле, которое вызов не задал, логгер ядра добавляет сам. Так
устроен `AuditOutcome` выше.

Что переменная объявлена на каждом маршруте, где её читают, проверяет
политика сборки `hasVar`: [глава 9](./09-auth.md).

Слой можно расширить другим слоем функцией `compose`: `pre`-юниты
внешнего слоя выполняются раньше, а `.finally` внешнего слоя выполняется
позже, чем у внутреннего.

## Свой логгер

Логгер ядра по умолчанию пишет в `stderr` текстом или JSON. Библиотека
логирования подключается одним провайдером под токеном `RootLogger$`:

```typescript
export const appLogging = makePlugin({
  name: 'app-logging',
  providers: [factoryProvider(RootLogger$, () => pinoAdapter(pino()), [])],
});
```

Замена корня меняет все члены `Logger$`: и `Logger$.auto` в сервисах, и
записи самого ядра. Ошибки дубля нет: умолчание ядра уступает провайдеру
приложения. Провайдер под `RootLogger$` не может зависеть от `Logger$(x)`:
это цикл, и сборка назовёт его путь.

## Проверка

```typescript
// examples/users-service/src/app.spec.ts
it('пишет запись аудита через логгер ядра', async () => {
  // Подмена корня перехватывает записи всех членов Logger$: и ядра, и
  // приложения. Область записи — имя класса, взявшего Logger$.auto
  const spy = spyLogger();
  await using testApp = await assembleTest(app, {
    config: testConfig,
    overrides: [
      [UsersRepository$, inMemoryUsersRepo([alice])],
      [RootLogger$, spy.logger],
    ],
  });

  unwrap(await testApp.call(GetUser, { id: '1' }));

  expect(spy.entries).toContainEqual({
    level: 'info',
    message: 'GET /users/:id ok',
    fields: { scope: 'AuditOutcome', outcome: 'completed' },
  });
});
```

`spyLogger()` из `@nestling/testing` возвращает логгер, который копит
записи в `entries` вместо `stderr`. Подмена `RootLogger$` перехватывает
записи всех членов `Logger$` — и сервисов, и самого ядра. Вызов
`testApp.call` проходит весь пайплайн, поэтому `.finally` выполняется, и
запись аудита попадает в `spy.entries`. Каждая запись — `{ level,
message, fields }`; поле `scope` несёт область члена семейства.

Запрос несуществующего пользователя оставляет в логе запись
`GET /users/:id not_found` с полем `outcome=failed`: отказ хендлера
проходит через тот же `.finally`.

```bash
curl http://localhost:3000/users/404
```

Слой, который проверяет токен и не даёт забыть себя на новом endpoint'е:
[глава 9](./09-auth.md).
