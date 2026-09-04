# 5. Откуда хендлер берёт репозиторий

> Гайд по текущему API; сверено с кодом `examples.users-service` (2026-09-05).
> Целевое описание: [design/container.md](../design/container.md),
> [design/endpoints.md](../design/endpoints.md). Почему так: записи
> [ideas.md](../decisions/ideas.md) «[2026-07-06] Token families + модули
> без рантайм-инкапсуляции» и «[2026-09-03] Поле `handler`: зависимости
> принадлежат хендлеру; канон `return`; `Output<T, typeof Def>`».

Пользователи должны храниться в одном месте, а не в файле каждого
endpoint'а. Хендлерам нужен репозиторий, репозиторию нужно соединение с
базой. Соединение должно открываться при старте и закрываться при
остановке, а endpoint не должен собирать всё это руками.

```typescript
// packages/examples.users-service/src/users/users.repository.ts
export const UsersRepository$ = makeToken<UsersRepository>('UsersRepository');
```

Токен — ключ, по которому у контейнера запрашивают зависимость. Класс
служит себе токеном сам, поэтому `makeToken` нужен только там, где
зависимость описана интерфейсом. Суффикс `$` отличает токен от интерфейса
с тем же именем; так же названы токены ядра, например `HttpTransport$`.

```typescript
// packages/examples.users-service/src/users/users.repository.ts
/** Хранилище пользователей: всё, что endpoint'ам нужно от базы */
export interface UsersRepository {
  all(): Promise<User[]>;
  byId(id: string): Promise<User | null>;
  byEmail(email: string): Promise<User | null>;
  insert(data: Omit<User, 'id'>): Promise<User>;
  patch(id: string, data: Partial<Omit<User, 'id'>>): Promise<User | null>;
  remove(id: string): Promise<boolean>;
}
```

Интерфейс описывает то, что нужно потребителю, а не то, что умеет база.
`insert` принимает `Omit<User, 'id'>`: идентификатор выдаёт хранилище, и
в аргументе его быть не должно. Хендлеры зависят от `UsersRepository$`, а
не от класса, поэтому реализацию можно подменить, не трогая endpoint'ы —
этим пользуется тест, который вызывает хендлер с фейком вместо базы.

## Хендлер и репозиторий как зависимости

```typescript
// packages/examples.users-service/src/users/endpoints/get-user.endpoint.ts
@Injectable([UsersRepository$])
export class GetUserHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(input: GetUserInput): Output<User, typeof UserNotFound> {
    const user = await this.users.byId(input.id);

    return user ?? UserNotFound({ id: input.id });
  }
}

export const GetUser = httpEndpoint({
  operation: GetUserOperation,
  pipeline: observability,
  handler: GetUserHandler,
});
```

`@Injectable([UsersRepository$])` перечисляет зависимости класса явным
списком токенов. Порядок списка совпадает с порядком аргументов
конструктора, а тип аргумента сверяется с типом токена: поставить в
конструктор аргумент другого типа не получится.

Декоратор здесь стандартный, из ECMAScript. Список токенов записан
значением, поэтому `reflect-metadata` и `emitDecoratorMetadata` не нужны
ни пакету, ни приложению.

Компилятор сверяет типы, порядок и длину. Аргумент другого типа,
перепутанный порядок токенов, список короче и список длиннее, чем список
параметров, дают ошибку компиляции. У конструктора с необязательным
параметром допустимы обе длины, у конструктора с rest-параметром — любая.

В декларации ничего про зависимости не написано: она называет адрес,
схемы, отказы и пайплайн. Экземпляр хендлера с готовыми зависимостями
создаёт контейнер, как в главе 4.

Реализация репозитория объявляется так же:

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

У `@Injectable` три формы. `@Injectable()` — класс без зависимостей.
`@Injectable([deps])` регистрирует класс под его же именем: так объявлен
`Database`. `@Injectable(token, [deps])` регистрирует класс под токеном:
контейнер отдаёт `DbUsersRepository` тому, кто запросил
`UsersRepository$`. Имя реализации говорит, как она реализована:
`DbUsersRepository` для базы, `inMemoryUsersRepo` для фейка
([conventions.md](../conventions.md)). Зависимость `Ctx(RequestId)`
читает идентификатор запроса из контекста.

Фича перечисляет провайдеры, которые создаёт контейнер, — сервисы и
классы-юниты пайплайна:

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

Классов-хендлеров здесь нет: их регистрируют сами endpoint'ы.

## Зависимость зависимости и хуки

Репозиторию нужна база, базе нужны конфиг и логгер. Ни один потребитель
этого не собирает: контейнер строит граф целиком и проверяет его целиком
при старте. Токен без провайдера останавливает сборку с перечнем всех
недостающих токенов, цикл зависимостей тоже её останавливает. Во время
обработки запросов контейнер ничего не резолвит.

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

Хук `@OnInit` вызывается после того, как создан весь граф, и только
после того, как выполнены зависимости узла; `@OnDestroy` вызывается при
остановке в обратном порядке, до их разрушения. Соединение открывается в
хуке, а не в конструкторе: конструктор только принимает зависимости, и до
`@OnInit` его сосед по графу может быть ещё не готов. В примере вместо
соединения — таблица в памяти.

## Провайдеры без класса

Не всякий узел графа — класс. Готовое значение и результат фабрики
регистрируются провайдерами:

```typescript
providers: [
  valueProvider(FeatureFlags$, { newSearch: true }),
  factoryProvider(
    SearchClient$,
    (config: Config<typeof AppConfig>) => new SearchClient(config.searchUrl),
    [AppConfig],
  ),
]
```

`valueProvider(token, value)` регистрирует готовое значение,
`factoryProvider(token, factory, deps)` — результат вызова фабрики с
зависимостями. Собственные зависимости фабрики перечисляются третьим
аргументом: контейнер их создаёт и передаёт в том же порядке. Списки
зависимостей типизированы: аргумент другого типа, чем токен в той же
позиции, не компилируется — как для `deps` фабрики, так и для
`@Injectable` класса. Инжектировать при этом можно
только токен, который удалось импортировать: инкапсуляция держится на
экспортах ES-модулей, а не на механизме времени выполнения.

Хендлер создаётся с фейком репозитория, без контейнера и без транспорта:

```typescript
// packages/examples.users-service/src/users/endpoints/create-user.endpoint.spec.ts
const handler = new CreateUserHandler(inMemoryUsersRepo([alice]));

const result = await handler.handle({ name: 'Carol', email: 'carol@example.com' });

expect(result).toMatchObject({
  value: { id: '2', name: 'Carol' },
  headers: { Location: '/users/2' },
});
```

```bash
API_TOKEN=secret yarn workspace examples.users-service start:dev
curl localhost:3000/users/1
```

`Database` читает адрес базы из секции конфига. Следующая глава: [6. Порт
и адрес базы из окружения](./06-config.md).
