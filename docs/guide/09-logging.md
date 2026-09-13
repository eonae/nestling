# 9. Видеть каждый запрос в логе

> Гайд по текущему API; сверено с кодом `e2500af3`.
> Целевое описание: [design/pipeline.md](../design/pipeline.md) и
> [design/container.md](../design/container.md), раздел «Логгер ядра».
> Почему так: записи [ideas.md](../decisions/ideas.md) «Pipeline v2:
> плоские фазы, слои, композиция константами», «Асинхронный контекст:
> read-only ALS-проекция pipeline-контекста», «Логгер ядра: `RootLogger$`,
> семейство `Logger$` с `.auto` и `child`» [2026-09-06] и «Разбор обзоров
> d/10 и d/13» [2026-09-12], пункт 2.

Сервис отвечает клиентам, но что с ним происходит, видно только по
ответам. Каждый запрос должен оставлять запись в логе: адрес, статус и
то, чем он закончился. Записи одного запроса, даже из глубины кода,
должны связываться между собой по общему идентификатору.

## Логгер ядра

Свой логгер объявлять не нужно: он есть у ядра, и им пользуются и
фреймворк, и приложение. Сервис берёт его как обычную зависимость:

```typescript
// src/users/users.repository.ts
import type { CtxReader, Logger } from '@nestlingjs/app';
import { Ctx, Logger$, RequestId } from '@nestlingjs/app';
import { Component } from '@nestlingjs/container';

@Component([db.connection, Logger$.auto, Ctx(RequestId), Ctx(db.tx)])
export class DbUsersRepository implements UsersRepository {
  constructor(
    private readonly connection: PgConnection<typeof schema>,
    private readonly logger: Logger,
    // …
  ) {}

  private trace(operation: string): void {
    this.logger.debug(operation, { requestId: this.requestId.peek() ?? 'n/a' });
  }
}
```

`Logger` — интерфейс из `@nestlingjs/app`. `Logger$` — семейство
DI-токенов: `Logger$('db')` даёт логгер с областью `db`, а `Logger$.auto`
— с областью по имени класса-потребителя, здесь `DbUsersRepository`.
Область попадает в каждую запись полем `scope`, поэтому по логу видно,
кто написал строку. Как устроены семейства DI-токенов, рассказывает
рецепт [«Зависимости по имени и сбор вкладов из
модулей»](../recipes/token-families.md).

Тем же логгером пользуются пакеты: соединение с базой пишет
`database connected` с хостом, а не с адресом целиком — адрес несёт
пароль.

У логгера четыре уровня: `debug`, `info`, `warn`, `error`. У каждого три
формы вызова:

| Форма | Что получается |
|---|---|
| `logger.info('database connected', { host })` | сообщение и поля |
| `logger.error(error, { operation })` | сообщение из `error.message`, сама ошибка в поле `err` |
| `logger.debug({ rows: 3 })` | только поля, без сообщения |

Отказ из [главы 4](./04-errors.md) проходит формой ошибки:
`logger.warn(UserNotFound({ id }))`. Ключ `err` зарезервирован за
ошибкой: логгер записывает её имя, сообщение, стек и `cause`.

`logger.child({ orderId })` возвращает логгер, который добавляет
`orderId` к каждой записи. Так пишется серия записей об одном объекте.

Записи уходят в `stderr` одной строкой каждая. Уровень и формат задают
две переменные окружения:

| Переменная | Значения | По умолчанию |
|---|---|---|
| `NESTLING_LOG_LEVEL` | `debug`, `info`, `warn`, `error`, `silent` | `info` |
| `NESTLING_LOG_FORMAT` | `text`, `json` | `text` |

Запись уровня ниже заданного отбрасывается; `silent` отсекает все четыре
уровня. Опечатка в значении останавливает старт: это обычная секция
конфига, и невалидное значение проверяется на сборке, как в
[главе 7](./07-config.md).

## Слой наблюдаемости

Всё, что происходит вокруг хендлера, описывает пайплайн —
последовательность шагов. Шаг — одна функция или класс. Пайплайн
объявляется вызовом `makePipeline()` и читается сверху вниз как порядок
исполнения:

| Метод | Когда выполняется | Что видит |
|---|---|---|
| `.pre(step)` | до хендлера, в порядке объявления | накопленный контекст; каждый шаг добавляет в него свои поля |
| `.ok(step)` | только для успешного ответа | полный контекст |
| `.catch(step)` | только для ответа-отказа | поля своего слоя как необязательные |
| `.finally(step)` | всегда, последним | то же, что `.catch`, плюс исход запроса |

