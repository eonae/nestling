# @nestling/container

Контейнер зависимостей для TypeScript: без сторонних зависимостей, на
стандартных декораторах ECMAScript, с полной проверкой графа на сборке.
Основа остальных пакетов Nestling; работает и отдельно — в CLI, во
фронтенде, рядом с любым HTTP-фреймворком.

> 🚧 В активной разработке, API меняется. Целевое состояние —
> [`docs/design/container.md`](../../docs/design/container.md); гайд по
> семействам токенов —
> [`docs/guides/di-token-families.md`](../../docs/guides/di-token-families.md).

## Установка

```bash
npm install @nestling/container
```

Пакет использует декораторы из стандарта ECMAScript, а не экспериментальные
декораторы TypeScript. В `tsconfig.json` не включайте
`experimentalDecorators` и `emitDecoratorMetadata`; `reflect-metadata` не
нужен.

## Быстрый старт

```typescript
import { ContainerBuilder, Injectable, makeModule, makeToken } from '@nestling/container';

interface ILogger {
  log(message: string): void;
}

// Токен для интерфейса: интерфейсы исчезают при компиляции,
// токен даёт им имя во время выполнения
const ILogger = makeToken<ILogger>('ILogger');

@Injectable(ILogger, [])
class ConsoleLogger implements ILogger {
  log(message: string) {
    console.log(message);
  }
}

// Зависимости перечисляются явно; порядок совпадает с конструктором
@Injectable([ILogger])
class UserService {
  constructor(private logger: ILogger) {}

  getUsers() {
    this.logger.log('users requested');
    return ['Alice', 'Bob'];
  }
}

const AppModule = makeModule({
  name: 'AppModule',
  providers: [ConsoleLogger, UserService],
});

const container = await new ContainerBuilder().register(AppModule).build();
await container.init();

container.getOrThrow(UserService).getUsers();

await container.destroy();
```

`build()` создаёт все провайдеры сразу и проверяет граф: отсутствующая
зависимость или цикл останавливают сборку с ошибкой. `init()` и
`destroy()` вызывают хуки жизненного цикла.

## Основные понятия

### Токены

Токен — ключ, по которому у контейнера запрашивают зависимость. Токеном
может быть:

1. **Класс.** Подходит, когда зависимость — конкретный класс:

```typescript
class UserService {}

container.get(UserService);
```

2. **Брендированная строка** из `makeToken`. Подходит для интерфейсов и
   абстрактных зависимостей:

```typescript
import { makeToken } from '@nestling/container';

interface ILogger {
  log(message: string): void;
}

const ILogger = makeToken<ILogger>('ILogger');

container.get(ILogger); // тип результата: ILogger | null
```

Интерфейсы и типы TypeScript исчезают при компиляции. `makeToken<T>(id)`
создаёт строку, к которой на уровне типов привязан `T`: контейнер
использует её как ключ, а компилятор выводит тип зависимости.

### Провайдеры

Провайдер описывает, как получить значение для токена. Три вида:

```typescript
import { classProvider, factoryProvider, valueProvider } from '@nestling/container';

// класс: контейнер создаст экземпляр
const logger = classProvider(ILogger, ConsoleLogger);

// готовое значение
const config = valueProvider('CONFIG', { apiUrl: 'https://api.example.com' });

// фабрика: функция получает зависимости и возвращает значение
const apiClient = factoryProvider(
  IApiClient,
  (config) => new ApiClient(config.apiUrl),
  ['CONFIG'], // зависимости фабрики
);
```

### Декоратор `@Injectable`

Для собственных классов вместо `classProvider` используйте декоратор:

```typescript
import { Injectable } from '@nestling/container';

// Токен — сам класс
@Injectable([])
class UserService {}

// С зависимостями
@Injectable([DatabaseService])
class UserRepository {
  constructor(private db: DatabaseService) {}
}

// С токеном интерфейса
@Injectable(ILogger, [])
class ConsoleLogger implements ILogger {
  log(message: string) {
    console.log(message);
  }
}
```

