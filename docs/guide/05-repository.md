# 4. Хендлеру нужен репозиторий

> Гайд по текущему API; сверено с кодом `examples.users-service` (2026-09-03).
> Целевое описание: [design/container.md](../design/container.md),
> [design/endpoints.md](../design/endpoints.md). Почему так: записи
> [ideas.md](../decisions/ideas.md) «[2026-07-06] Token families + модули
> без рантайм-инкапсуляции» и «[2026-07-13] Endpoint-декларации:
> per-transport конструкторы, `deps`-инжект, формы хендлера».

## Задача

Пользователи должны храниться в одном месте, а не в файле каждого
endpoint'а. Хендлерам нужен репозиторий, репозиторию нужно соединение с
базой. Соединение должно открываться при старте и закрываться при
остановке, а endpoint не должен собирать всё это руками.

## Решение

### Интерфейс и токен

```typescript
// packages/examples.users-service/src/users/users.repository.ts
/** Хранилище пользователей: всё, что endpoint'ам нужно от базы */
export interface UsersRepository {
  all(): Promise<User[]>;
  byId(id: string): Promise<User | null>;
  byEmail(email: string): Promise<User | null>;
  insert(data: NewUser): Promise<User>;
  patch(id: string, data: Partial<Omit<User, 'id'>>): Promise<User | null>;
  remove(id: string): Promise<boolean>;
}

export const UsersRepository$ = makeToken<UsersRepository>('UsersRepository');
```

Токен — ключ, по которому у контейнера запрашивают зависимость. Класс
сам является токеном, а для интерфейса токен создаёт `makeToken`.
Суффикс `$` отличает токен от интерфейса с тем же именем; так же названы
токены ядра, например `HttpTransport$`. Endpoint'ы зависят от
`UsersRepository$`, а не от класса, поэтому реализацию можно подменить,
не трогая endpoint'ы.

### Соединение с базой

```typescript
// packages/examples.users-service/src/database.ts
@Injectable([AppConfig, Logger$])
export class Database {
  #users: User[] | undefined;

  constructor(
    private readonly config: Config<typeof AppConfig>,
    private readonly logger: Logger,
  ) {}

  @OnInit()
  connect(): void {
    // В лог уходит только хост: значение поля секретное
    this.logger.log(
      `database connected: ${new URL(this.config.databaseUrl).host}`,
    );
    this.#users = [
      { id: '1', name: 'Alice', email: 'alice@example.com' },
      { id: '2', name: 'Bob', email: 'bob@example.com' },
    ];
  }

  @OnDestroy()
  disconnect(): void {
    this.#users = undefined;
    this.logger.log('database disconnected');
  }

  /** Таблица пользователей */
  get users(): User[] {
    if (!this.#users) {
      throw new Error('Database is not connected: @OnInit has not run yet');
    }

    return this.#users;
  }
}
```

`@Injectable([AppConfig, Logger$])` объявляет зависимости класса явным
списком токенов. Порядок списка совпадает с порядком аргументов
конструктора. Тип аргумента в конструкторе сверяется с типом токена.
Секция `AppConfig` появится в главе 5, логгер `Logger$` в главе 7.

Хук `@OnInit` вызывается после того, как создан весь граф, `@OnDestroy`
вызывается при остановке. Соединение открывается в хуке, а не в
конструкторе: конструктор только принимает зависимости. В примере вместо
соединения таблица в памяти.

### Реализация репозитория

```typescript
// packages/examples.users-service/src/users/users.repository.ts
@Injectable(UsersRepository$, [Database, Logger$, Ctx(RequestId)])
export class DbUsersRepository implements UsersRepository {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    private readonly requestId: CtxReader<string>,
  ) {}

  async byId(id: string): Promise<User | null> {
    this.trace(`byId ${id}`);

    return this.db.users.find((user) => user.id === id) ?? null;
  }

  // …
}
```

У `@Injectable` две формы. `@Injectable([deps])` регистрирует класс под
его же именем: так объявлен `Database`. `@Injectable(token, [deps])`
регистрирует класс под токеном: контейнер отдаёт `DbUsersRepository`
тому, кто запросил `UsersRepository$`. Зависимость `Ctx(RequestId)`
читает идентификатор запроса из контекста; её объясняет глава 7.

