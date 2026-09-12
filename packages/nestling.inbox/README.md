# @nestlingjs/inbox

Транзакционный приём: отметка «обработано» коммитится той же транзакцией,
что и бизнес-изменение, и повтор доставки не доходит до хендлера.
Транзакцию открывает и закрывает приложение — пакет её не создаёт, не
коммитит и не откатывает.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/operations.md`](../../docs/design/operations.md),
> раздел «Транзакционный приём».
> Гайд: [глава 27. База данных и транзакция](../../docs/guide/27-database-and-transaction.md).

## Установка

```bash
npm install @nestlingjs/inbox
```

Хранилище пакет не выбирает: адаптер `InboxStore` приходит извне. Для
PostgreSQL его отдаёт `@nestlingjs/drizzle.pg/inbox`, для тестов есть
`InMemoryInboxStore`, для остальных баз адаптер пишет приложение.

Пакет — вторая половина гарантии доставки. Первую даёт
[`@nestlingjs/outbox`](../nestling.outbox/): он не теряет событие, а этот
не даёт обработать его дважды.

## Минимальный пример

```typescript
// Плагин собирается там же, где соединение: его поле `layer` нужно
// декларации подписчика.
export const appInbox = inbox({ transaction: db.tx, store: inboxStore.token });

// Слой приёма композируется внутрь слоя транзакции: отметка и записи
// хендлера коммитятся вместе.
export const WelcomeEmail = implement(UserCreated, {
  subscriber: 'welcome-email',
  pipeline: compose(db.transaction(), appInbox.layer),
  handler: WelcomeEmailHandler,
});

export const app = makeApp({
  features: [UsersFeature],
  plugins: [db, inboxStore, appInbox],
  transports: [http()],
  // Предпосылка проверяется на фазе ASSEMBLE: подписчик без слоя роняет
  // сборку до открытия сокета
  policies: [appInbox.requiresInbox({ transport: BusTransport$ }, 'inbox')],
});
```

## Экспорты

- **Подключение** — `inbox`, `InboxOptions`, `InboxPlugin`, `InboxLayer`,
  `inboxConfigKeys`, `InboxConfigValues`, `InboxClaimUnit`,
  `readIdempotencyKey`, `InboxKeyMissingError`.
- **Хранилище** — `InboxStore`, `InMemoryInboxStore`, `InboxMark`,
  `InboxClaim`, `InboxSweepOptions`, `RollbackAwareTransaction`.
- **Уборщик отметок** — `InboxSweeper`, `InboxSweeper$`,
  `InboxSweeperOptions`.

Отметка хранится по паре «паттерн endpoint'а и ключ идемпотентности».
Одно событие уходит нескольким подписчикам с одним ключом, и каждый
дедуплицирует его отдельно.

Секция конфигурации читает `INBOX_RETENTION_MS`, `INBOX_SWEEP_INTERVAL_MS`,
`INBOX_BATCH_SIZE` и `INBOX_SWEEP`. Срок хранения обязан перекрывать окно
повторов брокера: удалённая отметка перестаёт узнавать повтор, и
последняя попытка доставки дойдёт до хендлера второй раз.

## Границы пакета

Пакет не открывает транзакцию, не создаёт таблицу и не чеканит ключ
идемпотентности: сообщение без ключа в конверте завершается ошибкой.
Отчеканенный ключ различался бы у двух доставок одного сообщения и всегда
выглядел бы новым.

Exactly-once для эффекта вне транзакции пакет не даёт. Письмо, отправленное
хендлером до коммита отметки, уйдёт второй раз, если процесс упал между
отправкой и коммитом. Окно повтора сужается до этого промежутка, и это всё,
что можно обещать без распределённой транзакции с почтовым сервисом.

Готовый адаптер `InboxStore` для PostgreSQL отдаёт
[`@nestlingjs/drizzle.pg/inbox`](../nestling.drizzle.pg/): он ставит
отметку транзакцией вызывающего и приносит с собой и таблицу отметок, и её
DDL.