Для лога нужны две фазы: `.pre`, чтобы положить идентификаторы запроса и
трассы в контекст, и `.finally`, чтобы записать итог.

```typescript
// src/observability.ts
import type {
  ExtendableContext,
  Logger,
  Outcome,
  ResponseContext,
} from '@nestlingjs/app';
import {
  Logger$,
  makePipeline,
  withRequestId,
  withTracing,
} from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';

/**
 * Шаг `.finally`: пишет строку аудита по завершении каждого запроса.
 */
@Handler([Logger$.auto])
export class AuditOutcome {
  constructor(private readonly logger: Logger) {}

  handle(
    outcome: Outcome,
    res: ResponseContext,
    ctx: ExtendableContext<{ requestId?: string }>,
  ): void {
    // Идентификатор запроса в запись кладёт ядро: это объявленное поле
    // корреляции, и руками префикс не пишется
    this.logger.info(`${ctx.raw.pattern} ${res.status}`, { outcome });
  }
}

export const observability = makePipeline()
  .pre(withRequestId())
  .pre(withTracing())
  .finally(AuditOutcome);
```

`withRequestId()` — готовый pre-шаг из `@nestlingjs/app`. Он берёт
идентификатор из заголовка `x-request-id` или генерирует случайный и
кладёт его в контекст полем `requestId`.

`AuditOutcome` — шаг `.finally` в форме класса. Класс нужен, потому что
шагу требуется логгер из контейнера: зависимости объявлены в декораторе
роли. Роль здесь `@Handler` — у класса есть метод `handle`; в `providers:`
фичи он остаётся обычным узлом графа. Метод `handle` получает три
аргумента.

- `outcome` — чем закончился запрос: `completed`, `failed`,
  `disconnected` или `aborted`. `.finally` вызывается при любом из них,
  включая обрыв соединения и остановку приложения, и ошибка внутри
  `.finally` не меняет ответ.
- `res` — итоговый ответ. `res.status` не зависит от транспорта: `ok`,
  `created`, `not_found`. В HTTP-код его переводит транспорт.
- `ctx` — контекст запроса. `ctx.input` — поля, накопленные pre-шагами;
  `ctx.raw.pattern` — паттерн endpoint'а, например `GET /users/:id`.

Тип `ExtendableContext<{ requestId?: string }>` описывает, что шаг ждёт
от контекста: поле объявлено необязательным, потому что в `.finally`
попадают и запросы, на которых pre-шаг не успел выполниться. Поле вне
объявленного типа не компилируется.

