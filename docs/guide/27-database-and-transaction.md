# 27. База данных и транзакция

> Гайд по текущему API; сверено с кодом `users-service` (2026-09-09).
> Целевое описание: [design/operations.md](../design/operations.md),
> раздел «Транзакционный emit». Почему так: запись
> [ideas.md](../decisions/ideas.md) «[2026-09-07] Транзакционный outbox:
> точка врезки и результат замера границы».

Сервис создаёт пользователя и оповещает об этом соседей событием.
Запись в базу и отправка события — две разные операции, и между ними
есть окно: процесс упал после коммита, но до отправки, и событие
потеряно навсегда. Соседи о пользователе не узнают, а восстановить
пропажу нечем — в базе не осталось следа, что событие полагалось.

Починка старая и называется transactional outbox: событие пишется в ту
же базу той же транзакцией, что и бизнес-изменение, а отправляет его
фоновая задача — после коммита. Тогда «пользователь создан» и «событие
надо отправить» либо случаются вместе, либо не случаются вовсе.

Всё, что для этого нужно, — транзакция, доступная и репозиторию, и
эмиттеру. Эта глава сначала открывает транзакцию пайплайном, а потом
подключает `@nestlingjs/outbox`, который на ней работает.

## Транзакция открывается пайплайном

Привычная идиома `db.transaction(async (tx) => { … })` здесь не
подходит. Транзакция в ней живёт только внутри колбэка, а значит и
репозиторий, и эмиттер обязаны получить её параметром — от хендлера,
который о транзакциях знать не должен. Снаружи колбэка транзакции нет
вовсе.

Поэтому транзакция — переменная контекста запроса. Её объявляет
приложение своим типом:

```typescript
// examples/users-service/src/persistence.ts
export const Tx = contextVar<Transaction>()('tx');
```

Кладёт значение слой пайплайна. Он состоит из двух `.pre`-юнитов, и
первый из них — мост:

```typescript
// examples/users-service/src/persistence.ts
@Handler([Database])
export class ProvideDb {
  constructor(private readonly db: Database) {}

  handle(): { db: Database } {
    return { db: this.db };
  }
}

export const transactional = compose(
  authed,
  makePipeline()
    .pre(ProvideDb)
    .pre(Tx.provide<{ db: Database }>((ctx) => ctx.input.db.begin()))
    .ok((_res, ctx: ExtendableContext<{ tx: Transaction }>) => {
      ctx.input.tx.commit();
    })
    // На дорожке ответа контекст `Partial`: до писателя переменной
    // пайплайн мог и не дойти
    .catch((_res, ctx: ExtendableContext<{ tx?: Transaction }>) => {
      ctx.input.tx?.rollback();
    }),
);
```

Мост нужен потому, что `Tx.provide(compute)` принимает функцию от
контекста и зависимостей из контейнера не получает, а соединение приходит
именно оттуда. Класс-юнит зависимости получает, поэтому он кладёт
соединение в контекст, а писатель переменной уже читает его оттуда.
Требование второго юнита к контексту (`{ db: Database }`) проверяет
компилятор в точке композиции: `transactional` без `ProvideDb` не
соберётся.

`.ok` коммитит, `.catch` откатывает. Оба видят накопленный контекст,
поэтому транзакция им доступна без единого параметра.

## Репозиторий читает транзакцию из контекста

Изменяющий метод пишет транзакцией запроса, а не мимо неё:

```typescript
// examples/users-service/src/users/users.repository.ts
@Component([Database, Logger$.auto, Ctx(RequestId), Ctx(Tx)])
export class DbUsersRepository implements UsersRepository {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    private readonly requestId: CtxReader<string>,
    private readonly tx: CtxReader<Transaction>,
  ) {}

  async insert(data: Omit<User, 'id'>): Promise<User> {
    const user: User = { id: this.db.nextId(), ...data };

    // Запись идёт транзакцией запроса: откат её не выполнит
    this.tx.get().onCommit(() => this.db.users.push(user));

    return user;
  }
}
```

Это тот же приём, что и с `Ctx(RequestId)` из
[главы 9](./09-logging.md): значение приходит из контекста запроса, а не
параметром через всю цепочку вызовов. Разница в методе чтения. `peek()`
у `requestId` допускает отсутствие значения: тот же метод может быть
вызван из фоновой задачи. `get()` у транзакции его не допускает: запись
без транзакции — дефект, и она должна упасть, а не пройти незаметно.

