# 8. Видеть каждый запрос в логе

> Гайд по текущему API; сверено с кодом `users-service` (2026-09-05).
> Целевое описание: [design/pipeline.md](../design/pipeline.md). Почему так:
> записи [ideas.md](../decisions/ideas.md) «Pipeline v2: плоские фазы, слои,
> композиция константами» и «Асинхронный контекст: read-only ALS-проекция
> pipeline-контекста».

Сервис отвечает клиентам, но что с ним происходит, видно только по
ответам. Каждый запрос должен оставлять строку в логе: адрес, статус и
то, чем он закончился. Строки одного запроса, даже из глубины кода,
должны связываться между собой по общему идентификатору.

```typescript
// examples/users-service/src/logging.ts
import { Injectable, makeToken } from '@nestling/container';

/** Логгер приложения */
export interface Logger {
  log(message: string): void;
  error(message: string): void;
}

/** Токен логгера: потребители зависят от интерфейса, а не от класса */
export const Logger$ = makeToken<Logger>('Logger');

/** Логгер в stdout с именем сервиса в префиксе */
@Injectable(Logger$, [])
export class ConsoleLogger implements Logger {
  log(message: string): void {
    console.log(`[users-service] ${message}`);
  }

  error(message: string): void {
    console.error(`[users-service] ${message}`);
  }
}
```

Логгер объявлен так же, как хранилище в [главе 5](./05-repository.md):
интерфейс, токен `Logger$` и класс, который регистрируется под этим
токеном. Класс попадает в `providers:` фичи. Всё, что пишет в лог,
зависит от токена, поэтому тест подменит логгер одной строкой в
`overrides`.

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
import { Injectable } from '@nestling/container';
import type {
  ExtendableContext,
  Outcome,
  ResponseContext,
} from '@nestling/pipeline';
import { makePipeline, withRequestId } from '@nestling/pipeline';

/**
 * Юнит `.finally`: пишет строку аудита по завершении каждого запроса.
 */
@Injectable([Logger$])
export class AuditOutcome {
  constructor(private readonly logger: Logger) {}

  handle(
    outcome: Outcome,
    res: ResponseContext,
    ctx: ExtendableContext<{ requestId?: string }>,
  ): void {
    // В ответной фазе поля своего слоя опциональны: pre-юнит мог не
    // выполниться, отсюда `?? 'n/a'`
    this.logger.log(
      `[${ctx.input.requestId ?? 'n/a'}] ${ctx.raw.pattern} ${res.status} (${outcome})`,
    );
  }
}

export const observability = makePipeline()
  .pre(withRequestId())
  .finally(AuditOutcome);
```

`withRequestId()` — готовый pre-юнит из `@nestling/pipeline`. Он берёт
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
объявленного типа не компилируется, и `ctx.input.requestId` здесь имеет
тип `string | undefined`.

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
`providers:` фичи рядом с логгером. Класс-юнит, которого нет в
`providers:`, останавливает сборку на фазе ASSEMBLE, до открытия сокета.

```typescript
// examples/users-service/src/users.feature.ts
export const UsersFeature = makeFeature({
  name: 'users',
  providers: [
    ConsoleLogger,
    Database,
    DbUsersRepository,
    AuditOutcome,
    Authenticate,
  ],
  // …
});
```

Запустите сервис и выполните запрос:

```bash
API_TOKEN=secret yarn workspace @examples/users-service start:dev
curl -H 'x-request-id: req-42' http://localhost:3000/users/1
```

В логе появятся две строки с одним идентификатором:

```
[users-service] [req-42] byId 1
[users-service] [req-42] GET /users/:id ok (completed)
```

Первую строку пишет хранилище, вторую пишет `AuditOutcome`. Без заголовка
`x-request-id` на месте `req-42` будет случайный UUID.

## Идентификатор запроса в глубине графа

Строку `byId 1` пишет `DbUsersRepository`. Хендлер не передаёт ему
`requestId` параметром: хранилище читает значение из контекста само.

```typescript
// examples/users-service/src/users/users.repository.ts
import type { CtxReader } from '@nestling/pipeline';
import { Ctx, RequestId } from '@nestling/pipeline';

@Injectable(UsersRepository$, [Database, Logger$, Ctx(RequestId)])
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
    this.logger.log(`[${this.requestId.peek() ?? 'n/a'}] ${operation}`);
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

Что переменная объявлена на каждом маршруте, где её читают, проверяет
политика сборки `hasVar`: [глава 9](./09-auth.md).

Слой можно расширить другим слоем функцией `compose`: `pre`-юниты
внешнего слоя выполняются раньше, а `.finally` внешнего слоя выполняется
позже, чем у внутреннего.

## Проверка

```typescript
// examples/users-service/src/app.spec.ts
it('пишет строку аудита с идентификатором запроса', async () => {
  const spy = spyLogger();
  await using testApp = await assembleTest(app, {
    config: testConfig,
    overrides: [
      [UsersRepository$, inMemoryUsersRepo([alice])],
      [Logger$, spy.logger],
    ],
  });

  unwrap(await testApp.call(GetUser, { id: '1' }));

  expect(spy.lines).toContainEqual(
    expect.stringMatching(/^\[[^\]]+] GET \/users\/:id ok \(completed\)$/),
  );
});
```

Тест подменяет логгер объектом, который копит строки, и вызывает endpoint
через `testApp.call`. Вызов проходит весь пайплайн, поэтому `.finally`
выполняется, и строка аудита попадает в `spy.lines`. Заголовков в
`testApp.call` нет, и `withRequestId()` генерирует идентификатор сам.

Запрос несуществующего пользователя оставляет в логе строку
`GET /users/:id not_found (failed)`: отказ хендлера проходит через тот
же `.finally`.

```bash
curl http://localhost:3000/users/404
```

Слой, который проверяет токен и не даёт забыть себя на новом endpoint'е:
[глава 9](./09-auth.md).