Компилятор проверяет, что типы и порядок аргументов конструктора совпадают
со списком зависимостей, а класс с токеном интерфейса реализует этот
интерфейс. Для чужих классов, которые нельзя декорировать, используйте
`classProvider` или `factoryProvider`.

### Модули

Модуль — обычный объект: имя, провайдеры и импорты других модулей.

```typescript
import { makeModule } from '@nestling/container';

const DatabaseModule = makeModule({
  name: 'DatabaseModule',
  providers: [DatabaseService, ConnectionPool],
});

const UserModule = makeModule({
  name: 'UserModule',
  imports: [DatabaseModule], // DatabaseService приходит отсюда
  providers: [UserRepository, UserService],
});

const container = await new ContainerBuilder().register(UserModule).build();
```

Достаточно зарегистрировать корневой модуль: модули из `imports`
регистрируются вместе с ним. Хуков жизненного цикла у модулей нет — они
есть у провайдеров.

Провайдеры можно регистрировать и без модулей, по одному:

```typescript
const container = await new ContainerBuilder()
  .register(DatabaseService)
  .register(UserRepository)
  .register(UserService)
  .register(valueProvider('CONFIG', config))
  .build();
```

Контейнер не регистрирует транзитивные зависимости сам: каждый провайдер,
который кому-то нужен, должен быть зарегистрирован явно.

#### Параметризованные модули

Модуль с параметрами — функция, которая возвращает модуль:

```typescript
export const logging = (options: { service: string }) =>
  makeModule({
    name: 'module:logging',
    providers: [/* ... */],
  });

// Создайте значение один раз и импортируйте его везде, где оно нужно
export const appLogging = logging({ service: 'orders-api' });
```

#### Идентичность модуля

Модуль идентифицируется своим значением. Одно и то же значение,
встреченное несколько раз (через `imports`, через корень и фичу, через два
модуля с общей инфраструктурой), регистрируется один раз.

Имя модуля должно быть уникальным: по нему атрибутируются провайдеры. Два
разных значения с одним именем — ошибка сборки:

```
Two different modules are named 'module:logging'. A module name is the
attribution key of its providers, so it must be unique. Either share one
module value between its consumers (create it once and import that value),
or give the two configurations different names. If neither is the case,
check for a duplicated package in your dependencies - two copies give two
values of the same module.
```

Поэтому повторный вызов фабрики модуля, даже с теми же опциями, даёт второе
значение под тем же именем, и сборка падает с этой ошибкой. Сравнение
модулей — по ссылке; опции структурно не сравниваются.

### Сборка графа

`build()` выполняет три шага:

1. регистрирует провайдеры и модули;
2. проверяет граф: отсутствующие зависимости, циклы, дубликаты;
3. создаёт экземпляры всех провайдеров в топологическом порядке.

```typescript
import { ContainerBuilder } from '@nestling/container';

const container = await new ContainerBuilder()
  .register(UserService)
  .register(DatabaseService)
  .register(LoggerService)
  .build(); // проверка и создание экземпляров

await container.init(); // хуки @OnInit
```

Отсутствующие зависимости собираются в одну ошибку с указанием, кому они
нужны:

```
Unsatisfied dependencies (2):
  - 'IClock' required by 'ReportService'
  - 'UsersRepository' required by 'ReportService', 'ExportService'
Register a provider for each of them (in 'providers:' of a module, or via register()).
```

### Жизненный цикл

Хуки `@OnInit`, `@OnStart` и `@OnDestroy` ставятся на методы провайдеров:

```typescript
import { Injectable, OnDestroy, OnInit } from '@nestling/container';

@Injectable([])
class DatabaseService {
  @OnInit()
  async connect() {
    // подключение к базе
  }

  @OnDestroy()
  async disconnect() {
    // закрытие соединения
  }
}
```

Контейнер вызывает хуки в порядке, который следует из графа:

| Метод контейнера | Хук | Порядок |
|---|---|---|
| `init()` | `@OnInit` | топологический: зависимости раньше зависимых |
| `start()` | `@OnStart` | топологический, после `@OnInit` всего графа; повторный вызов ничего не делает |
| `destroy()` | `@OnDestroy` | обратный топологический |