Идентификатор запроса в записи аудита есть, хотя шаг его не передаёт.
`requestId` — объявленное **поле корреляции**: ядро читает его из
контекста запроса и добавляет полем к каждой записи, сделанной внутри
запроса. Вне запроса, например при захвате ресурса, поля нет. Что ещё
попадает в записи полем, задаёт опция `logging` корня — [ниже](#свой-логгер).

`observability` — слой: один вызов `makePipeline()` с цепочкой методов,
обычное значение. Оно экспортируется и подключается к каждому endpoint'у.

## Подключение к endpoint'ам

```typescript
// src/users/endpoints/list-users.endpoint.ts
export const ListUsers = httpEndpoint.get('/users', {
  input: ListUsersInput,
  output: z.array(User),
  doc: { summary: 'Список пользователей', tags: ['users'] },
  pipeline: observability,
  handler: ListUsersHandler,
});
```

Поле `pipeline:` принимает слой. Endpoint без этого поля тоже работает:
у `BuildInfo` из [главы 10](./10-auth.md) пайплайна нет, как и у проб
`httpProbes()` из рецепта [«Кто сейчас подключён и как его
отключить»](../recipes/ops.md).

Класс-шаг создаёт контейнер, поэтому `AuditOutcome` регистрируется в
`providers:` фичи. Класс-шаг, которого нет в `providers:`, останавливает
сборку на фазе BUILD, до открытия сокета.

```typescript
// src/users.feature.ts
export const UsersFeature = makeFeature({
  name: 'users',
  providers: [DbUsersRepository, AuditOutcome, Authenticate],
  // …
});
```

Запустите сервис и выполните запрос:

```bash
API_TOKEN=secret NESTLING_LOG_LEVEL=debug \
  yarn start:dev
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
// src/users/users.repository.ts
import type { CtxReader, Logger } from '@nestlingjs/app';
import { Ctx, Logger$, RequestId } from '@nestlingjs/app';

@Component([db.connection, Logger$.auto, Ctx(RequestId), Ctx(db.tx)])
export class DbUsersRepository implements UsersRepository {
  constructor(
    private readonly connection: PgConnection<typeof schema>,
    private readonly logger: Logger,
    private readonly requestId: CtxReader<string>,
    private readonly tx: CtxReader<PgTx<typeof schema>>,
  ) {}

  async byId(id: string): Promise<User | null> {
    this.trace(`byId ${id}`);

    // …
  }

  private trace(operation: string): void {
    this.logger.debug(operation, { requestId: this.requestId.peek() ?? 'n/a' });
  }
}
```

`RequestId` — переменная контекста, которую объявляет `withRequestId()`.
`Ctx(RequestId)` — DI-токен читателя этой переменной, типизированный
значением переменной как `CtxReader<string>`. Читатель — обычный узел
графа: зависимость хранилища от контекста запроса видна в `deps` и в
визуализации графа, а тест подменяет её через `contextValue`.

Пока выполняется запрос, накопленный контекст пайплайна доступен любому
коду, который был вызван из хендлера, на любой глубине. Читатель даёт
два метода.

- `get()` возвращает значение или бросает ошибку с указанием причины,
  если запроса нет или переменная не объявлена в пайплайне.
- `peek()` возвращает значение или `undefined`. Хранилище использует его,
  потому что тот же метод может быть вызван при захвате ресурса, где
  запроса ещё нет.

Хранилище кладёт `requestId` полем записи само, потому что значение ему
нужно: это его способ прочитать контекст. Для записи логгера этого не
требуется: поле, которое вызов не задал, ядро добавляет само. Так устроен
`AuditOutcome` выше. Поле вызова сильнее поля корреляции: явное значение
вызывающего остаётся в записи.

Что переменная объявлена на каждом маршруте, где её читают, проверяет
политика сборки `hasVar`: [глава 10](./10-auth.md).

## Трасса запроса

`withTracing()` — второй шаг слоя. Он кладёт в контекст переменную
`Trace` со значением вида `{ traceId, spanId, parentSpanId?, sampled }`, а
ядро добавляет `traceId` полем к каждой записи внутри запроса — так же,
как `requestId`: это второе поле корреляции из умолчания.

```text
2026-09-12T20:03:49.400Z INFO  UsersService created requestId=7f3a… traceId=4bf92f35…
```

Шаг продолжает трассу вызывающего, если она пришла заголовком
`traceparent`, и начинает новую, если нет. Идентификатор участка
создаётся на каждый запрос, а участок вызывающего уходит в
`parentSpanId`. Непонятный заголовок запрос не ломает: трасса просто
начинается заново.

Внутри одного процесса разница между `requestId` и `traceId` невелика.
Она становится важной, когда запрос проходит через несколько сервисов:
`requestId` у каждого свой, а `traceId` один на всю цепочку. Как трасса
переходит границу процесса, показывает [глава 20](./20-split.md).

Значение доступно и прикладному коду — читателем `Ctx(Trace)`, как
`RequestId`:

```typescript
@Component([Ctx(Trace)])
export class AuditTrail {
  constructor(private readonly trace: CtxReader<TraceContext>) {}

  record(action: string): void {
    this.store.put({ action, traceId: this.trace.get().traceId });
  }
}
```

Слой можно расширить другим слоем функцией `compose`: `pre`-шаги
внешнего слоя выполняются раньше, а `.finally` внешнего слоя выполняется
позже, чем у внутреннего.

## Свой логгер

Логгер ядра по умолчанию пишет в `stderr` текстом или JSON. Другая
библиотека логирования подключается полем `logger` словаря `logging`. Для
pino готовая реализация лежит в своём пакете:

```bash
npm install @nestlingjs/logging.pino pino
```

```typescript
// app.ts
import { pinoLogger } from '@nestlingjs/logging.pino';

export const app = makeApp({
  features: [UsersFeature],
  transports: [http()],
  logging: { logger: pinoLogger({ pino: { redact: ['password'] } }) },
});
```

`pinoLogger` принимает `level`, `format` и поле `pino` — остальные опции
библиотеки: redaction, сериализаторы, семплирование. В формате `text`
строка совпадает со штатным логгером до байта: печатает её одна и та же
функция. В формате `json` строку пишет сам pino — набор ключей тот же,
порядок его.

Ключи, которыми держится формат, заняты адаптером: `level`, `timestamp`,
`formatters`, `base`, `messageKey`, `errorKey`, `transport` и вложенный
`serializers.err`. Переданный занятый ключ останавливает создание логгера,
и сообщение называет замену. Молча перетереть его адаптер не может: тогда
формат перестал бы быть обещанием.

Замена корня меняет все члены `Logger$`: и `Logger$.auto` в сервисах, и
записи самого ядра, включая предупреждения сборки. Значение готовое:
корневой логгер создаётся до графа, поэтому зависеть от его узлов он не
может — всё нужное ему передают. Второго способа объявить корень нет:
провайдер под `RootLogger$` в `providers:` — ошибка сборки, и её текст
называет опцию `logging`.

Поля корреляции чужая реализация получает даром: их подмешивает ядро, а не
логгер. Реализация под другую библиотеку пишется так же, как `pinoLogger`:
интерфейс `Logger` лежит в отдельном пакете `@nestlingjs/logging` —
адаптеру нужен интерфейс, а не всё ядро. Оттуда же берут и формат строки,
`formatLine` и `serializeError`, чтобы не писать его второй раз:

```typescript
import type { Logger } from '@nestlingjs/logging';
import { formatLine, serializeError } from '@nestlingjs/logging';
```

Скрипт рядом с приложением — генератор документа, миграция, внешний
клиент — берёт готовый логгер той же фабрикой:

```typescript
// src/openapi.ts
import { makeConsoleLogger } from '@nestlingjs/app';

makeConsoleLogger().info('document written', { file, paths: 12 });
```

Формат строки тот же, что у сервиса, поэтому вывод скрипта читается тем же
глазом и тем же грепом.

## Состав полей корреляции

Поле корреляции — контекстная переменная, значение которой уходит в каждую
запись. Состав задаёт `logging.fields`:

```typescript
// app.ts
import { logField, makeApp, RequestId, Trace } from '@nestlingjs/app';

export const app = makeApp({
  features: [UsersFeature],
  transports: [http()],
  logging: {
    fields: [
      RequestId,
      logField(Trace, 'traceId', (trace) => trace.traceId),
      logField(TenantId, 'tenant'),
    ],
  },
});
```

Умолчание — первые две строки списка: `requestId` и `traceId`. Именно они
и стоят в записях примеров выше.

Переменная без обёртки даёт поле с именем переменной и значением целиком:
`RequestId` — это `requestId: '7f3a…'`. Обёртка `logField(Var, name,
select?)` задаёт имя поля, а третьим аргументом — что из значения в него
попадает. Проекция нужна переменным-объектам: `Trace` несёт `traceId`,
`spanId` и `sampled`, а в записи полезен идентификатор трассы — по нему
ищут записи двух процессов.

Пустой список `fields: []` отключает корреляцию: записи выходят без полей
из контекста.

Свои поля объявляет и плагин — полем `logFields`:

```typescript
export const tenancy = makePlugin({
  name: '@acme/tenancy',
  logFields: [logField(TenantId, 'tenant')],
  // …
});
```

Так плагин наблюдаемости ставит своё поле сам, и приложению об этом писать
не нужно. Списки корня и подключённых плагинов складываются на сборке. Два
объявления с одним именем поля останавливают старт: сообщение называет имя
и обоих объявивших.

## Проверка

```typescript
// src/app.spec.ts
it('пишет запись аудита через логгер ядра', async () => {
  // Подмена корня перехватывает записи всех членов Logger$: и ядра, и
  // приложения. Область записи — имя класса, взявшего Logger$.auto
  const spy = spyLogger();
  await using testApp = await buildTest(app, {
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
    fields: {
      scope: 'AuditOutcome',
      outcome: 'completed',
      requestId: expect.any(String),
    },
  });
});
```

`spyLogger()` из `@nestlingjs/testing` возвращает логгер, который копит
записи в `entries` вместо `stderr`. Подмена `RootLogger$` в `overrides`
тестового корня перехватывает записи всех членов `Logger$` — и сервисов, и
ядра — начиная с фазы INIT. Вызов
`testApp.call` проходит весь пайплайн, поэтому `.finally` выполняется, и
запись аудита попадает в `spy.entries`. Каждая запись — `{ level,
message, fields }`; поле `scope` несёт область токена семейства, а
`requestId` — поле корреляции: шпион получает его так же, как штатный
логгер.

Без подмены тестовый прогон молчит: `buildTest` поднимает приложение с
`NESTLING_LOG_LEVEL=silent`, поэтому вывод теста — отчёт раннера, а не
записи сборки каждого из сотен прогонов. Записи в `stderr` возвращает свой
`config: vars({ NESTLING_LOG_LEVEL: 'info' })`.

Запрос несуществующего пользователя оставляет в логе запись
`GET /users/:id not_found` с полем `outcome=failed`: отказ хендлера
проходит через тот же `.finally`.

```bash
curl http://localhost:3000/users/404
```

Слой, который проверяет DI-токен и не даёт забыть себя на новом
endpoint'е: [глава 10](./10-auth.md).
