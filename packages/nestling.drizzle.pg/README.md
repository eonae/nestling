# @nestlingjs/drizzle.pg

Соединение с PostgreSQL, транзакция запроса переменной контекста и
адаптеры `OutboxStore` и `InboxStore` поверх drizzle-orm. Соединение
объявляется
значением: `drizzlePg({ schema })` отдаёт плагин с DI-токеном соединения,
переменной транзакции, слоем пайплайна и политикой предпосылки.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/persistence.md`](../../docs/design/persistence.md).
> Гайд: [глава 27. База данных и транзакция](../../docs/guide/27-database-and-transaction.md).

## Установка

```bash
npm install @nestlingjs/drizzle.pg drizzle-orm pg
```

`drizzle-orm` и `pg` — peer-зависимости: версию драйвера выбирает
приложение, и двух копий драйвера в процессе быть не должно. Адаптеры
хранилищ живут в подпутях `./outbox` и `./inbox`, а `@nestlingjs/outbox` и
`@nestlingjs/inbox` для них — необязательные peer-зависимости: приложение
без них ставит пакет и о хранилищах не знает.

Схему накатывает drizzle-kit вне процесса приложения: миграция при старте
требует блокировки между репликами.

Тесты пакета, которым нужна работающая база, читают её адрес из
`TEST_DATABASE_URL` и без неё пропускаются. База для них поднимается
рядом, на своём порту, и схемы не требует — таблицы тесты создают сами:

```bash
yarn db:up
TEST_DATABASE_URL=postgresql://nestling:nestling@localhost:55432/nestling yarn test
```

## Минимальный пример

```typescript
// Соединение — значение: DI-токен, переменная транзакции, слой и
// политика создаются одним вызовом и несут тип схемы.
export const db = drizzlePg({ schema });

// Слой транзакции композируется в пайплайн endpoint'а. `BEGIN` уходит до
// хендлера, `COMMIT` — после него, соединение возвращается в пул всегда.
export const transactional = compose(authed, db.transaction());

export const app = makeApp({
  features: [UsersFeature],
  plugins: [db, pgOutboxStore(db)],
  transports: [http()],
  policies: [db.requiresTransaction({ pattern: /^(POST|PATCH|DELETE) / })],
});

// В репозитории: чтение — соединением из пула, запись — транзакцией
// запроса. `Ctx(db.tx)` отдаёт экземпляр drizzle, привязанный к ней.
@Component([db.connection, Ctx(db.tx)])
export class DbUsersRepository {
  constructor(
    private readonly connection: PgConnection<typeof schema>,
    private readonly tx: CtxReader<PgTx<typeof schema>>,
  ) {}
}
```

## Экспорты

- **Соединение** — `drizzlePg`, `DrizzlePgOptions`, `DrizzlePgPlugin`,
  `PgConnection`, `PgSchema`, `databaseConfigKeys`,
  `DatabaseConfigValues`, `PgConnectionFailedError`,
  `PgDuplicateConnectionError`.
- **Транзакция запроса** — `PgSession`, `PgTx`, `BeginOptions`,
  `IsolationLevel`, `TxLayer`, `TxLayerInput`, `TxBridgeClass`.
- **Подпуть `./outbox`** — `pgOutboxStore`, `PgOutboxStorePlugin`,
  `PgOutboxStoreOptions`, `PgOutboxStore`, `PgOutboxTransactionError`, а
  также всё из группы ниже.
- **Подпуть `./outbox/table`** — `outboxTable`, `OutboxTable`,
  `outboxDdl`, `DEFAULT_OUTBOX_TABLE`. Отдельный подпуть нужен
  drizzle-kit: он собирает схему как CJS, и из пакета ему годится только
  то, что не тянет за собой ядро.
- **Подпуть `./inbox`** — `pgInboxStore`, `PgInboxStorePlugin`,
  `PgInboxStoreOptions`, `PgInboxStore`, `PgInboxTransactionError`, а
  также всё из группы ниже.
- **Подпуть `./inbox/table`** — `inboxTable`, `InboxTable`, `inboxDdl`,
  `DEFAULT_INBOX_TABLE`. Отдельный подпуть нужен по той же причине, что у
  таблицы outbox'а.

Секция конфига соединения по умолчанию читает `DATABASE_URL`,
`DATABASE_POOL_MAX` и остальные ключи без вставки имени; экземпляр с
именем `analytics` — `DATABASE_ANALYTICS_URL`. Адрес помечен секретом:
печать секции и текст ошибки показывают маску, а лог подключения пишет
хост.

## Границы пакета

Пакет не мигрирует схему, не даёт своего query builder'а и не открывает
одну транзакцию на два соединения: согласованность между базами держится
событиями и outbox'ом. Другие диалекты в V1 не поддерживаются — выдача
сессии у каждого драйвера своя.

Слой транзакции не применяется к потоковому ответу: юнит `.ok`
выполняется в начале ответной фазы, поэтому у форм вывода `stream` и
`events` коммит прошёл бы раньше, чем хендлер дочитал курсор.

Долгая транзакция держит соединение пула. Соединений столько, сколько
задано `DATABASE_POOL_MAX`, поэтому потолок времени запроса задаётся
ключом `DATABASE_STATEMENT_TIMEOUT_MS` и ставится на время транзакции.