В `@OnInit` открывайте ресурсы: соединения, пулы. В `@OnStart` запускайте
то, чему нужен полностью собранный и инициализированный граф: планировщики,
потребители очередей, подписки.

#### Хуки и тесты

Метаданные хука регистрируются при создании каждого экземпляра класса
(через `context.addInitializer` декоратора). Контейнер создаёт по одному
экземпляру на класс, поэтому в приложении это незаметно. В тестах, где один
класс участвует в нескольких сборках, метаданные накапливаются. Объявляйте
такие классы внутри `beforeEach`:

```typescript
describe('UserService', () => {
  let MyService: any;

  beforeEach(() => {
    @Injectable(IService, [])
    class MyServiceImpl {
      @OnInit()
      async init() { /* ... */ }
    }
    MyService = MyServiceImpl;
  });

  it('инициализируется', async () => {
    const container = await new ContainerBuilder()
      .register(classProvider(IService, MyService))
      .build();
    // у каждого теста свой конструктор и чистые метаданные
  });
});
```

### Семейства токенов

Семейство токенов — один рецепт для многих экземпляров одного интерфейса,
различающихся параметром: логгер на каждый модуль, клиент на каждый
upstream, очередь на каждое имя.

```typescript
import { makeTokenFamily } from '@nestling/container';

interface ILoggerService {
  log(message: string): void;
}

// Вызов семейства возвращает обычный мемоизированный токен:
// ILogger('users') === 'Logger:users'
const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Logger');
```

Член семейства — обычный `TokenString`. Он работает везде, где работает
токен: в `deps` декоратора, в зависимостях фабрики, в `container.get()`:

```typescript
@Injectable([ILogger('users')])
class UserService {
  constructor(private logger: ILoggerService) {}
}
```

#### Рецепт: `familyProvider`

Вместо провайдера на каждого члена регистрируется один рецепт на всё
семейство. Рецепт получает параметр и возвращает обычный провайдер:

```typescript
const LoggingModule = makeModule({
  name: 'LoggingModule',
  providers: [
    familyProvider(ILogger, (scope) =>
      factoryProvider(
        ILogger(scope),
        (config: IConfig) => new ConsoleLogger(scope, config),
        [IConfig] as const,
      ),
    ),
  ],
});
```

При `build()` контейнер собирает всех членов семейства, упомянутых в
зависимостях зарегистрированных провайдеров, вызывает рецепт один раз на
каждый параметр и регистрирует результат как обычный узел графа. Дальше
член ничем не отличается от провайдера, зарегистрированного вручную:
создаётся при сборке, дедуплицируется (два потребителя `ILogger('users')`
получают один экземпляр), участвует в проверке циклов, хуках жизненного
цикла, атрибуции по модулям и визуализации.

Член, от которого никто не зависит, не создаётся; `container.get()` для
него возвращает `null`. Если провайдер, возвращённый рецептом, сам зависит
от другого члена семейства, сбор повторяется, пока не перестанут появляться
новые члены.

Членов семейства создаёт только вызов семейства.
`makeToken<ILoggerService>('Logger:users')` даёт строку, которая лишь
похожа на член: контейнер сообщит об отсутствующем провайдере и подскажет
имя семейства.

Сборка останавливается с ошибкой, если член запрошен, а `familyProvider`
для его семейства не зарегистрирован; если рецепт вернул провайдер для
другого токена; если для одного семейства зарегистрированы два рецепта.

#### Член по имени потребителя: `Family.auto`

`ILogger.auto` — маркер, который `@Injectable` заменяет на
`ILogger('<ИмяКласса>')` в момент декорирования. Потребитель известен
статически, во время выполнения ничего не вычисляется:

```typescript
@Injectable([IDatabase, ILogger.auto])
class UserRepository {
  // получает член 'Logger:UserRepository'
  constructor(private db: IDatabase, private logger: ILoggerService) {}
}
```

