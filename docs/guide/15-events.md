# 15. Оповещать соседей о случившемся

> Гайд по текущему API; сверено с кодом `6717ebad`.
> Целевое описание: [design/operations.md](../design/operations.md),
> разделы «Три вида» и «Профиль вызова». Почему так: записи
> [ideas.md](../decisions/ideas.md) «[2026-07-08] Порты: межфичевое
> общение через контракты» и «[2026-07-31] Порты: бюджет вызова моментом,
> ключ идемпотентности у команд».

Фича рассылки должна узнавать о каждом созданном пользователе, но ответ
клиенту не должен ждать отправки письма. Завтра о том же захочет узнать
аналитика, и код регистрации не должен меняться. Обратное тоже верно:
удалённого пользователя рассылка обязана забыть, получателя у такой
просьбы ровно один, и повторную доставку одного сообщения он должен
отличать от новой просьбы.

```typescript
// src/operations.ts
export const UserRegisteredInput = z.object({
  id: z.string(),
  name: z.string(),
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
файле, что запрос `CheckAddress` из [главы 14](./14-features.md).

```typescript
// src/features/notifications/welcome-email.endpoint.ts
@Handler([Logger$.auto])
class WelcomeEmailHandler {
  constructor(private readonly logger: Logger) {}

  async handle(payload: UserRegisteredInput) {
    this.logger.info('welcome email sent', {
      userId: payload.id,
      email: payload.email,
    });
  }
}

