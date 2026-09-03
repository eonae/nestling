# 7. Видеть каждый запрос в логе

> Гайд по текущему API; сверено с кодом `examples.users-service` (2026-09-03).
> Целевое описание: [design/pipeline.md](../design/pipeline.md). Почему так:
> записи [ideas.md](../decisions/ideas.md) «Pipeline v2: плоские фазы, слои,
> композиция константами» и «Асинхронный контекст: read-only ALS-проекция
> pipeline-контекста».

## Задача

Сервис отвечает клиентам, но что с ним происходит, видно только по их
ответам. Нужно, чтобы каждый запрос оставлял строку в логе: адрес, статус
и чем запрос закончился. Строки одного запроса, в том числе из глубины
кода, должны связываться между собой по общему идентификатору.

## Решение

### Шаг 1. Логгер как зависимость

```typescript
// packages/examples.users-service/src/logging.ts
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

### Шаг 2. Пайплайн: что происходит вокруг хендлера

Пайплайн — последовательность юнитов вокруг хендлера. Юнит — одна
функция или класс. Пайплайн объявляется вызовом `makePipeline()` и
читается сверху вниз как порядок исполнения:

| Метод | Когда выполняется | Что видит |
|---|---|---|
| `.pre(unit)` | до хендлера, в порядке объявления | накопленный контекст; каждый юнит добавляет в него свои поля |
| `.ok(unit)` | только для успешного ответа | полный контекст |
| `.catch(unit)` | только для ответа-отказа | поля своего слоя как необязательные |
| `.finally(unit)` | всегда, последним | то же, что `.catch`, плюс исход запроса |

Для лога нужны две фазы: `.pre`, чтобы положить идентификатор запроса в
контекст, и `.finally`, чтобы записать итог.

```typescript
// packages/examples.users-service/src/observability.ts
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
  `disconnected` или `aborted`.
- `res` — итоговый ответ. `res.status` не зависит от транспорта: `ok`,
  `created`, `not_found`. В HTTP-код его переводит транспорт.
- `ctx` — контекст запроса. `ctx.input` — поля, накопленные pre-юнитами;
  `ctx.raw.pattern` — паттерн endpoint'а, например `GET /users/:id`.

Тип `ExtendableContext<{ requestId?: string }>` описывает, что юнит ждёт
от контекста. Поле объявлено необязательным: в `.finally` попадают и
запросы, на которых pre-юнит не успел выполниться.

`observability` — слой. Слой — это один вызов `makePipeline()` с цепочкой
методов, и он является обычным значением. Это значение экспортируется и
подключается к каждому endpoint'у.

### Шаг 3. Подключить слой к endpoint'ам

```typescript
// packages/examples.users-service/src/users/endpoints/list-users.endpoint.ts
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
`providers:` фичи рядом с логгером:

```typescript
// packages/examples.users-service/src/users.feature.ts
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
API_TOKEN=secret yarn workspace examples.users-service start:dev
curl -H 'x-request-id: req-42' http://localhost:3000/users/1
```

В логе появятся две строки с одним идентификатором:

```
[users-service] [req-42] byId 1
[users-service] [req-42] GET /users/:id OK (completed)
```

Первую строку пишет хранилище, вторую пишет `AuditOutcome`. Без заголовка
`x-request-id` на месте `req-42` будет случайный UUID.

### Шаг 4. Идентификатор запроса в глубине графа

Строку `byId 1` пишет `DbUsersRepository`. Хендлер не передаёт ему
`requestId` параметром: хранилище читает значение из контекста само.

```typescript
// packages/examples.users-service/src/users/users.repository.ts
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
`Ctx(RequestId)` — токен читателя этой переменной. Читатель является
обычным узлом графа: зависимость хранилища от контекста запроса видна в
`deps` и в визуализации графа, а тест подменяет её через `contextValue`.

Пока выполняется запрос, накопленный контекст пайплайна доступен любому
коду, который был вызван из хендлера, на любой глубине. Читатель даёт
два метода.