Два класса с `.auto` получают двух разных членов от одного рецепта.
`.auto` в классе `UserRepository` и явный `ILogger('UserRepository')` — один
и тот же узел.

Ограничения: `.auto` допустим только в `deps` класса с `@Injectable`. В
зависимостях фабричного провайдера (у него нет класса-потребителя) это
ошибка регистрации; у класса с пустым `constructor.name` — ошибка при
декорировании. В обоих случаях используйте явный вызов семейства. Имя члена
берётся из `constructor.name`, поэтому минификатор, переименовывающий
классы, переименует и членов; пакет рассчитан на серверный Node без
минификации.

#### Сбор всех членов: `Family.all`

Обратная задача: много независимо зарегистрированных вкладов и один
агрегатор, который не знает их состава. Вклад — обычный провайдер с токеном
члена, зарегистрированный там, где ему место:

```typescript
const IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>('HealthCheck');

// database.module.ts
providers: [classProvider(IHealthCheck('database'), DatabaseHealthCheck)],

// api.module.ts — другой модуль, первый не меняется
providers: [classProvider(IHealthCheck('api'), ApiHealthCheck)],
```

Агрегатор зависит от маркера `IHealthCheck.all` с типом
`TokenString<readonly HealthCheck[]>`:

```typescript
@Injectable([IHealthCheck.all])
class HealthService {
  constructor(private checks: readonly HealthCheck[]) {}
}
```

При `build()`, после сбора всех членов, контейнер регистрирует
синтетический узел-агрегат. Его зависимости — токены всех
зарегистрированных членов семейства, его значение — массив их экземпляров.
Дальше это обычный узел: проверка циклов, топологические `init()` и
`destroy()` (вклады инициализируются раньше потребителей агрегата и
уничтожаются позже), `toJSON()`, визуализация.

Правила агрегата:

- **Состав** — каждый член, у которого есть провайдер на момент создания
  агрегата: явные вклады, члены из рецепта, члены из `.auto`.
  `familyProvider` не обязателен: семейство из одних явных вкладов
  агрегируется так же.
- `.all` не создаёт членов сам. Член, созданный вызовом
  `IHealthCheck('orphan')`, но нигде не зарегистрированный и никому не
  нужный, в массив не попадает.
- Если от `.all` никто не зависит, узел не создаётся:
  `container.get(IHealthCheck.all)` возвращает `null`.
- Пустое семейство — пустой массив, а не ошибка: «фича не выбрана, её
  вкладов нет» — нормальное состояние.
- Порядок — порядок регистрации: модули и провайдеры в том порядке, в каком
  их зарегистрировали, затем члены, добавленные рецептом. Порядок
  детерминирован, но ничего большего не обещает. Если порядок значим
  (цепочка обработчиков), не полагайтесь на порядок `imports`.
- Массив `readonly` и заморожен: это снимок сборки, общий для всех
  потребителей.
- Агрегат не принадлежит ни одному модулю, и его рёбра к вкладам ничем не
  ограничены: вклад чужого модуля попадает в массив без дополнительных
  объявлений.
- Токен `.all` зарезервирован: провайдер с `provide: IHealthCheck.all` и
  параметр члена `'{all}'` — ошибки регистрации.

#### Жизненный цикл членов

Каждый член — отдельный экземпляр со своими хуками. Это подходит, когда
каждый экземпляр владеет своим ресурсом, например соединением.

Если ресурс общий для всех членов (один пул соединений), вынесите его в
обычный провайдер и сделайте рецепт зависимым от него:

```typescript
const IConnectionPool = makeToken<IConnectionPool>('IConnectionPool');

@Injectable(IConnectionPool, [])
class ConnectionPool implements IConnectionPool {
  @OnInit()
  async initialize() {
    // пул создаётся один раз
  }

  @OnDestroy()
  async cleanup() {
    // и один раз закрывается
  }
}

const LoggingModule = makeModule({
  name: 'LoggingModule',
  providers: [
    ConnectionPool,
    familyProvider(ILogger, (scope) =>
      factoryProvider(
        ILogger(scope),
        (pool: IConnectionPool) => new ConsoleLogger(scope, pool),
        [IConnectionPool] as const,
      ),
    ),
  ],
});
```

