# 6. Откуда хендлер берёт репозиторий

> Гайд по текущему API; сверено с кодом `users-service` (2026-09-08).
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
// examples/users-service/src/users/users.repository.ts
export const UsersRepository$ = makeToken<UsersRepository>('UsersRepository');
```

DI-токен — ключ, по которому у контейнера запрашивают зависимость. Класс
служит себе DI-токеном сам, поэтому `makeToken` нужен только там, где
зависимость описана интерфейсом. Суффикс `$` отличает DI-токен от
интерфейса с тем же именем; так же названы DI-токены ядра, например
`HttpTransport$`.

```typescript
// examples/users-service/src/users/users.repository.ts
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
// шаг главы 6; итоговая версия: examples/users-service/src/users/endpoints/get-user.endpoint.ts
@Handler([UsersRepository$])
export class GetUserHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(input: GetUserInput): Output<User, typeof UserNotFound> {
    const user = await this.users.byId(input.id);

    return user ?? UserNotFound({ id: input.id });
  }
}

export const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: GetUserInput,
  output: User,
  errors: [UserNotFound],
  handler: GetUserHandler,
});
```

`@Handler([UsersRepository$])` объявляет роль класса и перечисляет его
зависимости явным списком DI-токенов. Порядок списка совпадает с порядком
аргументов конструктора, а тип аргумента сверяется с типом DI-токена:
поставить в конструктор аргумент другого типа не получится.

Декоратор здесь стандартный, из ECMAScript. Список DI-токенов записан
значением, поэтому `reflect-metadata` и `emitDecoratorMetadata` не нужны
ни пакету, ни приложению.

Компилятор сверяет типы, порядок и длину. Аргумент другого типа,
перепутанный порядок DI-токенов, список короче и список длиннее, чем
список параметров, дают ошибку компиляции. У конструктора с
необязательным параметром допустимы обе длины, у конструктора с
rest-параметром — любая.

В декларации ничего про зависимости не написано: она называет адрес,
схемы, отказы и пайплайн. Экземпляр хендлера с готовыми зависимостями
создаёт контейнер, как в главе 5.

Реализация репозитория объявляется так же:

```typescript
// шаг главы 5; итоговая версия: examples/users-service/src/users/users.repository.ts
@Component([Database, Logger$.auto, Ctx(RequestId)])
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

Декоратор называет **роль** класса, а не способность быть зависимостью.
Ролей три: `@Component` — обычный класс, `@Resource` — то, что надо
захватить и отпустить, `@Handler` — класс с методом `handle`. Форму класса
проверяет компилятор: метод `handle` у компонента и `static acquire` у
хендлера не компилируются.

DI-токена декоратор не принимает: класс регистрируется под собственным
именем. Чтобы контейнер отдавал `DbUsersRepository` тому, кто запросил
`UsersRepository$`, привязку пишут в `providers:` фичи —
`classProvider(UsersRepository$, DbUsersRepository)`. Имя реализации
говорит, как она реализована: `DbUsersRepository` для базы,
`inMemoryUsersRepo` для фейка ([conventions.md](../conventions.md)).
Зависимость `Ctx(RequestId)` читает идентификатор запроса из контекста.

Фича перечисляет провайдеры, которые создаёт контейнер, — сервисы и
классы-юниты пайплайна:

```typescript
// шаг главы 5; итоговая версия: examples/users-service/src/users.feature.ts
export const UsersFeature = makeFeature({
  name: 'users',
  providers: [
    Database,
    classProvider(UsersRepository$, DbUsersRepository),
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

## Зависимость зависимости и ресурсы

Репозиторию нужна база, базе нужны конфиг и логгер. Ни один потребитель
этого не собирает: контейнер строит граф целиком и проверяет его целиком
при старте. DI-токен без провайдера останавливает сборку с перечнем всех
недостающих DI-токенов, цикл зависимостей тоже её останавливает. Во время
обработки запросов контейнер ничего не резолвит.

База держит соединение, а соединение надо открыть и закрыть. Это и есть
ресурс:

```typescript
// шаг главы 5; итоговая версия: examples/users-service/src/database.ts
@Resource([AppConfig, Logger$.auto])
export class Database {
  static async acquire(
    config: Config<typeof AppConfig>,
    logger: Logger,
    _signal: AbortSignal,
  ): Promise<Database> {
    // В лог уходит только хост, а не адрес целиком: хост считает
    // вычисляемое поле секции
    logger.info('database connected', { host: config.databaseHost });

    return new Database(logger, [
      { id: '1', name: 'Alice', email: 'alice@example.com' },
      { id: '2', name: 'Bob', email: 'bob@example.com' },
    ]);
  }

  private constructor(
    private readonly logger: Logger,
    /** Таблица пользователей */
    readonly users: User[],
  ) {}

  // …

  release(): void {
    this.users.length = 0;
    this.logger.info('database disconnected');
  }
}
```

Экземпляр создаёт `static acquire`, а не конструктор: захват асинхронен и
может провалиться, а конструктор ни того, ни другого не умеет. Зависимости
приходят в `acquire` в порядке списка, последним аргументом — сигнал
остановки старта: если процесс сворачивают во время захвата, соединение
можно не открывать. `release` вызывается на остановке, в порядке,
обратном захвату.

Отсюда главное свойство: потребитель ресурса создаётся **после** захвата и
получает готовое значение. Поэтому у `users` нет ни `| undefined`, ни
геттера с проверкой — состояния «ещё не подключились» у поля просто нет. В
примере вместо соединения — таблица в памяти.

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
зависимостей типизированы: аргумент другого типа, чем DI-токен в той же
позиции, не компилируется — как для `deps` фабрики, так и для декоратора
роли. Соединение чужой библиотеки объявляют
`resourceProvider(token, { deps, acquire, release })`: та же пара захвата
и освобождения, только без класса. Инжектировать при этом можно только
DI-токен, который удалось импортировать: инкапсуляция держится на
экспортах ES-модулей, а не на механизме времени выполнения.

Хендлер создаётся с фейком репозитория, без контейнера и без транспорта:

```typescript
// шаг главы 6; итоговая версия: examples/users-service/src/users/endpoints/create-user.endpoint.spec.ts
const handler = new CreateUserHandler(inMemoryUsersRepo([alice]));

const result = await handler.handle({ name: 'Carol', email: 'carol@example.com' });

expect(result).toMatchObject({
  value: { id: '2', name: 'Carol' },
  headers: { Location: '/users/2' },
});
```

```bash
API_TOKEN=secret yarn workspace @examples/users-service start:dev
curl localhost:3000/users/1
```

`Database` читает адрес базы из секции конфига. Следующая глава: [7. Порт
и адрес базы из окружения](./07-config.md).