В примере база — таблица в памяти, и транзакция откладывает записи до
коммита. Настоящий драйвер показал бы свою запись читателю внутри той же
транзакции; здесь запись становится видимой после коммита.

## Соединение — инфраструктура, а не часть фичи

Соединение переезжает из `providers:` фичи в плагин:

```typescript
// examples/users-service/src/persistence.ts
export const OutboxStore$ = makeToken<OutboxStore>('OutboxStore');

export const persistence: Plugin = makePlugin({
  name: 'persistence',
  providers: [
    Database,
    ProvideDb,
    {
      provide: OutboxStore$,
      useFactory: (db: Database) => db.outbox,
      deps: [Database],
    },
  ],
});
```

Причина не в аккуратности, а в проверке границы фич из
[главы 13](./13-features.md). Хранилище outbox'а инжектит фоновая задача
пакета, а она живёт в плагине. Плагин, зависящий от DI-токена фичи,
роняет сборку: инфраструктура, которая знает о бизнес-логике, не
переиспользуется и перестаёт собираться, как только фичу не выбрали.
Соединение с базой бизнес-логикой и не является.

## Событие в ту же транзакцию

Пакет `@nestlingjs/outbox` подключается плагином и получает три вещи:
переменную транзакции, DI-токен хранилища и список операций.

```typescript
// examples/users-service/src/app.ts
export const appOutbox = outbox({
  transaction: Tx,
  store: OutboxStore$,
  operations: [UserCreated],
  partitionKey: (payload) => (payload as { id: string }).id,
});
```

Список операций явный: рецепту нужна сама операция — схема входа, чтобы
проверить payload, и имя, чтобы знать subject. `partitionKey` называет
единицу порядка: события одного пользователя доставляются в порядке
создания, между разными пользователями порядка нет.

В хендлере меняется одна строка — та, что называет зависимость:

```typescript
// examples/users-service/src/users/endpoints/create-user.endpoint.ts
@Handler([UsersRepository$, outboxed(UserCreated)])
export class CreateUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly userCreated: Emitter<typeof UserCreated>,
  ) {}

  async handle(input: CreateUserInput): Output<User, typeof EmailTaken> {
    // …
    const user = await this.users.insert(data);

    // Запись пользователя и запись события — одна транзакция. Упади
    // процесс сразу после коммита, событие всё равно доедет
    await this.userCreated.emit({
      id: user.id,
      name: user.name,
      email: user.email,
    });

    return Ok.created(user);
  }
}
```

`outboxed(UserCreated)` вместо `UserCreated.emitter`. Тип значения тот
же — `Emitter<typeof UserCreated>`, — поэтому тело метода не меняется.
Меняется, что делает `emit`: он пишет одну строку в хранилище
транзакцией вызывающего и в шину во время запроса не отправляет ничего.

DI-токен ядра остаётся на месте: `UserCreated.emitter` по-прежнему
отправляет сразу. Отправка из `@OnStart` или фоновой задачи, где
транзакции нет, пишется именно им. Транзакционный `emit` вне транзакции
не молчит и не отправляет напрямую — он завершается ошибкой, называющей
обе починки.

Endpoint переключается на слой транзакции:

```typescript
// examples/users-service/src/users/endpoints/create-user.endpoint.ts
export const CreateUser = httpEndpoint({
  operation: CreateUserOperation,
  pipeline: transactional,
  handler: CreateUserHandler,
});
```

`transactional` композирован от `authed`, поэтому проверка
Bearer-токена приходит вместе с ним, и endpoint не подключает её
второй раз.

## Предпосылка проверяется на сборке

`emit` без транзакции упадёт на первом запросе в проде — недопустимый
режим отказа для фреймворка, который проверяет инварианты до старта.
Плагин отдаёт политику значением, а корень называет, каких endpoint'ов
она касается:

```typescript
// examples/users-service/src/app.ts
policies: [
  everyEndpoint({ pattern: /^(POST|PATCH|DELETE) / }).hasLayer(authed, 'authed'),
  appOutbox.requiresTransaction({ pattern: /^(POST|PATCH|DELETE) / }),
  // …
],
```

Предикат тот же `hasVar` из [главы 10](./10-auth.md), только переменную
называет плагин. Endpoint, меняющий данные и не композированный от слоя
транзакции, останавливает сборку на фазе ASSEMBLE — до открытия сокета
и до первого запроса.

## Кто отправляет запись