### Подстановка в тестах: `overrides` и прунинг

Две опции билдера предназначены для тестовой сборки. `assemble` из
`@nestling/app` их не передаёт; в тестах ими пользуется
[`@nestling/testing`](../nestling.testing).

```typescript
const container = await new ContainerBuilder({
  overrides: [[UsersRepository, inMemoryUsersRepo()]],
  familyOverrides: [{ family: ILogger, recipe: (scope) => valueProvider(ILogger(scope), noop) }],
}).register(UsersModule).build();

container.pruned; // ['UsersStore'] — узлы, выброшенные как ставшие ненужными
```

- `overrides` заменяет провайдер на провайдер-значение до создания
  экземпляров. Узел сохраняет принадлежность модулю, поэтому визуализация
  и диагностика по-прежнему называют владельца. Заглушка с `@OnInit` и `@OnDestroy` — обычный узел. Замена
  токена без провайдера и двойная замена одного токена — ошибки сборки.
- `familyOverrides` заменяет рецепт всего семейства до создания членов;
  рабочий рецепт не вызывается.
- Прунинг выбрасывает узлы, которые были достижимы только через
  зависимости заменённого провайдера: они не создаются, не попадают в
  граф, их хуки не выполняются. Корнями считаются токены без входящих
  рёбер в объединении графов до и после подстановки, плюс токены,
  недостижимые из корней (участники циклов должны дойти до проверки
  циклов). Агрегаты `Family.all` создаются после прунинга, и ребро к
  `Family.all` разворачивается в рёбра ко всем оставшимся членам.
- Без `overrides` графы до и после совпадают, и прунинг ничего не
  выбрасывает: рабочая сборка сохраняет каждый зарегистрированный узел,
  включая те, на которые никто не ссылается. `container.pruned` тогда
  пуст.

### Граф зависимостей

Готовый граф доступен целиком:

```typescript
const container = await new ContainerBuilder().register(AppModule).build();

// Экспорт в JSON
const graph = await container.toJSON();
console.log(JSON.stringify(graph, null, 2));

// Обход вручную
await container.traverse(
  (node) => {
    console.log(`${node.id} depends on:`, node.dependencies.map((d) => d.id));
  },
  { direction: 'topological' },
);
```

Для интерактивного просмотра графа есть пакет
[`@nestling/viz`](../nestling.viz).

## Полный пример

Приложение с логированием, базой данных и сервисом пользователей:

```typescript
import {
  ContainerBuilder,
  Injectable,
  makeModule,
  makeToken,
  OnDestroy,
  OnInit,
} from '@nestling/container';

// 1. Интерфейсы и токены
interface ILogger {
  log(message: string): void;
}

interface IDatabase {
  query(sql: string): Promise<any>;
}

const ILogger = makeToken<ILogger>('ILogger');
const IDatabase = makeToken<IDatabase>('IDatabase');

// 2. Реализации с хуками жизненного цикла
@Injectable(ILogger, [])
class ConsoleLogger implements ILogger {
  log(message: string) {
    console.log(`[LOG] ${message}`);
  }
}

@Injectable(IDatabase, [])
class PostgresDatabase implements IDatabase {
  @OnInit()
  async connect() {
    console.log('Connecting to PostgreSQL...');
  }

  @OnDestroy()
  async disconnect() {
    console.log('Disconnecting from PostgreSQL...');
  }

  async query(sql: string) {
    return `Result of: ${sql}`;
  }
}

@Injectable([IDatabase, ILogger])
class UserService {
  constructor(
    private db: IDatabase,
    private logger: ILogger,
  ) {}

  async getUsers() {
    this.logger.log('Fetching users');
    return this.db.query('SELECT * FROM users');
  }
}

// 3. Модули
const LoggingModule = makeModule({
  name: 'LoggingModule',
  providers: [ConsoleLogger],
});

const DatabaseModule = makeModule({
  name: 'DatabaseModule',
  imports: [LoggingModule],
  providers: [PostgresDatabase],
});

const UserModule = makeModule({
  name: 'UserModule',
  imports: [DatabaseModule, LoggingModule],
  providers: [UserService],
});

// 4. Сборка и использование
async function main() {
  const container = await new ContainerBuilder().register(UserModule).build();

  await container.init();

  const userService = container.getOrThrow(UserService);
  console.log(await userService.getUsers());

  await container.destroy();
}

main().catch(console.error);
```

