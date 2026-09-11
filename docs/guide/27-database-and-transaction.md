# 27. База данных и транзакция

> Гайд по текущему API; сверено с кодом `users-service` (2026-09-11).
> Целевое описание: [design/persistence.md](../design/persistence.md).
> Почему так: запись [ideas.md](../decisions/ideas.md) «[2026-09-11]
> Соединение с базой: сателлит `drizzle.pg`».

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
эмиттеру. Её приносит пакет `@nestlingjs/drizzle.pg`: он же везёт
соединение с PostgreSQL и адаптер хранилища outbox'а. Три вещи в одном
пакете не по удобству, а по необходимости: адаптер и транзакция обязаны
жить на одном соединении.

## Соединение объявляется значением

```typescript
// examples/users-service/src/persistence.ts
export const db = drizzlePg({ schema });
```

Один вызов создаёт пять вещей: DI-токен соединения, переменную контекста
транзакции, конструктор слоя, политику предпосылки и дескриптор ключей
конфига. Все пять несут тип схемы, поэтому обращение к таблице чужой
схемы — ошибка компиляции.

Схема — обычное объявление drizzle. Таблица записей outbox'а приходит из
пакета, поэтому её миграция генерируется вместе с миграциями приложения:

```typescript
// examples/users-service/src/schema.ts
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  avatarUrl: text('avatar_url'),
});

export const outbox = outboxTable();

export const schema = { users, outbox };
```

Соединение — плагин, поэтому в корне оно стоит в `plugins:`, а не в
`providers:` фичи. Причина та же, что и у хранилища outbox'а: проверка
границы фич из [главы 13](./13-features.md) не даёт инфраструктуре
зависеть от DI-токена фичи, а фоновая задача пакета инжектит хранилище.

Секцию конфига объявляет пакет. Соединение по умолчанию читает
`DATABASE_URL`, `DATABASE_POOL_MAX` и остальные ключи без вставки имени;
второе соединение объявлялось бы вторым вызовом с полем `name` и читало
бы `DATABASE_ANALYTICS_URL`. Адрес помечен секретом, поэтому в лог
подключения уходит только хост.

Пул открывается на фазе INIT и закрывается на SHUTDOWN, а проба
соединения попадает в `/readyz` под именем `database`. Недоступная база
останавливает старт сообщением, которое называет и имя соединения, и
ключ конфига с адресом.

## Транзакция открывается пайплайном

Привычная идиома `db.transaction(async (tx) => { … })` здесь не
подходит. Транзакция в ней живёт только внутри колбэка, а значит и
репозиторий, и эмиттер обязаны получить её параметром — от хендлера,
который о транзакциях знать не должен. Снаружи колбэка транзакции нет
вовсе.

Поэтому транзакция — переменная контекста запроса, а кладёт её слой
пайплайна:

```typescript
// examples/users-service/src/persistence.ts
export const transactional = compose(authed, db.transaction());
```

Внутри слоя четыре юнита. Первый берёт соединение из контейнера и шлёт
`BEGIN` на клиенте, выданном пулом. Второй кладёт в контекст экземпляр
drizzle, привязанный к этой транзакции. `.ok` коммитит, `.catch`
откатывает, а `.finally` возвращает клиента в пул — на любом исходе,
включая обрыв связи с клиентом и остановку приложения.

Первый юнит — класс, и это не случайность: `Var.provide(compute)`
принимает функцию от контекста и зависимостей из контейнера не получает,
а соединение приходит именно оттуда. Раньше такой мост писало
приложение ([глава 26](./26-extending.md)); теперь он объявлен внутри
`drizzlePg` рядом с DI-токеном соединения и наружу не виден.

Ключ переменной выводится из имени соединения: `tx` у соединения по
умолчанию, `analyticsTx` у экземпляра с именем `analytics`. Поэтому два
соединения в одном запросе не спорят за поле контекста, а конфликт
ключей поймал бы компилятор в точке композиции.

Уровень изоляции задаётся аргументом: `db.transaction({ isolation:
'serializable' })` открывает транзакцию командой с этим уровнем.

## Репозиторий читает транзакцию из контекста

Читающий метод берёт соединение из пула, изменяющий — транзакцию
запроса:

```typescript
// examples/users-service/src/users/users.repository.ts
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

    const [row] = await this.connection.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return row ? toUser(row) : null;
  }

  async insert(data: Omit<User, 'id'>): Promise<User> {
    // Запись идёт транзакцией запроса: откат её не сохранит
    const [row] = await this.tx
      .get()
      .insert(users)
      .values({ id: crypto.randomUUID(), ...data, avatarUrl: null })
      .returning();

    return toUser(row);
  }
}
```

Это тот же приём, что и с `Ctx(RequestId)` из
[главы 9](./09-logging.md): значение приходит из контекста запроса, а не
параметром через всю цепочку вызовов. Разница в методе чтения. `peek()`
у `requestId` допускает отсутствие значения: тот же метод может быть
вызван из фоновой задачи. `get()` у транзакции его не допускает: запись
без транзакции — дефект, и она должна упасть, а не пройти незаметно.

Значение переменной — сам экземпляр drizzle, а не обёртка с методами
`commit` и `rollback`. Обёртка дала бы репозиторию право закоммитить, а
это решение слоя.

## Событие в ту же транзакцию

Хранилище outbox'а объявляется на том же соединении, а пакет
`@nestlingjs/outbox` получает переменную транзакции и DI-токен
хранилища:

