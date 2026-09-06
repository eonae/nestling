# 13. Оповещать соседей о случившемся

> Гайд по текущему API; сверено с кодом `app-with-http` (2026-09-06).
> Целевое описание: [design/operations.md](../design/operations.md),
> разделы «Три вида» и «Профиль вызова». Почему так: записи
> [ideas.md](../decisions/ideas.md) «[2026-07-08] Порты: межфичевое
> общение через контракты» и «[2026-07-31] Порты: бюджет вызова моментом,
> ключ идемпотентности у команд».

Фича квот должна узнавать о каждом созданном пользователе, но ответ
клиенту не должен ждать её обработки. Завтра о том же захочет узнать
рассылка, и код регистрации не должен меняться. Кроме того, квоты ведут
журнал регистраций, и повторную доставку одного сообщения журнал должен
отличать от новой регистрации.

```typescript
// examples/app-with-http/src/operations.ts
export const UserRegisteredInput = z.object({
  id: z.string(),
  email: z.string(),
});

export type UserRegisteredInput = z.infer<typeof UserRegisteredInput>;

export const UserRegistered = makeEvent({
  name: 'users.registered',
  input: UserRegisteredInput,
});
```

`makeEvent` объявляет операцию вида `event`: факт, который уже случился.
У события есть имя и схема `input`, а `output` и `errors` нет: ответа
у факта не бывает. Подписчиков у события может быть сколько угодно,
включая ноль — тогда `emit` завершается сразу. Событие лежит в том же
файле, что запрос `ClaimQuota` из [главы 12](./12-features.md).

```typescript
// examples/app-with-http/src/features/quotas/user-registered-in-quotas.endpoint.ts
@Handler([Logger$.auto])
class UserRegisteredInQuotasHandler {
  constructor(private readonly logger: Logger) {}

  async handle(payload: UserRegisteredInput) {
    this.logger.info('quota bookkeeping', {
      userId: payload.id,
      email: payload.email,
    });
  }
}

export const UserRegisteredInQuotas = implement(UserRegistered, {
  subscriber: 'quotas',
  handler: UserRegisteredInQuotasHandler,
});
```

Подписчик — та же декларация `implement`, что у запроса, с одним
отличием: поле `subscriber` обязательно у реализации события и
запрещено у реализации запроса и команды. Оно даёт подписке имя. Внутри
процесса паттерн endpoint'а складывается как `users.registered@quotas`,
и два подписчика одного события различаются именами; с одинаковым именем
сборка остановится. У брокера имя становится именем группы получателей,
поэтому его задаёт автор, а не фреймворк.

Хендлер события ничего не возвращает. У операции без `output` тип
значения — `void`, поэтому `return` в конце не нужен.

Подписчик перечисляется в `endpoints:` фичи рядом с реализацией
запроса; список из [главы 12](./12-features.md) уже содержит его.

## Публикация

```typescript
// examples/app-with-http/src/features/users/endpoints/create-user.endpoint.ts
@Handler([
  UsersRepository$,
  ClaimQuota.caller,
  UserRegistered.emitter,
  SignupRecorded.emitter,
  ActivityHub,
])
class CreateUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly quotas: Port<typeof ClaimQuota>,
    private readonly registered: Emitter<typeof UserRegistered>,
    private readonly signup: Emitter<typeof SignupRecorded>,
    private readonly activity: ActivityHub,
  ) {}

  async handle(
    payload: CreateUserInput,
  ): Output<User, typeof EmailTaken | typeof QuotaExceeded> {
    // …
    const user = await this.users.insert({
      name: payload.name,
      email: payload.email,
    });

    // Событие: `emit` завершается по факту доставки, отказ подписчика
    // сюда не приходит
    await this.registered.emit({ id: user.id, email: user.email });
    // …
  }
}

export const CreateUser = httpEndpoint({
  operation: CreateUserOperation,
  pipeline: authed,
  handler: CreateUserHandler,
});
```

`UserRegistered.emitter` — токен эмиттера. Хендлер получает объект типа
`Emitter<typeof UserRegistered>` с методом `emit(payload, meta?)`.
`emit` возвращает `Promise<void>`, который завершается, когда сообщение
доставлено, а не когда подписчик его обработал. Отказ или исключение
подписчика к вызывающему не приходят: они попадают в диагностический
хук шины.

Новый подписчик появляется без правок в `create-user`: достаточно ещё
одного `implement(UserRegistered, { subscriber: '…' })` в любой фиче.

## Команда с ключом идемпотентности

Запись в журнал квот делает не событие, а команда:

```typescript
// examples/app-with-http/src/operations.ts
export const SignupRecordedInput = z.object({
  userId: z.string(),
  email: z.string(),
});

export type SignupRecordedInput = z.infer<typeof SignupRecordedInput>;

export const SignupRecorded = makeCommand({
  name: 'quotas.record-signup',
  input: SignupRecordedInput,
});
```

`makeCommand` объявляет операцию вида `command`: сообщение без ответа,
у которого ровно один владелец. У команды в `meta` есть поле
`idempotencyKey`: тип `meta` выбирается по виду операции, и обращение к
этому полю у события или запроса не компилируется.

```typescript
// examples/app-with-http/src/features/users/endpoints/create-user.endpoint.ts
    // Команда: ключ идемпотентности задаёт вызывающий, чтобы повтор после
    // сбоя нёс тот же ключ. Без ключа порт сгенерировал бы новый
    await this.signup.emit(
      { userId: user.id, email: user.email },
      { idempotencyKey: user.id },
    );
```