## Отличия от NestJS

| | NestJS | @nestling/container |
|---|---|---|
| Декораторы | экспериментальные TypeScript | стандарт ECMAScript |
| Зависимости | по типам через `emitDecoratorMetadata` | явный список токенов |
| Модули | классы с декоратором | обычные объекты |
| Хуки жизненного цикла | на модулях и провайдерах | только на провайдерах, в топологическом порядке |
| `forwardRef`, циклы | есть | нет: цикл — ошибка сборки |
| Скоупы `REQUEST`, `TRANSIENT` | есть | нет: контекст запроса даёт `@nestling/app`, вместо `TRANSIENT` — семейства токенов |
| Динамические модули (`forRoot`) | есть | функция, возвращающая модуль |
| Граф зависимостей | скрыт | `toJSON()`, `traverse()`, `@nestling/viz` |

## Справочник API

### Токены и модули

| Функция | Что делает |
|---|---|
| `makeToken<T>(id)` | создаёт токен `TokenString<T>` для интерфейса или значения |
| `makeTokenFamily<T, [param: string]>(name)` | создаёт семейство; `Family(param)` возвращает мемоизированный токен `"<name>:<param>"`, `Family.auto` — член по имени класса-потребителя, `Family.all` — агрегат `TokenString<readonly T[]>` |
| `Injectable(deps)` | декоратор класса; токен — сам класс |
| `Injectable(token, deps)` | декоратор класса с явным токеном интерфейса |
| `makeModule(module)` | создаёт модуль: `name`, `providers`, `imports` |

### Провайдеры

| Функция | Что делает |
|---|---|
| `classProvider(token, Class)` | экземпляр класса с `@Injectable` |
| `valueProvider(token, value)` | готовое значение |
| `factoryProvider(token, factory, deps)` | значение из фабрики, которая получает `deps` |
| `familyProvider(family, recipe)` | рецепт семейства: `(param) => ProviderDefinition<T>`, вызывается при сборке по одному разу на каждого запрошенного члена |

### Контейнер

| Член | Что делает |
|---|---|
| `new ContainerBuilder(options?)` | билдер; опции `overrides`, `familyOverrides` |
| `.register(...items)` | регистрирует провайдеры, рецепты семейств и модули |
| `.build()` | проверяет граф, создаёт экземпляры, возвращает `BuiltContainer` |
| `container.get(token)` | экземпляр или `null`, если токен не зарегистрирован |
| `container.getOrThrow(token)` | экземпляр; бросает ошибку, если токен не зарегистрирован |
| `container.init()` | вызывает `@OnInit` в топологическом порядке |
| `container.start()` | вызывает `@OnStart` в топологическом порядке; повторный вызов ничего не делает |
| `container.destroy()` | вызывает `@OnDestroy` в обратном порядке |
| `container.pruned` | идентификаторы узлов, выброшенных прунингом; пуст без `overrides` |
| `container.toJSON()` | граф зависимостей в JSON |
| `container.traverse(callback, options)` | обход графа |

### Subpath `@nestling/container/tokens`

Экспортирует только примитив токена (`makeToken`, `TokenString`,
`InjectionToken`) и семейства токенов, без билдера и графа. Предназначен
для пакетов, которые объявляют токены, но не должны тянуть контейнер в свою
зависимость, например [`@nestling/contracts`](../nestling.contracts).

## Границы пакета

Пакет не содержит скоупов запроса, ленивого создания провайдеров и
инкапсуляции во время выполнения: контекст запроса даёт `@nestling/app`,
видимость держится на экспортах ES-модулей.

## Лицензия

MIT
