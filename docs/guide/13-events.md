# 13. Оповещать соседей о случившемся

> Гайд по текущему API; сверено с кодом `examples.app-with-http` (2026-09-04).
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
// packages/examples.app-with-http/src/operations.ts
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
// packages/examples.app-with-http/src/features/quotas/quotas.feature.ts
export const UserRegisteredInQuotas = implement(UserRegistered, {
  subscriber: 'quotas',
  handler: {
    deps: [Logger$],
    handle: (logger: Logger) => async (payload: UserRegisteredInput) => {
      logger.log(`quota bookkeeping: user ${payload.id} (${payload.email})`);

      // eslint-disable-next-line unicorn/no-useless-undefined
      return undefined;
    },
  },
});
```

Подписчик — та же декларация `implement`, что у запроса, с одним
отличием: поле `subscriber` обязательно у реализации события и
запрещено у реализации запроса и команды. Оно даёт подписке имя. Внутри
процесса паттерн endpoint'а складывается как `users.registered@quotas`,
и два подписчика одного события различаются именами; с одинаковым именем
сборка остановится. У брокера имя становится именем группы получателей,
поэтому его задаёт автор, а не фреймворк.

Хендлер события ничего не возвращает. Сигнатура хендлера в ядре
описывает результат как `Output<undefined>`, поэтому в конце стоит
`return undefined` с отключённым правилом линтера.

Подписчик перечисляется в `endpoints:` фичи рядом с реализацией
запроса; список из [главы 12](./12-features.md) уже содержит его.

## Публикация

```typescript
// packages/examples.app-with-http/src/features/users/endpoints/create-user.endpoint.ts
export const createUserHandler =
  (
    users: UsersRepository,
    quotas: Port<typeof ClaimQuota>,
    registered: Emitter<typeof UserRegistered>,
    signup: Emitter<typeof SignupRecorded>,
    activity: ActivityHub,
  ) =>
  async (
    payload: CreateUserInput,
  ): Output<User, typeof EmailTaken | typeof QuotaExceeded> => {
    // …
    const user = await users.insert({
      name: payload.name,
      email: payload.email,
    });

    // Событие: `emit` завершается по факту доставки, отказ подписчика
    // сюда не приходит
    await registered.emit({ id: user.id, email: user.email });
    // …
  };

export const CreateUser = httpEndpoint({
  operation: CreateUserOperation,
  pipeline: authed,
  handler: {
    deps: [
      UsersRepository$,
      ClaimQuota.caller,
      UserRegistered.emitter,
      SignupRecorded.emitter,
      ActivityHub,
    ],
    handle: createUserHandler,
  },
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
// packages/examples.app-with-http/src/operations.ts
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
// packages/examples.app-with-http/src/features/users/endpoints/create-user.endpoint.ts
    // Команда: ключ идемпотентности задаёт вызывающий, чтобы повтор после
    // сбоя нёс тот же ключ. Без ключа порт сгенерировал бы новый
    await signup.emit(
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
// packages/examples.app-with-http/src/features/quotas/quotas.feature.ts
export const SignupRecordedImpl = implement(SignupRecorded, {
  pipeline: makePipeline().pre(withIdempotencyKey()),
  handler: {
    deps: [SignupJournal],
    handle: (journal: SignupJournal) => async (payload: SignupRecordedInput) => {
      journal.record(payload.userId);

      // eslint-disable-next-line unicorn/no-useless-undefined
      return undefined;
    },
  },
});
```

```typescript
// packages/examples.app-with-http/src/features/quotas/signup.journal.ts
@Injectable([Logger$, Ctx(IdempotencyKey)])
export class SignupJournal {
  constructor(
    private readonly logger: Logger,
    private readonly intent: CtxReader<string>,
  ) {}

  /** Записывает регистрацию вместе с ключом идемпотентности */
  record(userId: string): void {
    this.logger.debug(`signup ${userId} recorded, intent ${this.intent.get()}`);
  }
}
```

`withIdempotencyKey()` — готовый pre-юнит из `@nestling/ports`: он
берёт ключ из параметров вызова и объявляет переменную контекста
`IdempotencyKey`. Журнал читает её через `Ctx(IdempotencyKey)` так же,
как хранилище читало `RequestId` в [главе 8](./08-logging.md).
Дедупликацию по ключу пример не делает: ядро доставляет ключ до
обработчика, а что с ним делать, решает владелец команды.

Что юнит стоит в пайплайне реализации, проверяет политика:

```typescript
// packages/examples.app-with-http/src/app.ts
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
API_TOKEN=secret WEBHOOK_SECRET=hook LOG_LEVEL=debug \
  yarn workspace examples.app-with-http start:dev
curl -X POST localhost:3000/users \
  -H 'authorization: Bearer secret' -H 'content-type: application/json' \
  -d '{"name":"User 1","email":"user1@example.com"}'
```

```
[app-with-http] [b7600481-…] insert user1@example.com
[app-with-http] quota bookkeeping: user 3 (user1@example.com)
[app-with-http] signup 3 recorded, intent 3
[app-with-http] [b7600481-…] POST /users CREATED (completed)
```

Вторую строку пишет подписчик события, третью пишет журнал: ключом
пришёл идентификатор пользователя. Подписчик и журнал работают в
собственном контексте запроса: значения контекста вызывающего, включая
`requestId`, в реализацию не попадают.

## Проверка

```typescript
// packages/examples.app-with-http/src/app.spec.ts
it('доставляет ключ идемпотентности команды до сервиса в глубине', async () => {
  const spy = spyLogger();
  await using testApp = await assembleTest(app, {
    ...testConfig,
    overrides: [
      [UsersRepository$, inMemoryUsersRepo()],
      [Logger$, spy.logger],
    ],
  });

  unwrap(await createUser(app, 'signed'));

  // `emit` завершается по доставке, а не по обработке
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Ключом вызывающий задал id пользователя, и журнал получил его
  expect(spy.lines).toContainEqual(
    expect.stringMatching(/^signup (\d+) recorded, intent \1$/),
  );
});
```

Тест создаёт пользователя через полный пайплайн и читает строку
журнала. Пауза в один тик нужна, потому что `emit` завершается по
доставке, а обработчик команды выполняется после неё. Ключ в строке
совпадает с идентификатором пользователя: значение, которое задал
вызывающий, дошло до сервиса в глубине графа без параметра.

О новом пользователе хочет знать не только сосед по процессу, но и
клиент в браузере: [14. Живая лента для клиента](./14-live-feed.md).
