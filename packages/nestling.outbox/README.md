# @nestling/outbox

Транзакционный emit: событие записывается в базу той же транзакцией, что
и бизнес-изменение, и уходит в шину после коммита.

> **Предпосылка: транзакцию открывает и закрывает приложение.** Пакет её
> не создаёт, не коммитит и не откатывает. Транзакция обязана
> открываться пайплайном, а не колбэком `db.transaction(cb)`: снаружи
> колбэка транзакции нет, и репозиторий с эмиттером её не прочитают.

> 🚧 Активная разработка, API может меняться. Целевой дизайн:
> [`docs/design/operations.md`](../../docs/design/operations.md), раздел
> «Транзакционный emit». Гайд:
> [глава 27. База данных и транзакция](../../docs/guide/27-database-and-transaction.md).
> Результат замера, ради которого пакет написан:
> [`ideas.md [2026-09-07]`](../../docs/decisions/ideas.md).

Пакет написан целиком на публичных примитивах; ядро о нём не знает.
Зависимости:

| Зависимость | Для чего |
|---|---|
| `@nestling/container` | `makeTokenFamily` и `familyProvider` для `outboxed(Op)`, `resourceProvider`, `@OnStart` |
| `@nestling/app` | `makePlugin`, `Ctx` и переменные контекста, `makeConfig`, `everyEndpoint(...).hasVar`, интерфейс шины `IMessageBus` |
| `@nestling/operations` | `makeEvent` для фактов relay, `Emitter`, `describeForm` и `jsonSchema` |
| `@common/misc` | `validateSync` и типы Standard Schema |

Внешних зависимостей, вендора схем и драйверов базы данных в пакете нет.

## Установка

```bash
npm install @nestling/outbox
```

## Что делает

`emit` через `outboxed(Op)` не отправляет сообщение, а пишет одну запись
в хранилище — транзакцией вызывающего. После коммита запись забирает
relay и публикует её в шину с ключом идемпотентности, равным
идентификатору записи.

DI-токен ядра `Op.emitter` остаётся на месте и работает как прежде.
Транзакционность видна в списке зависимостей хендлера, а не назначается
невидимо на сборке.

## Минимальный пример

Три шага: объявить переменную транзакции, поставить адаптер хранилища,
перечислить операции.

```typescript
// src/persistence.ts — инфраструктура хранения
export const Tx = contextVar<Transaction>()('tx');
export const OutboxStore$ = makeToken<OutboxStore>('OutboxStore');

/** Юнит-мост: `Tx.provide` зависимостей из контейнера не получает */
@Handler([Database])
export class ProvideDb {
  constructor(private readonly db: Database) {}

  handle(): { db: Database } {
    return { db: this.db };
  }
}

export const transactional = makePipeline()
  .pre(ProvideDb)
  .pre(Tx.provide<{ db: Database }>((ctx) => ctx.input.db.begin()))
  .ok((_res, ctx) => ctx.input.tx.commit())
  .catch((_res, ctx) => ctx.input.tx?.rollback());

/** Плагин, а не фича: relay пакета инжектит `OutboxStore$` */
export const persistence = makePlugin({
  name: 'persistence',
  providers: [
    Database,
    ProvideDb,
    { provide: OutboxStore$, useFactory: (db: Database) => db.outbox, deps: [Database] },
  ],
});
```

```typescript
// src/app.ts — композиционный корень
export const appOutbox = outbox({
  transaction: Tx,
  store: OutboxStore$,
  operations: [UserCreated],
  partitionKey: (payload) => (payload as { id: string }).id,
});

export const app = makeApp({
  features: [UsersFeature],
  plugins: [persistence, appOutbox],
  transports: [http()],
  policies: [
    appOutbox.requiresTransaction({ pattern: /^(POST|PATCH|DELETE) / }),
  ],
});
```

```typescript
// src/users/endpoints/create-user.endpoint.ts — хендлер
@Handler([UsersRepository$, outboxed(UserCreated)])
export class CreateUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly userCreated: Emitter<typeof UserCreated>,
  ) {}

  async handle(input: CreateUserInput): Output<User> {
    const user = await this.users.insert(input);

    // Строка пользователя и строка outbox коммитятся вместе
    await this.userCreated.emit({ id: user.id, email: user.email });

    return Ok.created(user);
  }
}
```

## Что нужно знать

**Семантика `emit` другая.** `Promise<void>` завершается по факту записи,
а не доставки. Между коммитом и публикацией проходит до одного интервала
опроса. Событие `outbox.published` даёт измеримую задержку: разница
`publishedAt` и `createdAt`.