Ключ идемпотентности — идентичность намерения. Регистрация одного
пользователя остаётся одним намерением, даже если процесс упал после
`insert` и повторил `emit`, поэтому ключом взят `user.id`. Команда без
явного ключа тоже уходит с ключом: его генерирует эмиттер, и он
одинаков для всех повторных доставок одного `emit`.

Владелец команды читает ключ из контекста:

```typescript
// examples/app-with-http/src/features/quotas/signup-recorded.endpoint.ts
@Handler([SignupJournal])
class SignupRecordedHandler {
  constructor(private readonly journal: SignupJournal) {}

  async handle(payload: SignupRecordedInput) {
    this.journal.record(payload.userId);
  }
}

export const SignupRecordedImpl = implement(SignupRecorded, {
  pipeline: makePipeline().pre(withIdempotencyKey()),
  handler: SignupRecordedHandler,
});
```

```typescript
// examples/app-with-http/src/features/quotas/signup.journal.ts
@Component([Logger$.auto, Ctx(IdempotencyKey)])
export class SignupJournal {
  constructor(
    private readonly logger: Logger,
    private readonly intent: CtxReader<string>,
  ) {}

  /** Записывает регистрацию вместе с ключом идемпотентности */
  record(userId: string): void {
    this.logger.debug('signup recorded', {
      userId,
      intent: this.intent.get(),
    });
  }
}
```

`withIdempotencyKey()` — готовый pre-юнит из `@nestling/app`: он
берёт ключ из параметров вызова и объявляет переменную контекста
`IdempotencyKey`. Журнал читает её через `Ctx(IdempotencyKey)` так же,
как хранилище читало `RequestId` в [главе 8](./08-logging.md).
Дедупликацию по ключу пример не делает: ядро доставляет ключ до
обработчика, а что с ним делать, решает владелец команды.

Что юнит стоит в пайплайне реализации, проверяет политика:

```typescript
// examples/app-with-http/src/app.ts
    // Реализация команды регистрации кладёт ключ идемпотентности в
    // контекст: сервис в глубине графа читает его через `Ctx`
    everyEndpoint({
      transport: BusTransport$,
      pattern: /^quotas\.record-signup$/,
    }).hasVar(IdempotencyKey, 'idempotencyKey'),
```

Политики из [главы 9](./09-auth.md) отбирали endpoint'ы HTTP-транспорта.
Здесь фильтр указывает на транспорт шины `BusTransport$` и паттерн
команды, а проверка `hasVar` требует, чтобы пайплайн объявлял
переменную. Без `withIdempotencyKey()` сборка остановится.

## Три вида операций

| Вид | Конструктор | Владельцев | Ответ | `idempotencyKey` в `meta` | `durable` |
|---|---|---|---|---|---|
| запрос | `makeRequest` | ровно один | `Ok` или `Fail` | нет | нет |
| команда | `makeCommand` | ровно один | нет | есть | допустим |
| событие | `makeEvent` | любое число подписчиков | нет | нет | допустим |

Запрос подходит, когда без ответа продолжить нельзя: регистрация ждёт,
займётся ли место в квоте. Событие подходит, когда факт уже случился и
кому он нужен, решают подписчики. Команда подходит, когда получатель
ровно один и повтор доставки нужно отличать от нового намерения.

## Что видно в логе

Запустите сервис с уровнем `debug` и создайте пользователя:

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook NESTLING_LOG_LEVEL=debug \
  yarn workspace @examples/app-with-http start:dev
curl -X POST localhost:3000/users \
  -H 'authorization: Bearer secret' -H 'content-type: application/json' \
  -d '{"name":"User 1","email":"user1@example.com"}'
```

```
2026-09-06T12:00:00.000Z DEBUG DbUsersRepository insert user1@example.com requestId=b7600481-…
2026-09-06T12:00:00.001Z INFO  UserRegisteredInQuotasHandler quota bookkeeping userId=3 email=user1@example.com
2026-09-06T12:00:00.002Z DEBUG SignupJournal signup recorded userId=3 intent=3
2026-09-06T12:00:00.003Z INFO  AuditOutcome POST /users created requestId=b7600481-… outcome=completed
```

Вторую строку пишет подписчик события, третью пишет журнал: ключом
пришёл идентификатор пользователя. Подписчик и журнал работают в
собственном контексте запроса: значения контекста вызывающего, включая
`requestId`, в реализацию не попадают.

## Проверка

```typescript
// examples/app-with-http/src/app.spec.ts
it('доставляет ключ идемпотентности команды до сервиса в глубине', async () => {
  const spy = spyLogger();
  await using testApp = await assembleTest(app, {
    ...testConfig,
    overrides: [
      [UsersRepository$, inMemoryUsersRepo()],
      [RootLogger$, spy.logger],
    ],
  });

  unwrap(await createUser(testApp, 'signed'));

  // `emit` завершается по доставке, а не по обработке
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Ключом вызывающий задал id пользователя, и журнал получил его
  const recorded = spy.entries.find(
    (entry) => entry.message === 'signup recorded',
  );
  expect(recorded?.fields).toEqual({
    scope: 'SignupJournal',
    userId: expect.any(String),
    intent: recorded?.fields.userId,
  });
});
```

Тест создаёт пользователя через полный пайплайн и находит запись
журнала по её `message`. Пауза в один тик нужна, потому что `emit`
завершается по доставке, а обработчик команды выполняется после неё.
Поле `intent` записи совпадает с `userId`: значение, которое задал
вызывающий, дошло до сервиса в глубине графа без параметра.

О новом пользователе хочет знать не только сосед по процессу, но и
клиент в браузере: [14. Живая лента для клиента](./14-live-feed.md).
