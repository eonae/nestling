# @nestlingjs/outbox

Транзакционный emit: событие записывается в базу той же транзакцией, что и
бизнес-изменение, и уходит в шину после коммита. Транзакцию открывает и
закрывает приложение — пакет её не создаёт, не коммитит и не откатывает.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/operations.md`](../../docs/design/operations.md),
> раздел «Транзакционный emit».
> Гайд: [глава 27. База данных и транзакция](../../docs/guide/27-database-and-transaction.md).

## Установка

```bash
npm install @nestlingjs/outbox
```

Хранилище пакет не выбирает: адаптер `OutboxStore` приходит извне.
Для PostgreSQL его отдаёт `@nestlingjs/drizzle.pg/outbox`, для тестов
есть `InMemoryOutboxStore`, для остальных баз адаптер пишет приложение.

## Минимальный пример

```typescript
// Плагин собирается в композиционном корне: переменная транзакции,
// DI-токен хранилища и перечень операций, которые едут через outbox.
export const appOutbox = outbox({
  transaction: Tx,
  store: OutboxStore$,
  operations: [UserCreated],
});

export const app = makeApp({
  features: [UsersFeature],
  plugins: [persistence, appOutbox],
  transports: [http()],
  policies: [appOutbox.requiresTransaction({ pattern: /^(POST|PATCH|DELETE) / })],
});

// В хендлере эмиттер приходит DI-токеном outboxed(UserCreated): строка
// пользователя и строка outbox коммитятся вместе. Раздел записи называет
// место вызова: emit(user, { partitionKey: user.id }).
```

## Экспорты

- **Подключение** — `outbox`, `OutboxOptions`, `OutboxPlugin`, `outboxed`,
  `OutboxEmitter`, `OutboxEmitMeta`, `outboxConfigKeys`,
  `OutboxConfigValues`, `StagingTransaction`,
  `OutboxTransactionMissingError`.
- **Хранилище** — `OutboxStore`, `InMemoryOutboxStore`, `OutboxRecord`,
  `OutboxRecordSnapshot`, `ClaimedRecord`, `OutboxClaimOptions`,
  `OutboxSettlement`.
- **Relay** — `OutboxRelay`, `OutboxRelay$`, `OutboxRelayOptions`,
  `OutboxDrainReport`.
- **Факты жизненного цикла** — `OutboxPublished`, `OutboxStuck`,
  `OutboxPublishedFact`, `OutboxStuckFact`.

`emit` через outbox завершается по факту записи в базу, а не по факту
доставки: публикацию делает relay после коммита.

## Границы пакета

Пакет не открывает транзакцию, не создаёт таблицу и не гарантирует порядок
между партициями. Порядок внутри одной партиции сохраняется.

Готовый адаптер `OutboxStore` для PostgreSQL отдаёт
[`@nestlingjs/drizzle.pg/outbox`](../nestling.drizzle.pg/): он пишет
транзакцией вызывающего и приносит с собой и таблицу записей, и её DDL.

Доставка получается at-least-once: relay может упасть между публикацией и
отметкой, и тогда подписчик получит событие второй раз. Вторую половину
гарантии даёт [`@nestlingjs/inbox`](../nestling.inbox/) — слой, который
отмечает сообщение обработанным транзакцией подписчика и не пускает повтор
в хендлер.