**Доставка at-least-once.** Relay может упасть между публикацией и
отметкой, и тогда запись публикуется второй раз. Оба сообщения несут один ключ
идемпотентности, равный идентификатору записи. Дедупликация — обязанность
обработчика.

**`emit` вне транзакции завершается ошибкой.** Режима «отправить
напрямую, если транзакции нет» нет ни опцией, ни по умолчанию. Для
нетранзакционной отправки — из `@OnStart` или фоновой задачи — берут
штатный `Op.emitter`.

**Экземпляр плагина в приложении один.** Рецепт семейства регистрируется
однажды, и второй вызов `outbox(...)` в том же корне роняет сборку.

**Адаптер хранилища живёт в плагине, а не в фиче.** Relay инжектит его
DI-токен, а плагин не имеет права зависеть от DI-токена фичи: проверка
границы фич останавливает такую сборку.

**Приложению нужна шина.** Relay публикует через `IMessageBus`, поэтому
сборка без шины в графе падает на фазе ASSEMBLE — с указанием обеих
починок.

## Хранилище

Адаптер к базе поставляет приложение: адаптер и транзакция обязаны быть
на одном соединении, а пакет, который везёт соединение, перестаёт быть
драйвер-независимым.

```typescript
interface OutboxStore {
  append(transaction: unknown, records: readonly OutboxRecord[]): Promise<void>;
  claim(options: OutboxClaimOptions): Promise<readonly ClaimedRecord[]>;
  settle(outcomes: readonly OutboxSettlement[]): Promise<void>;
}
```

`append` получает транзакцию непрозрачным значением: пакет не вызывает на
ней ни одного метода. `claim` — единственное место, отвечающее за
конкурентную выборку несколькими репликами; адаптер SQL реализует его
пропуском заблокированных строк. Он же держит порядок раздела: запись с
`partitionKey` не выдаётся, пока предыдущая запись того же раздела не
отмечена опубликованной или застрявшей. `settle` идемпотентен.

`InMemoryOutboxStore` — реализация для тестов и примеров. Транзакция,
которую она понимает, обязана давать точку коммита методом
`onCommit(action)`. Адаптеров к конкретным базам данных пакет не
поставляет.

## Конфигурация

Секция `outbox`; наружу пакет отдаёт только `outboxConfigKeys`.

| Ключ | Умолчание | Что задаёт |
|---|---|---|
| `OUTBOX_POLL_INTERVAL_MS` | `1000` | Пауза между проходами на пустой партии |
| `OUTBOX_BATCH_SIZE` | `100` | Сколько записей relay берёт за проход |
| `OUTBOX_BACKOFF_MS` | `500` | Пауза перед первым повтором; дальше удваивается |
| `OUTBOX_BACKOFF_MAX_MS` | `30000` | Потолок паузы между повторами |
| `OUTBOX_MAX_ATTEMPTS` | `10` | Попыток до отметки «застряла» |
| `OUTBOX_RELAY` | `true` | Крутит ли relay этот процесс |

В split-развёртывании записи создают все процессы, а разбирает их один:
`OUTBOX_RELAY=false` выключает фоновую задачу, не трогая запись.

## Наблюдение

Пакет объявляет две `event`-операции. Приложение без подписчиков на них
собирается и работает.

| Операция | Когда | Поля |
|---|---|---|
| `outbox.published` | запись опубликована | `id`, `subject`, `partitionKey`, `attempts`, `createdAt`, `publishedAt` |
| `outbox.stuck` | попытки исчерпаны | `id`, `subject`, `partitionKey`, `attempts`, `createdAt`, `stuckAt`, `reason` |

## Тесты

Тестовая сборка останавливается после фазы WIRE и `@OnStart` не
выполняет, поэтому проход по партии тест делает сам:

```typescript
await using app = await assembleTest(application);

await app.call(CreateUser, { name: 'Carol', email: 'carol@example.com' });

const relay = app.get(OutboxRelay$);
expect(await relay?.drain()).toMatchObject({ claimed: 1, published: 1 });
```

Таймеров ждать не нужно: `drain()` — один проход, а `@OnStart` только
повторяет его до сигнала остановки.

## Чего пакет не делает

- **Саги.** Корреляция и состояние процесса — отдельная тема.
- **Драйверы баз данных и миграции таблицы.**
- **Управление транзакцией.**
- **Дедупликацию на приёме.** Ключ доставляется, решение — за
  обработчиком.