export const WelcomeEmail = implement(UserRegistered, {
  subscriber: 'welcome-email',
  handler: WelcomeEmailHandler,
});
```

Подписчик — та же декларация `implement`, что у запроса, с одним
отличием: поле `subscriber` обязательно у реализации события и
запрещено у реализации запроса и команды. Оно даёт подписке имя. Внутри
процесса паттерн endpoint'а складывается как `users.registered@welcome-email`,
и два подписчика одного события различаются именами; с одинаковым именем
сборка остановится. У брокера имя становится именем группы получателей,
поэтому его задаёт автор, а не фреймворк.

Хендлер события ничего не возвращает. У операции без `output` тип
значения — `void`, поэтому `return` в конце не нужен.

Подписчик перечисляется в `endpoints:` фичи рядом с реализацией
запроса; список из [главы 14](./14-features.md) уже содержит его.

## Публикация

```typescript
// src/features/users/endpoints/create-user.endpoint.ts
@Handler([
  UsersRepository$,
  CheckAddress.caller,
  UserRegistered.emitter,
  ForgetAddress.emitter,
  ActivityHub,
])
export class CreateUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly addresses: Port<typeof CheckAddress>,
    private readonly registered: Emitter<typeof UserRegistered>,
    private readonly forget: Emitter<typeof ForgetAddress>,
    private readonly activity: ActivityHub,
  ) {}

  async handle(
    payload: CreateUserInput,
  ): Output<User, typeof EmailTaken | typeof AddressRejected> {
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

export const CreateUser = httpEndpoint.implement(CreateUserOperation, {
  pipeline: authed,
  handler: CreateUserHandler,
});
```

`UserRegistered.emitter` — DI-токен эмиттера. Хендлер получает объект типа
`Emitter<typeof UserRegistered>` с методом `emit(payload, meta?)`.
`emit` возвращает `Promise<void>`, который завершается, когда сообщение
доставлено, а не когда подписчик его обработал. Отказ или исключение
подписчика к вызывающему не приходят: они попадают в диагностический
хук шины.

Новый подписчик появляется без правок в `create-user`: достаточно ещё
одного `implement(UserRegistered, { subscriber: '…' })` в любой фиче.

## Команда с ключом идемпотентности

Просьбу убрать адрес из рассылок несёт не событие, а команда:

```typescript
// src/operations.ts
export const ForgetAddressInput = z.object({ email: z.string() });

export type ForgetAddressInput = z.infer<typeof ForgetAddressInput>;

export const ForgetAddress = makeCommand({
  name: 'notifications.forget-address',
  input: ForgetAddressInput,
});
```

`makeCommand` объявляет операцию вида `command`: сообщение без ответа,
у которого ровно один владелец. У команды в `meta` есть поле
`idempotencyKey`: тип `meta` выбирается по виду операции, и обращение к
этому полю у запроса не компилируется. У события поле тоже есть, но ключ
ему никто не чеканит: он едет только тогда, когда его передал издатель
([глава 16](./16-durable-events.md)).

```typescript
// src/features/users/endpoints/delete-user.endpoint.ts
    // Команда: ключ идемпотентности задаёт вызывающий, чтобы повтор после
    // сбоя нёс тот же ключ. Без ключа порт сгенерировал бы новый
    await this.forget.emit(
      { email: removed.email },
      { idempotencyKey: removed.id },
    );
```

Ключ идемпотентности — идентичность намерения. Удаление одного
пользователя остаётся одним намерением, даже если процесс упал после
`delete` и повторил `emit`, поэтому ключом взят его идентификатор.
Команда без явного ключа тоже уходит с ключом: его генерирует эмиттер, и
он одинаков для всех повторных доставок одного `emit`.

Владелец команды читает ключ из контекста:

```typescript
// src/features/notifications/forget-address.endpoint.ts
@Handler([Suppressions])
class ForgetAddressHandler {
  constructor(private readonly suppressions: Suppressions) {}

  async handle(payload: ForgetAddressInput) {
    this.suppressions.forget(payload.email);
  }
}

export const ForgetAddressImpl = implement(ForgetAddress, {
  pipeline: makePipeline().pre(withIdempotencyKey()),
  handler: ForgetAddressHandler,
});
```

```typescript
// src/features/notifications/suppressions.ts
@Component([Logger$.auto, Ctx(IdempotencyKey)])
export class Suppressions {
  readonly #blocked = new Map<string, string>();

  constructor(
    private readonly logger: Logger,
    private readonly intent: CtxReader<string>,
  ) {}

  /** Убирает адрес из рассылок вместе с ключом идемпотентности */
  forget(email: string): void {
    this.#blocked.set(email, 'user asked to be forgotten');

    this.logger.debug('address forgotten', {
      email,
      intent: this.intent.get(),
    });
  }
}
```

`withIdempotencyKey()` — готовый pre-шаг из `@nestlingjs/app`: он
берёт ключ из параметров вызова и объявляет переменную контекста
`IdempotencyKey`. Сервис читает её через `Ctx(IdempotencyKey)` так же,
как хранилище читало `RequestId` в [главе 9](./09-logging.md).
Дедупликации по ключу здесь нет: ядро доставляет ключ до обработчика, а
что с ним делать, решает владелец команды.

Что шаг стоит в пайплайне реализации, проверяет политика:

```typescript
// src/app.ts
    // Реализация команды кладёт ключ идемпотентности в контекст: сервис
    // в глубине графа читает его через `Ctx`
    everyEndpoint({
      transport: BusTransport$,
      pattern: /^notifications\.forget-address$/,
    }).hasVar(IdempotencyKey, 'idempotencyKey'),
```

Политики из [главы 10](./10-auth.md) отбирали endpoint'ы HTTP-транспорта.
Здесь фильтр указывает на транспорт шины `BusTransport$` и паттерн
команды, а проверка `hasVar` требует, чтобы пайплайн объявлял
переменную. Без `withIdempotencyKey()` сборка остановится.

## Три вида операций

| Вид | Конструктор | Владельцев | Ответ | `idempotencyKey` в `meta` | `durable` |
|---|---|---|---|---|---|
| запрос | `makeRequest` | ровно один | `Ok` или `Fail` | нет | нет |
| команда | `makeCommand` | ровно один | нет | есть | допустим |
| событие | `makeEvent` | любое число подписчиков | нет | нет | допустим |

Запрос подходит, когда без ответа продолжить нельзя: регистрация ждёт
ответа, дойдёт ли письмо на этот адрес. Событие подходит, когда факт уже
случился и кому он нужен, решают подписчики. Команда подходит, когда получатель
ровно один и повтор доставки нужно отличать от нового намерения.

## Что видно в логе

Запустите сервис с уровнем `debug` и создайте пользователя:

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook NESTLING_LOG_LEVEL=debug \
  yarn start:dev
curl -X POST localhost:3000/users \
  -H 'authorization: Bearer secret' -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"carol@example.com"}'
curl -X DELETE localhost:3000/users/3 -H 'authorization: Bearer secret'
```

```
2026-09-06T12:00:00.000Z DEBUG DbUsersRepository insert carol@example.com requestId=b7600481-…
2026-09-06T12:00:00.001Z INFO  WelcomeEmailHandler welcome email sent userId=3 email=carol@example.com
2026-09-06T12:00:00.002Z INFO  AuditOutcome POST /users created requestId=b7600481-… outcome=completed
2026-09-06T12:00:01.000Z DEBUG Suppressions address forgotten email=carol@example.com intent=3
```

Вторую строку пишет подписчик события, последнюю — владелец команды:
ключом пришёл идентификатор удалённого пользователя. Оба работают в
собственном контексте запроса: значения контекста вызывающего, включая
`requestId`, в реализацию не попадают.

## Проверка

```typescript
// src/app.spec.ts
it('доставляет ключ идемпотентности команды до сервиса в глубине', async () => {
  const spy = spyLogger();
  await using testApp = await buildTest(app, {
    ...testConfig,
    overrides: [
      [UsersRepository$, inMemoryUsersRepo([alice])],
      [RootLogger$, spy.logger],
    ],
  });

  unwrap(await deleteUser(testApp, alice.id));

  // `emit` завершается по доставке, а не по обработке
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Ключом вызывающий задал id пользователя, и владелец команды получил его
  const forgotten = spy.entries.find(
    (entry) => entry.message === 'address forgotten',
  );
  expect(forgotten?.fields).toEqual({
    scope: 'Suppressions',
    email: alice.email,
    intent: alice.id,
  });
});
```

Тест удаляет пользователя через полный пайплайн и находит запись
владельца команды по её `message`. Пауза в один тик нужна, потому что
`emit` завершается по доставке, а обработчик команды выполняется после
неё. Поле `intent` записи совпадает с идентификатором пользователя:
значение, которое задал вызывающий, дошло до сервиса в глубине графа без
параметра.

О новом пользователе хочет знать не только сосед по процессу, но и
клиент в браузере: [17. Живая лента для клиента](./17-live-feed.md).
