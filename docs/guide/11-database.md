# 11. Писать в базу транзакцией запроса

> Гайд по текущему API; сверено с кодом `users-service` (2026-09-12).
> Целевое описание: [design/persistence.md](../design/persistence.md).
> Почему так: запись [ideas.md](../decisions/ideas.md) «[2026-09-11]
> Соединение с базой: сателлит `drizzle.pg`».

Репозиторий из [главы 6](./06-repository.md) держит пользователей в
памяти: процесс перезапустился — данных нет. Сервису нужна настоящая
база, а вместе с ней требование, которого у хранилища в памяти не было.
Запрос меняет несколько строк, и меняет он их либо целиком, либо никак.

Открывать транзакцию в хендлере не выход. Тогда каждый хендлер помнит
про коммит и откат, а забытый откат находится в проде. Транзакцию должен
открывать тот, кто и так обрамляет запрос, — пайплайн, а хендлер должен
получать репозиторий, который уже пишет в неё.

Всё это везёт один пакет — `@nestlingjs/drizzle.pg`: соединение с
PostgreSQL, переменную транзакции и слой, который её открывает.

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
пакета, поэтому её миграция генерируется вместе с миграциями приложения;
зачем эта таблица нужна, показывает [глава 16](./16-durable-events.md):

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
`providers:` фичи. Причина в проверке границы фич из
[главы 14](./14-features.md): она не даёт инфраструктуре зависеть от
DI-токена фичи, а фоновым задачам пакета нужно хранилище.

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

Первый юнит — класс, потому что кладёт в контекст не значение
переменной, а сессию: её читают и `.ok`, и `.catch`, и `.finally`, а
соединение, которое её выдаёт, приходит из контейнера. Раньше такой мост
писало приложение ([рецепт «Расширить ядро своим
пакетом»](../recipes/extending.md)); теперь он объявлен внутри
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

Endpoint, который меняет данные, композируется от слоя транзакции:

```typescript
// examples/users-service/src/users/endpoints/create-user.endpoint.ts
export const CreateUser = httpEndpoint.implement(CreateUserOperation, {
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
сокета и до первого запроса.

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

## Что настраивается

Секция `database` задаёт адрес, размер пула, таймауты подключения и
простоя, потолок времени запроса и признак TLS. Потолок ставится на
время транзакции: долгий хендлер держит соединение пула, и остальные
запросы ждут его.

```bash
DATABASE_POOL_MAX=5 yarn workspace @examples/users-service start:dev
```

## Проверка

```typescript
// examples/users-service/src/app.spec.ts
it('создаёт пользователя по Bearer-токену из конфига', async () => {
  await using testApp = await assembleTest(app, {
    config: testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });
  await seed(testApp);

  const created = await testApp.call(
    CreateUser,
    { name: 'Carol', email: 'carol@example.com' },
    { attributes: { authorization: 'Bearer test-token' } },
  );

  expect(created).toMatchObject({
    isSuccess: true,
    status: 'created',
    value: { name: 'Carol' },
  });
});
```

Тесту нужна настоящая база: пул открывается на фазе INIT, а слой пишет
SQL. Адрес приходит переменной `TEST_DATABASE_URL`, и без неё спеки
приложения пропускаются — `yarn verify` на машине без базы остаётся
зелёным, а CI поднимает PostgreSQL сервисом. Имя у переменной своё, а не
`DATABASE_URL`: прогон тестов не должен зависеть от того, что лежит в
окружении под именем боевого ключа. Засев `seed(testApp)` берёт
соединение из собранного графа: это то же соединение, которым работают
endpoint'ы.

Откат проверяется тем же способом: запрос с неверным Bearer-токеном
получает отказ, слой откатывает транзакцию, и записей этого запроса в
базе не остаётся.

## Что осталось за кадром

Слой транзакции не применяется к потоковому ответу: юнит `.ok`
выполняется в начале ответной фазы, поэтому у форм вывода `stream` и
`events` коммит прошёл бы раньше, чем хендлер дочитал курсор.

Одной транзакции на два соединения не бывает: двухфазного коммита пакет
не делает, и согласованность между базами держится событиями и outbox'ом
([глава 16](./16-durable-events.md)). Диалект пока один — PostgreSQL:
выдача сессии у каждого драйвера своя.

Выгрузка, которая не помещается в память, и приём файла формой —
[глава 12](./12-files-and-streams.md).