Записи разбирает relay — фоновая задача пакета. Он публикует запись в
шину с ключом идемпотентности, равным идентификатору записи, и отмечает
её отправленной. Ключ нужен потому, что доставка получается
at-least-once: relay может упасть между публикацией и отметкой, и тогда
та же запись публикуется второй раз.

Дедупликация — обязанность подписчика:

```typescript
// examples/users-service/src/users/endpoints/welcome-email.endpoint.ts
export const WelcomeEmail = implement(UserCreated, {
  subscriber: 'welcome-email',
  pipeline: makePipeline().pre(withIdempotencyKey()),
  handler: WelcomeEmailHandler,
});
```

`withIdempotencyKey()` — штатный писатель ядра: он кладёт ключ из
конверта сообщения в контекст, и хендлер читает его как обычное поле
`meta`. У события типизированного `meta.idempotencyKey` нет — ключ есть
у любой публикации на шине, а в типе `meta` его даёт только `command`.

Relay объявлен ресурсом, а не компонентом. Фаза SHUTDOWN взводит сигнал
и освобождает ресурсы в обратном топологическом порядке, а завершения
фоновой задачи компонента не ждёт никто. Ресурс же дописывает текущую
партию в `release()`, и хранилище закрывается после него, потому что
relay от него зависит.

Приложению с outbox'ом нужна шина: relay публикует через неё. Сборка,
в графе которой шины нет, падает на фазе ASSEMBLE с указанием обеих
починок — подключить транспорт шины или убрать плагин.

## Тест не ждёт таймера

Цикл relay разложен на два уровня: `drain()` делает один проход по
партии, а `@OnStart` повторяет его до сигнала. Тестовая сборка
останавливается после фазы WIRE и `@OnStart` не выполняет
([глава 8](./08-testing.md)), поэтому проход делает сам тест:

```typescript
// examples/users-service/src/app.spec.ts
it('кладёт событие в outbox и доставляет его проходом relay', async () => {
  const spy = spyLogger();
  await using testApp = await assembleTest(app, {
    config: testConfig,
    overrides: [[RootLogger$, spy.logger]],
  });

  await testApp.call(
    CreateUser,
    { name: 'Carol', email: 'carol@example.com' },
    { attributes: { authorization: 'Bearer test-token' } },
  );

  // Во время запроса в шину не ушло ничего: запись легла в хранилище
  expect(spy.entries).not.toContainEqual(
    expect.objectContaining({ message: 'welcome email sent' }),
  );

  const relay = testApp.get(OutboxRelay$);
  expect(await relay?.drain()).toMatchObject({ claimed: 1, published: 1 });

  expect(spy.entries).toContainEqual({
    level: 'info',
    message: 'welcome email sent',
    fields: {
      scope: 'WelcomeEmailHandler',
      id: '3',
      email: 'carol@example.com',
    },
  });
});
```

Откат проверяется тем же способом: запрос с неверным Bearer-токеном получает
отказ, слой откатывает транзакцию, и следующий `drain()` не находит
ни одной записи.

## Что настраивается

Секция конфига `outbox` задаёт интервал опроса, размер партии, backoff,
число попыток до отметки «застряла» и признак «relay работает в этом
процессе». Последний нужен в split-развёртывании
([глава 18](./18-split.md)): записи создают все процессы, а разбирает их
один — две реплики relay конкурировали бы за одну таблицу.

```bash
OUTBOX_RELAY=false OUTBOX_POLL_INTERVAL_MS=200 \
  yarn workspace @examples/users-service start:dev
```

Задержку доставки видно операцией `outbox.published`: разница между
`publishedAt` и `createdAt` и есть цена за то, что событие переживает
падение процесса. Запись, у которой кончились попытки, публикует
`outbox.stuck` — это точка вмешательства, а не самопочинки. Подписчиков
у обеих операций может не быть: приложение без них собирается и
работает.

## Что осталось за кадром

Адаптер `OutboxStore` к настоящей базе пишет приложение: адаптер и
транзакция обязаны быть на одном соединении, а пакет, который везёт
соединение, перестал бы быть драйвер-независимым. В примере роль
адаптера играет реализация в памяти из самого пакета.

Саг пакет не делает: корреляция и состояние процесса — отдельная тема.
Дедупликацию на приёме тоже: ключ доставляется, а решение остаётся за
обработчиком.

Как такой пакет устроен изнутри и почему он не потребовал ни строчки в
ядре — [глава 26](./26-extending.md).