### Зависимости хендлера

```typescript
// packages/examples.users-service/src/users/endpoints/get-user.endpoint.ts
export const getUserHandler =
  (users: UsersRepository) =>
  async (payload: GetUserInput): Output<User, FailOf<typeof UserNotFound>> => {
    const user = await users.byId(payload.id);

    // Отказ возвращается значением. Для ответа это то же, что бросок
    return user ?? UserNotFound({ id: payload.id });
  };

export const GetUser = httpEndpoint({
  operation: GetUserOperation,
  pipeline: observability,
  deps: [UsersRepository$],
  handle: getUserHandler,
});
```

Поле `deps` перечисляет токены, которые нужны хендлеру. Хендлер
записывается каррированной фабрикой: внешняя функция принимает
зависимости, внутренняя принимает payload. Внешняя функция вызывается
один раз при сборке, и замыкание играет роль инстанса. Порядок
аргументов внешней функции совпадает с порядком `deps`. Такой хендлер
тестируется без контейнера: достаточно вызвать фабрику с фейком.

Поля `operation` и `pipeline` относятся к главам 10 и 7.

### Регистрация в фиче

```typescript
// packages/examples.users-service/src/users.feature.ts
export const UsersFeature = makeFeature({
  name: 'users',
  providers: [
    ConsoleLogger,
    Database,
    DbUsersRepository,
    AuditOutcome,
    Authenticate,
  ],
  endpoints: [
    Health,
    ListUsers,
    GetUser,
    CreateUser,
    DeleteUser,
    UploadAvatar,
    ExportUsers,
    ImportUsers,
  ],
});
```

Поле `providers` перечисляет классы, которые создаёт контейнер. Классы
из глав 7 и 8 (`ConsoleLogger`, `AuditOutcome`, `Authenticate`)
регистрируются так же, как репозиторий.

## Что гарантирует фреймворк

- Граф зависимостей строится и проверяется целиком при старте. Токен без
  провайдера останавливает сборку с перечнем всех недостающих токенов.
  Цикл зависимостей тоже останавливает сборку. Во время обработки
  запросов контейнер ничего не резолвит.
- Список `deps` типизирован: аргумент фабрики другого типа, чем токен в
  той же позиции, не компилируется. То же для аргументов конструктора
  и списка `@Injectable`.
- Инжектировать можно только токен, который удалось импортировать.
  Инкапсуляция держится на экспортах ES-модулей, а не на механизме
  времени выполнения.

## Как проверить

```typescript
// packages/examples.users-service/src/users/endpoints/create-user.endpoint.spec.ts
const handle = createUserHandler(inMemoryUsersRepo([alice]));

const result = await handle({ name: 'Carol', email: 'carol@example.com' });

expect(result).toMatchObject({
  value: { id: '2', name: 'Carol' },
  headers: { Location: '/users/2' },
});
```

Фабрика хендлера вызывается с фейком репозитория. Контейнер, транспорт и
пайплайн в тесте не участвуют. Фейк `inMemoryUsersRepo` описан в главе 6.

## Пока не нужно

- Модули, которые группируют провайдеры внутри большой фичи: глава 11.
- Семейства токенов, например логгер с именем потребителя: глава 20.
- Хендлер в форме класса с `@Injectable`: приложение А.
- `Ctx(RequestId)` в репозитории: глава 7.

## Запускаемый код

- `packages/examples.users-service/src/users/users.repository.ts`
- `packages/examples.users-service/src/database.ts`
- `packages/examples.users-service/src/users/endpoints/get-user.endpoint.ts`
- `packages/examples.users-service/src/users.feature.ts`

```bash
API_TOKEN=secret yarn workspace examples.users-service start:dev
curl localhost:3000/users/1
```

## Дальше

`Database` читает адрес базы из секции конфига, которую глава не
объяснила. Следующая глава: [5. Порт и адрес базы из
окружения](./05-config.md).