- `get()` возвращает значение или бросает ошибку, если запроса нет или
  переменная не объявлена в пайплайне.
- `peek()` возвращает значение или `undefined`. Хранилище использует его,
  потому что тот же метод может быть вызван из `@OnInit`, где запроса
  ещё нет.

### Шаг 5. Слои складываются

Слой можно расширить другим слоем функцией `compose`. `pre`-юниты
внешнего слоя выполняются раньше, а `.finally` внешнего слоя выполняется
позже, чем у внутреннего. В [главе 9](./09-auth.md) от `observability`
будет составлен слой `authed`.

## Что гарантирует фреймворк

- Класс-юнит, которого нет в `providers:`, останавливает сборку на фазе
  ASSEMBLE, до открытия сокета.
- Поля контекста типизированы. Юнит объявляет, что ждёт от контекста,
  типом `ExtendableContext<…>`; `ctx.input.requestId` в `.finally`
  имеет тип `string | undefined`, а поле вне объявленного типа не
  компилируется.
- `Ctx(RequestId)` типизирован значением переменной: `CtxReader<string>`.
  Читатель для переменной, которую пайплайн не объявляет, бросает ошибку
  с указанием причины при вызове `get()`; `peek()` возвращает `undefined`.
- `.finally` вызывается всегда, включая отказ, обрыв соединения и
  остановку приложения. Ошибка внутри `.finally` не меняет ответ.

## Как проверить

```typescript
// packages/examples.users-service/src/app.spec.ts
it('пишет строку аудита с идентификатором запроса', async () => {
  const spy = spyLogger();
  await using testApp = await assembleTest(app, {
    overrides: [
      [UsersRepository$, inMemoryUsersRepo([alice])],
      [Logger$, spy.logger],
    ],
  });

  unwrap(await testApp.call(GetUser, { id: '1' }));

  expect(spy.lines).toContainEqual(
    expect.stringMatching(/^\[[^\]]+] GET \/users\/:id OK \(completed\)$/),
  );
});
```

Тест подменяет логгер объектом, который копит строки, и вызывает endpoint
через `testApp.call`. Вызов проходит весь пайплайн, поэтому `.finally`
выполняется и строка аудита попадает в `spy.lines`. Заголовков в
`testApp.call` нет, и `withRequestId()` генерирует идентификатор сам.

## Пока не нужно

- Фазы `.ok` и `.catch` нужны, когда ответ надо изменить или разобрать
  отказ по коду. Они описаны в
  [приложении А](./appendix-a-alternatives.md).
- Проверка, что слой есть у каждого endpoint'а, появится в
  [главе 9](./09-auth.md) вместе с политиками сборки.
- Логгер, общий для нескольких фич, станет плагином в
  [главе 12](./12-features.md).
- Логгер, который знает имя своего потребителя, строится на семействе
  токенов в [главе 21](./21-token-families.md).

## Запускаемый код

- `packages/examples.users-service/src/logging.ts` — интерфейс, токен и
  реализация логгера.
- `packages/examples.users-service/src/observability.ts` — слой с
  `withRequestId()` и юнитом `AuditOutcome`.
- `packages/examples.users-service/src/users/users.repository.ts` —
  чтение `requestId` через `Ctx(RequestId)`.
- `packages/examples.users-service/src/users.feature.ts` — регистрация
  класса-юнита в `providers:`.
- `packages/examples.users-service/src/app.spec.ts` — тест строки аудита.

```bash
API_TOKEN=secret yarn workspace examples.users-service start:dev
curl -H 'x-request-id: req-42' http://localhost:3000/users/1
curl http://localhost:3000/users/404
```

Второй запрос даёт в логе `GET /users/:id NOT_FOUND (failed)`: отказ
хендлера проходит через тот же `.finally`.

## Дальше

Слой, который проверяет токен и не даёт забыть себя на новом
endpoint'е: [глава 9](./09-auth.md).