```typescript
// examples/users-service/src/persistence.ts
export const outboxStore = pgOutboxStore(db);

// examples/users-service/src/app.ts
export const appOutbox = outbox({
  transaction: db.tx,
  store: outboxStore.token,
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
Меняется, что делает `emit`: он пишет одну строку в таблицу записей
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

Запись без транзакции упала бы на первом запросе в проде — недопустимый
режим отказа для фреймворка, который проверяет инварианты до старта.
Соединение отдаёт политику значением, а корень называет, каких
endpoint'ов она касается:

```typescript
// examples/users-service/src/app.ts
policies: [
  everyEndpoint({ pattern: /^(POST|PATCH|DELETE) / }).hasLayer(authed, 'authed'),
  db.requiresTransaction({ pattern: /^(POST|PATCH|DELETE) / }),
  // …
],
```

Предикат тот же `hasVar` из [главы 10](./10-auth.md), только переменную
называет соединение. Endpoint, меняющий данные и не композированный от
слоя транзакции, останавливает сборку на фазе ASSEMBLE — до открытия
сокета и до первого запроса. Ту же политику под той же переменной
отдаёт и плагин outbox'а: предпосылка у них одна.

## Схема накатывается вне процесса

Миграции ведёт drizzle-kit, и приложение их не накатывает: процесс,
который мигрирует себя сам при старте, требует блокировки между
репликами.

```bash
yarn workspace @examples/users-service db:up       # PostgreSQL в docker
yarn workspace @examples/users-service db:generate # миграция из схемы
yarn workspace @examples/users-service db:migrate  # накатить

TEST_DATABASE_URL=postgresql://users:users@localhost:5432/users yarn verify
```

`db:generate` читает `src/schema.ts` и пишет файл в `drizzle/`. Таблица
записей outbox'а попадает туда вместе с таблицей пользователей, потому
что обе стоят в одной схеме. Приложению, которое ведёт миграции своими
средствами, пакет отдаёт готовую строку DDL — `outboxDdl()`.

## Кто отправляет запись

Записи разбирает relay — фоновая задача пакета outbox'а. Он публикует
запись в шину с ключом идемпотентности, равным идентификатору записи, и
отмечает её отправленной. Ключ нужен потому, что доставка получается
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

Выдачу партии адаптер делает одним запросом с пропуском заблокированных
строк, поэтому две реплики relay, читающие одну таблицу, не получат одну
запись. Запись с разделом не выдаётся, пока предыдущая запись того же
раздела не отмечена опубликованной или застрявшей.

Relay объявлен ресурсом, а не компонентом. Фаза SHUTDOWN взводит сигнал
и освобождает ресурсы в обратном топологическом порядке, а завершения
фоновой задачи компонента не ждёт никто. Ресурс же дописывает текущую
партию в `release()`, и соединение закрывается после него, потому что
relay от него зависит.

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
  await seed(testApp);

  await testApp.call(
    CreateUser,
    { name: 'Carol', email: 'carol@example.com' },
    { attributes: { authorization: 'Bearer test-token' } },
  );

  // Во время запроса в шину не ушло ничего: запись легла в таблицу
  expect(spy.entries).not.toContainEqual(
    expect.objectContaining({ message: 'welcome email sent' }),
  );

  const relay = testApp.get(OutboxRelay$);
  expect(await relay?.drain()).toMatchObject({ claimed: 1, published: 1 });
});
```

Тесту нужна настоящая база: пул открывается на фазе INIT, а слой и
адаптер пишут SQL. Адрес приходит переменной `TEST_DATABASE_URL`, и без
неё спеки приложения пропускаются — `yarn verify` на машине без базы
остаётся зелёным, а CI поднимает PostgreSQL сервисом. Имя у переменной
своё, а не `DATABASE_URL`: прогон тестов не должен зависеть от того, что
лежит в окружении под именем боевого ключа. Засев `seed(testApp)` берёт
соединение из собранного графа: это то же соединение, которым работают
endpoint'ы.

Откат проверяется тем же способом: запрос с неверным Bearer-токеном получает
отказ, слой откатывает транзакцию, и следующий `drain()` не находит
ни одной записи.

## Что настраивается

Секция `database` задаёт адрес, размер пула, таймауты подключения и
простоя, потолок времени запроса и признак TLS. Потолок ставится на
время транзакции: долгий хендлер держит соединение пула, и остальные
запросы ждут его.

Секция `outbox` задаёт интервал опроса, размер партии, backoff, число
попыток до отметки «застряла» и признак «relay работает в этом
процессе». Последний нужен в split-развёртывании
([глава 18](./18-split.md)): записи создают все процессы, а разбирает их
один — две реплики relay конкурировали бы за одну таблицу.

```bash
DATABASE_POOL_MAX=5 OUTBOX_RELAY=false OUTBOX_POLL_INTERVAL_MS=200 \
  yarn workspace @examples/users-service start:dev
```

Задержку доставки видно операцией `outbox.published`: разница между
`publishedAt` и `createdAt` и есть цена за то, что событие переживает
падение процесса. Запись, у которой кончились попытки, публикует
`outbox.stuck` — это точка вмешательства, а не самопочинки. Подписчиков
у обеих операций может не быть: приложение без них собирается и
работает.

## Что осталось за кадром

Слой транзакции не применяется к потоковому ответу: юнит `.ok`
выполняется в начале ответной фазы, поэтому у форм вывода `stream` и
`events` коммит прошёл бы раньше, чем хендлер дочитал курсор.

Одной транзакции на два соединения не бывает: двухфазного коммита пакет
не делает, и согласованность между базами держится теми же событиями и
outbox'ом. Диалект пока один — PostgreSQL: выдача сессии у каждого
драйвера своя.

Саг пакет не делает: корреляция и состояние процесса — отдельная тема.
Дедупликацию на приёме тоже: ключ доставляется, а решение остаётся за
обработчиком.

Как такой пакет устроен изнутри и почему он не потребовал ни строчки в
ядре — [глава 26](./26-extending.md).
