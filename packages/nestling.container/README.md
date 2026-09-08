# @nestling/container

Контейнер зависимостей для TypeScript: на стандартных декораторах
ECMAScript, с полной проверкой графа на сборке. Основа остальных пакетов
Nestling; работает и отдельно — в CLI, во фронтенде, рядом с любым
HTTP-фреймворком.

> 🚧 В активной разработке, API меняется. Целевое состояние —
> [`docs/design/container.md`](../../docs/design/container.md); гайды —
> [глава 22. Логгер с именем потребителя и сбор вкладов](../../docs/guide/22-token-families.md)
> по семействам DI-токенов и
> [глава 17. Запускать только часть фич](../../docs/guide/17-select.md)
> по переключателям состава.

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
import {
  classProvider,
  Component,
  ContainerBuilder,
  makeModule,
  makeToken,
} from '@nestling/container';

interface ILogger {
  log(message: string): void;
}

// DI-токен для интерфейса: интерфейсы исчезают при компиляции,
// DI-токен даёт им имя во время выполнения
const ILogger = makeToken<ILogger>('ILogger');

@Component([])
class ConsoleLogger implements ILogger {
  log(message: string) {
    console.log(message);
  }
}

// Зависимости перечисляются явно; порядок совпадает с конструктором
@Component([ILogger])
class UserService {
  constructor(private logger: ILogger) {}

  getUsers() {
    this.logger.log('users requested');
    return ['Alice', 'Bob'];
  }
}

const UsersModule = makeModule({
  name: 'module:users',
  // Класс под DI-токеном интерфейса регистрирует classProvider
  providers: [classProvider(ILogger, ConsoleLogger), UserService],
});

const container = new ContainerBuilder().register(UsersModule).build();
await container.init();

container.getOrThrow(UserService).getUsers();

await container.destroy();
```

`build()` строит граф из провайдеров и проверяет его целиком:
отсутствующая зависимость, цикл или класс не той роли останавливают сборку
с ошибкой. Экземпляров он не создаёт ни одного — их создаёт `init()`, тоже
целиком и в топологическом порядке. `destroy()` освобождает ресурсы.

## Основные понятия

### DI-токены

DI-токен — ключ, по которому у контейнера запрашивают зависимость.
DI-токеном может быть:

1. **Класс.** Подходит, когда зависимость — конкретный класс:

```typescript
class UserService {}

container.get(UserService);
```

2. **Объектный DI-токен** из `makeToken`. Подходит для интерфейсов и
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
создаёт объект, к которому на уровне типов привязан `T`: контейнер
использует **ссылку** на него как ключ, а компилятор выводит тип
зависимости.

Публичного конструктора класс-DI-токен не требует: у ресурса конструктор
бывает приватным — экземпляр создаёт `static acquire`, — а DI-токеном
остаётся тот же класс.

Идентичность DI-токена ссылочная. Строковый `id` служит отображению —
текстам ошибок, отчётам и `toJSON()` графа, — и на сравнение не влияет:
два вызова `makeToken('ILogger')` дают два разных DI-токена. Поэтому
DI-токен объявляют один раз и импортируют значением. Класс тоже
опознаётся по ссылке: два одноимённых класса из разных пакетов — два
разных узла графа. Совпадение `id` подмены не вызывает, но делает отчёты
неоднозначными, и сборка об этом предупреждает.

### Провайдеры

Провайдер описывает, как получить значение для DI-токена. Четыре вида:

```typescript
import {
  classProvider,
  factoryProvider,
  resourceProvider,
  valueProvider,
} from '@nestling/container';

// класс: контейнер создаст экземпляр
const logger = classProvider(ILogger, ConsoleLogger);

// готовое значение
const config = valueProvider('CONFIG', { apiUrl: 'https://api.example.com' });

// фабрика: синхронная функция получает зависимости и возвращает значение
const apiClient = factoryProvider(
  IApiClient,
  (config) => new ApiClient(config.apiUrl),
  ['CONFIG'], // зависимости фабрики
);

// ресурс: асинхронный захват на INIT и освобождение на SHUTDOWN
const pool = resourceProvider(IPool, {
  deps: ['CONFIG'],
  acquire: (config, signal) => createPool(config.dsn, { signal }),
  release: (pool) => pool.end(),
});
```

Сборка синхронна и ввода-вывода не делает, поэтому фабрика синхронна тоже:
`Promise` в её возвращаемом значении не компилируется, а литерал провайдера
с асинхронной фабрикой роняет `init()` ошибкой, называющей DI-токен и
предлагающей ресурс. Соединение захватывает ресурс, а не фабрика. Та же
цена у фабрики `providers:` модуля: `Promise` из неё — ошибка сборки с
именем модуля.

### Декораторы ролей

Класс в графе играет одну из трёх ролей, и её объявляет декоратор:

| Роль | Декоратор | Форма класса | Позиция |
|---|---|---|---|
| компонент | `@Component([deps])` | синхронный конструктор | `providers:` |
| ресурс | `@Resource([deps])` | `static acquire(...deps, signal)` и `release()` | `providers:` |
| хендлер | `@Handler([deps])` | конструктор и метод `handle` | слот `handler:` декларации; `providers:` — для юнита пайплайна |

```typescript
import { Component, Handler, Resource } from '@nestling/container';

// DI-токен — сам класс; без зависимостей форма короче
@Component()
class Clock {}

@Component([Database])
class UserRepository {
  constructor(private db: Database) {}
}

@Resource([DbConfig])
class Database {
  static async acquire(config: DbConfigValues, signal: AbortSignal) {
    return new Database(await connect(config.url, { signal }));
  }

  private constructor(private readonly pool: Pool) {}

  async release() {
    await this.pool.end();
  }
}

@Handler([UserRepository])
class CreateUserHandler {
  constructor(private repo: UserRepository) {}

  async handle(input: CreateUser) {
    return this.repo.create(input);
  }
}
```

DI-токен декоратор не принимает: класс регистрируется под собственным
DI-токеном, а привязку к DI-токену интерфейса выражает
`classProvider(Token, Class)` в `providers:`.

Форму класса проверяет компилятор: `@Component` отвергает класс с методом
`handle` или со `static acquire` и называет нужный декоратор, `@Handler`
требует `handle`, `@Resource` — `static acquire` и `release`. Роль в
позиции сверяет сборка: класс без декоратора роли и ресурс в слоте
`handler:` — ошибки фазы ASSEMBLE, называющие класс, позицию и декоратор.

Компилятор проверяет типы, порядок и длину списка зависимостей. Эталон
зависит от роли: у `@Component` и `@Handler` это
`ConstructorParameters<T>`, у `@Resource` — параметры `static acquire`
без последнего (`signal` в список не входит). У конструктора с
необязательным параметром годятся обе длины, у конструктора с
rest-параметром — любая. Лишний DI-токен даёт диагностику
`Dependency list length does not match the parameter list` с ожидаемой и
фактической длиной.

Длину проверяет только компилятор. `Function.length` в рантайме не
отличает необязательный параметр от отсутствующего, поэтому та же
проверка на значении отвергала бы список, который компилятор принимает.

Для чужих классов, которые нельзя декорировать, используйте
`factoryProvider` или `resourceProvider`.

### Модули

Модуль — обычный объект: имя, провайдеры и модули, от которых он зависит.

```typescript
import { makeModule } from '@nestling/container';

const DatabaseModule = makeModule({
  name: 'DatabaseModule',
  providers: [DatabaseService, ConnectionPool],
});

const UserModule = makeModule({
  name: 'UserModule',
  dependsOn: [DatabaseModule], // DatabaseService приходит отсюда
  providers: [UserRepository, UserService],
});

const container = new ContainerBuilder().register(UserModule).build();
```

Достаточно зарегистрировать корневой модуль: модули из `dependsOn`
регистрируются вместе с ним. Хуков жизненного цикла у модулей нет — они
есть у провайдеров.

Провайдеры можно регистрировать и без модулей, по одному:

```typescript
const container = new ContainerBuilder()
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
встреченное несколько раз (через `dependsOn`, через корень и фичу, через два
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

### Переключатели состава

Переключатель выбирает одну из объявленных веток состава по значению,
известному до сборки. Ветка — значение, а не функция: обе ветки читаются
без выполнения кода.

```typescript
import { makeSwitch } from '@nestling/container';

export const Storage = makeSwitch('storage', ['s3', 'local']); // перечисление
export const Metrics = makeSwitch('metrics'); //                  'on' | 'off'
export const Debug = makeSwitch('debug', { default: 'off' });

export const StorageModule = makeModule({
  name: 'module:storage',
  providers: [
    UploadsService,
    Storage.pick({ s3: [S3Client, S3Storage], local: [LocalStorage] }),
    Metrics.when(StorageMetrics), // то же, что pick({ on: …, off: [] })
  ],
});
```

Таблица `pick` перечисляет все значения переключателя; неполная таблица не
компилируется. Ветка — одно значение, массив значений или пустой массив.
Ветка внутри ветки раскрывается тем же проходом.

Ветка стоит в `providers:` и `dependsOn:` модуля. Значения приходят опцией
билдера, и без неё ветка роняет регистрацию:

```typescript
const container = new ContainerBuilder({ switches: { storage: 's3' } })
  .register(StorageModule)
  .build();
```

Раскрытие не копирует модуль: билдер читает его списки и регистрирует
результат, поэтому правило «два разных значения с одним именем — ошибка»
работает как прежде.

DI-токена у переключателя нет: выбор не инжектируется, состав не протекает
в рантайм. У приложения значения приходят аргументом сборки
`app.assemble(args)` — словарь переключателей объявляет корень
([`@nestling/app`](../nestling.app)).

Поле `schema` — Standard Schema значений с умолчанием; ею описывают поле
секции конфига, не добавляя валидатор в зависимости пакета:

```typescript
export const RootConfig = makeConfig('app', {
  storage: Storage.schema, // APP_STORAGE: 's3' | 'local'
});
```

### Сборка графа

`build()` выполняет четыре шага:

1. разворачивает фабрики провайдеров модулей;
2. создаёт узлы семейств, применяет подстановки и прунинг;
3. проверяет граф: отсутствующие зависимости, циклы, роли классов в
   позициях, дубликаты;
4. собирает предупреждения сборки в `container.warnings`.

Ни один конструктор и ни одна фабрика провайдера при этом не выполняются:
экземпляры создаёт `init()`.

```typescript
import { ContainerBuilder } from '@nestling/container';

const container = new ContainerBuilder()
  .register(UserService)
  .register(DatabaseService)
  .register(LoggerService)
  .build(); // проверка графа, без единого экземпляра

await container.init(); // экземпляры и захват ресурсов
```

Отсутствующие зависимости собираются в одну ошибку с указанием, кому они
нужны:

```
Unsatisfied dependencies (2):
  - 'IClock' required by 'ReportService'
  - 'UsersRepository' required by 'ReportService', 'ExportService'
Register a provider for each of them (in 'providers:' of a module, or via register()).
```

Предупреждения сборки — значение, а не печать. `container.warnings` —
замороженный список строк; без предупреждений он пуст. Сегодня
предупреждение одно: два разных DI-токена с одним `id`. Узлы при этом
различаются суффиксом `#N`, а отчёты становятся неоднозначными:

```typescript
const container = await new ContainerBuilder()
  .register(valueProvider(makeToken('Clock'), left))
  .register(valueProvider(makeToken('Clock'), right))
  .build();

container.warnings; // ["ambiguous DI token ids: Clock. Different DI tokens share an id, …"]
```

Билдер ничего не печатает сам: логгера у него нет. Сборка приложения из
`@nestling/app` пишет список в корневой логгер после `build()`; без неё
список читают руками.

### Жизненный цикл

Захват и освобождение выражает ресурс, а не хук:

```typescript
import { Resource } from '@nestling/container';

@Resource([])
class DatabaseService {
  static async acquire(signal: AbortSignal): Promise<DatabaseService> {
    return new DatabaseService(await connect({ signal }));
  }

  private constructor(private readonly pool: Pool) {}

  async release(): Promise<void> {
    await this.pool.end();
  }
}
```

Контейнер проходит граф в порядке, который следует из него самого:

| Метод контейнера | Что делает | Порядок |
|---|---|---|
| `init(signal?)` | создаёт экземпляры: компонент — конструктором, ресурс — `await acquire` | топологический: зависимости раньше зависимых |
| `start(signal)` | вызывает `@OnStart(signal)` | топологический, после INIT всего графа; повторный вызов ничего не делает |
| `destroy()` | вызывает `release` ресурсов | обратный топологический |

Провал захвата освобождает уже захваченное в обратном порядке, взводит
сигнал, переданный в `acquire`, и роняет старт исходной ошибкой; ошибки
`release` прикладываются к ней и причину не подменяют.

#### `health`: проверка состояния ресурса

Ресурс может объявить проверку своего состояния — методом `health(signal)`
у класса-ресурса или одноимённым полем у `resourceProvider`:

```typescript
@Resource([])
class DatabaseService {
  static async acquire(signal: AbortSignal): Promise<DatabaseService> { … }

  async release(): Promise<void> { … }

  async health(signal: AbortSignal): Promise<'ok' | 'degraded' | 'down'> {
    await this.pool.query('SELECT 1', { signal });
    return 'ok';
  }
}

// или функциональной формой
resourceProvider(Pool$, {
  deps: [DbConfig],
  acquire: (cfg, signal) => createPool(cfg.url, { signal }),
  release: (pool) => pool.end(),
  health: async (pool, signal) => (await pool.ping({ signal })) ? 'ok' : 'down',
});
```

Метод прототипа переносится в поле определения провайдера тем же приёмом,
каким переносится `release`, поэтому обе формы дальше неразличимы.

Сам контейнер проверок не запускает и о пробах не знает: он только
перечисляет такие провайдеры читающим методом билдера.

```typescript
for (const { token, id, health } of builder.healthResources()) {
  // id — идентификатор DI-токена, то же имя, под которым узел виден в графе
}
```

Смысл исходам задаёт тот, кто их собирает: в приложении Nestling это узел
`Health$` из [`@nestling/app`](../nestling.app), который заводит по вкладу
на каждый такой ресурс.

Единственный хук — `@OnStart`. В нём запускают то, чему нужен полностью
собранный граф: планировщики, потребители очередей, подписки. Аргументом
приходит сигнал остановки — тот же, что получают транспорты, поэтому
фоновая работа узнаёт о SHUTDOWN без обходных путей.

```typescript
import { Component, OnStart } from '@nestling/container';

@Component([])
class Scheduler {
  @OnStart()
  start(signal: AbortSignal): void {
    const timer = setInterval(() => this.tick(), 1000);
    signal.addEventListener('abort', () => clearInterval(timer));
  }
}
```

До завершения `init()` контейнер экземпляров не отдаёт: `get()`,
`getOrThrow()` и `getById()` бросают ошибку фазы, называющую DI-токен.
Факт регистрации без экземпляра проверяет `has(token)` — им пользуются
проверки фазы сборки. Обход графа (`forEachNode`, `traverse`, `toJSON`)
работает и до INIT: он читает метаданные и рёбра.

#### Хуки и тесты

Метаданные хука `@OnStart` регистрируются при создании каждого экземпляра
класса (через `context.addInitializer` декоратора). Контейнер создаёт по
одному экземпляру на класс, поэтому в приложении это незаметно. В тестах,
где один класс участвует в нескольких сборках, метаданные накапливаются.
Объявляйте такие классы внутри `beforeEach`:

```typescript
describe('UserService', () => {
  let MyService: any;

  beforeEach(() => {
    @Component([])
    class MyServiceImpl {
      @OnStart()
      async start() { /* ... */ }
    }
    MyService = MyServiceImpl;
  });

  it('инициализируется', async () => {
    const container = new ContainerBuilder()
      .register(classProvider(IService, MyService))
      .build();
    // у каждого теста свой конструктор и чистые метаданные
  });
});
```

### Семейства DI-токенов

Семейство DI-токенов — один рецепт для многих экземпляров одного
интерфейса, различающихся параметром: логгер на каждый модуль, клиент на
каждый upstream, очередь на каждое имя.

```typescript
import { makeTokenFamily } from '@nestling/container';

interface ILoggerService {
  log(message: string): void;
}

// Вызов семейства возвращает мемоизированный DI-токен члена с id
// 'Logger:users'; повторный вызов даёт тот же DI-токен
const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Logger');
```

Член семейства — обычный DI-токен плюс два поля принадлежности (`family`
и `param`). Он работает везде, где работает DI-токен: в `deps`
декоратора, в зависимостях фабрики, в `container.get()`:

```typescript
@Component([ILogger('users')])
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

Членов семейства создаёт только вызов семейства. Принадлежность читается
**полем** DI-токена, а не разбором его `id`, поэтому
`makeToken<ILoggerService>('Logger:users')` даёт DI-токен, который лишь
похож на члена: контейнер сообщит о нём как об обычной недостающей
зависимости.

Сборка останавливается с ошибкой, если член запрошен, а `familyProvider`
для его семейства не зарегистрирован; если рецепт вернул провайдер для
другого DI-токена; если для одного семейства зарегистрированы два
рецепта.

#### Член по имени потребителя: `Family.auto`

`ILogger.auto` — маркер, который декоратор роли заменяет на
`ILogger('<ИмяКласса>')` в момент декорирования. Потребитель известен
статически, во время выполнения ничего не вычисляется:

```typescript
@Component([IDatabase, ILogger.auto])
class UserRepository {
  // получает член 'Logger:UserRepository'
  constructor(private db: IDatabase, private logger: ILoggerService) {}
}
```

Два класса с `.auto` получают двух разных членов от одного рецепта.
`.auto` в классе `UserRepository` и явный `ILogger('UserRepository')` — один
и тот же узел.

Ограничения: `.auto` допустим только в `deps` класса с декоратором роли. В
зависимостях фабричного провайдера (у него нет класса-потребителя) это
ошибка регистрации; у класса с пустым `constructor.name` — ошибка при
декорировании. В обоих случаях используйте явный вызов семейства. Имя члена
берётся из `constructor.name`, поэтому минификатор, переименовывающий
классы, переименует и членов; пакет рассчитан на серверный Node без
минификации.

#### Сбор всех членов: `Family.all`

Обратная задача: много независимо зарегистрированных вкладов и один
агрегатор, который не знает их состава. Вклад — обычный провайдер с
DI-токеном члена, зарегистрированный там, где ему место:

```typescript
const ICounter = makeTokenFamily<Counter, [name: string]>('Counter');

// users.module.ts
providers: [classProvider(ICounter('users'), UsersCounter)],

// queries.module.ts — другой модуль, первый не меняется
providers: [classProvider(ICounter('queries'), QueriesCounter)],
```

Агрегатор зависит от маркера `ICounter.all` с типом
`Token<readonly Counter[]>`:

```typescript
@Component([ICounter.all])
class Metrics {
  constructor(private counters: readonly Counter[]) {}
}
```

При `build()`, после сбора всех членов, контейнер регистрирует
синтетический узел-агрегат. Его зависимости — DI-токены всех
зарегистрированных членов семейства, его значение — массив их
экземпляров. Дальше это обычный узел: проверка циклов, топологические
`init()` и `destroy()` (вклады инициализируются раньше потребителей
агрегата и уничтожаются позже), `toJSON()`, визуализация.

Правила агрегата:

- **Состав** — каждый член, у которого есть провайдер на момент создания
  агрегата: явные вклады, члены из рецепта, члены из `.auto`.
  `familyProvider` не обязателен: семейство из одних явных вкладов
  агрегируется так же.
- `.all` не создаёт членов сам. Член, созданный вызовом
  `ICounter('orphan')`, но нигде не зарегистрированный и никому не
  нужный, в массив не попадает.
- Если от `.all` никто не зависит, узел не создаётся:
  `container.get(ICounter.all)` возвращает `null`.
- Пустое семейство — пустой массив, а не ошибка: «фича не выбрана, её
  вкладов нет» — нормальное состояние.
- Порядок — порядок регистрации: модули и провайдеры в том порядке, в каком
  их зарегистрировали, затем члены, добавленные рецептом. Порядок
  детерминирован, но ничего большего не обещает. Если порядок значим
  (цепочка обработчиков), не полагайтесь на порядок `dependsOn`.
- Массив `readonly` и заморожен: это снимок сборки, общий для всех
  потребителей.
- Агрегат не принадлежит ни одному модулю, и его рёбра к вкладам ничем не
  ограничены: вклад чужого модуля попадает в массив без дополнительных
  объявлений.
- DI-токен `.all` — выделенное значение, а не член с зарезервированным
  параметром: `ICounter('all')` — обычный член и с агрегатом не
  сталкивается. Провайдер с `provide: ICounter.all` — ошибка
  регистрации: этот узел создаёт сборка.

#### Жизненный цикл членов

Каждый член — отдельный узел графа. Это подходит, когда каждый экземпляр
владеет своим ресурсом, например соединением: рецепт семейства отдаёт
провайдер ресурса, и каждый член захватывается отдельно.

Если ресурс общий для всех членов (один пул соединений), вынесите его в
обычный провайдер и сделайте рецепт зависимым от него:

```typescript
const IConnectionPool = makeToken<IConnectionPool>('IConnectionPool');

const pool = resourceProvider(IConnectionPool, {
  deps: [] as const,
  // пул создаётся один раз
  acquire: (signal) => createPool({ signal }),
  // и один раз закрывается
  release: (pool) => pool.end(),
});

const LoggingModule = makeModule({
  name: 'LoggingModule',
  providers: [
    pool,
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
const container = new ContainerBuilder({
  overrides: [[UsersRepository, inMemoryUsersRepo()]],
  familyOverrides: [{ family: ILogger, recipe: (scope) => valueProvider(ILogger(scope), noop) }],
}).register(UsersModule).build();

container.pruned; // ['UsersStore'] — узлы, выброшенные как ставшие ненужными
```

- `overrides` заменяет провайдер на провайдер-значение до создания
  экземпляров. Узел сохраняет принадлежность модулю, поэтому визуализация
  и диагностика по-прежнему называют владельца. Заглушка — обычный узел
  графа, только провайдер у него теперь провайдер значения, и освобождать
  ему нечего. Замена DI-токена без провайдера и двойная замена одного
  DI-токена — ошибки сборки.
- `familyOverrides` заменяет рецепт всего семейства до создания членов;
  рабочий рецепт не вызывается.
- Прунинг выбрасывает узлы, которые были достижимы только через
  зависимости заменённого провайдера: они не создаются, не попадают в
  граф, их ресурсы не захватываются и их хуки не выполняются. Корнями
  считаются DI-токены без входящих рёбер в объединении графов до и после
  подстановки, плюс DI-токены, недостижимые из корней (участники циклов
  должны дойти до проверки циклов). Агрегаты `Family.all` создаются после
  прунинга, и ребро к `Family.all` разворачивается в рёбра ко всем
  оставшимся членам.
- Без `overrides` графы до и после совпадают, и прунинг ничего не
  выбрасывает: рабочая сборка сохраняет каждый зарегистрированный узел,
  включая те, на которые никто не ссылается. `container.pruned` тогда
  пуст.

### Граф зависимостей

Готовый граф доступен целиком:

```typescript
const container = new ContainerBuilder().register(UsersModule).build();

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
  classProvider,
  Component,
  ContainerBuilder,
  makeModule,
  makeToken,
  Resource,
} from '@nestling/container';

// 1. Интерфейсы и DI-токены
interface ILogger {
  log(message: string): void;
}

interface IDatabase {
  query(sql: string): Promise<any>;
}

const ILogger = makeToken<ILogger>('ILogger');
const IDatabase = makeToken<IDatabase>('IDatabase');

// 2. Реализации: компонент и ресурс
@Component([])
class ConsoleLogger implements ILogger {
  log(message: string) {
    console.log(`[LOG] ${message}`);
  }
}

@Resource([])
class PostgresDatabase implements IDatabase {
  static async acquire(_signal: AbortSignal): Promise<PostgresDatabase> {
    console.log('Connecting to PostgreSQL...');
    return new PostgresDatabase();
  }

  async release() {
    console.log('Disconnecting from PostgreSQL...');
  }

  async query(sql: string) {
    return `Result of: ${sql}`;
  }
}

@Component([IDatabase, ILogger])
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
  providers: [classProvider(ILogger, ConsoleLogger)],
});

const DatabaseModule = makeModule({
  name: 'DatabaseModule',
  dependsOn: [LoggingModule],
  providers: [classProvider(IDatabase, PostgresDatabase)],
});

const UserModule = makeModule({
  name: 'UserModule',
  dependsOn: [DatabaseModule, LoggingModule],
  providers: [UserService],
});

// 4. Сборка и использование
async function main() {
  const container = new ContainerBuilder().register(UserModule).build();

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
| Зависимости | по типам через `emitDecoratorMetadata` | явный список DI-токенов |
| Модули | классы с декоратором | обычные объекты |
| Хуки жизненного цикла | на модулях и провайдерах | только на провайдерах, в топологическом порядке |
| `forwardRef`, циклы | есть | нет: цикл — ошибка сборки |
| Скоупы `REQUEST`, `TRANSIENT` | есть | нет: контекст запроса даёт `@nestling/app`, вместо `TRANSIENT` — семейства DI-токенов |
| Динамические модули (`forRoot`) | есть | функция, возвращающая модуль |
| Граф зависимостей | скрыт | `toJSON()`, `traverse()`, `@nestling/viz` |

## Справочник API

### DI-токены и модули

| Функция | Что делает |
|---|---|
| `makeToken<T>(id)` | создаёт объектный DI-токен `Token<T>` для интерфейса или значения |
| `readRoleMeta(cls)` | роль и список зависимостей класса или `undefined`, если декоратора роли нет |
| `makeTokenFamily<T, [param: string]>(name)` | создаёт семейство; `Family(param)` возвращает мемоизированный DI-токен `"<name>:<param>"`, `Family.auto` — член по имени класса-потребителя, `Family.all` — агрегат `Token<readonly T[]>` |
| `Component(deps?)` | декоратор компонента; DI-токен — сам класс |
| `Resource(deps?)` | декоратор ресурса: `static acquire` и `release` |
| `Handler(deps?)` | декоратор класса-хендлера: метод `handle` |
| `makeModule(module)` | создаёт модуль: `name`, `providers`, `dependsOn` |

### Переключатели состава

| Член | Что делает |
|---|---|
| `makeSwitch(name)` | двухпозиционный переключатель `'on' \| 'off'` без умолчания |
| `makeSwitch(name, { default })` | двухпозиционный с умолчанием |
| `makeSwitch(name, values)` | перечисление; значений не меньше двух и все различны |
| `makeSwitch(name, values, { default })` | перечисление с умолчанием; умолчание обязано быть одним из значений |
| `Switch.pick(table)` | ветка состава; таблица обязана перечислить все значения |
| `Switch.when(items)` | у двухпозиционного: то же, что `pick({ on: items, off: [] })` |
| `Switch.schema` | Standard Schema значений с умолчанием — для поля секции конфига |
| `resolveBranches(items, values, missing?)` | раскрывает ветки списка в элементы выбранных значений |
| `branchCandidates(items)` | элементы всех веток без выбора — для проверок раньше значений |
| `switchesUsed(items)` | переключатели, использованные ветками списка, без повторов |

### Провайдеры

| Функция | Что делает |
|---|---|
| `classProvider(token, Class)` | класс с ролью компонента или ресурса под DI-токеном интерфейса |
| `valueProvider(token, value)` | готовое значение |
| `factoryProvider(token, factory, deps)` | значение из фабрики, которая получает `deps` |
| `resourceProvider(token, { deps, acquire, release, health? })` | ресурс: `acquire` получает `deps` и сигнал последним аргументом, `release` — захваченное значение, `health` — его и сигнал |
| `familyProvider(family, recipe)` | рецепт семейства: `(param) => ProviderDefinition<T>`, вызывается при сборке по одному разу на каждого запрошенного члена |
| `dependenciesOf(provider)` | DI-токены, которые провайдер запрашивает: `deps` определения или метаданные декоратора роли. Читает значение, ничего не вызывая — рецепт семейства зависимостей не отдаёт |

### Контейнер

| Член | Что делает |
|---|---|
| `new ContainerBuilder(options?)` | билдер; опции `overrides`, `familyOverrides`, `switches` |
| `.register(...items)` | регистрирует провайдеры, рецепты семейств и модули |
| `.healthResources()` | читающий: провайдеры-ресурсы с `health` — `{ token, id, health }` в порядке регистрации |
| `.familyMembers(family)` | читающий: DI-токены зарегистрированных членов семейства в порядке регистрации |
| `.build()` | синхронно: строит и проверяет граф, не создавая экземпляров; возвращает `BuiltContainer` |
| `container.get(token)` | экземпляр или `null`, если DI-токен не зарегистрирован; до `init()` бросает ошибку фазы |
| `container.getOrThrow(token)` | экземпляр; бросает ошибку, если DI-токен не зарегистрирован или `init()` не завершён |
| `container.has(token)` | факт регистрации без экземпляра; работает до INIT |
| `container.init(signal?)` | создаёт экземпляры и захватывает ресурсы в топологическом порядке |
| `container.start(signal)` | вызывает `@OnStart(signal)` в топологическом порядке; повторный вызов ничего не делает |
| `container.destroy()` | вызывает `release` ресурсов в обратном порядке |
| `container.pruned` | идентификаторы узлов, выброшенных прунингом; пуст без `overrides` |
| `container.warnings` | предупреждения сборки (совпадающие `id` DI-токенов); пуст, если предупреждений нет |
| `container.toJSON()` | граф зависимостей в JSON |
| `container.forEachNode(callback)` | синхронный перебор узлов — для проверок на собранном графе |
| `container.traverse(callback, options)` | обход графа; ждёт колбэк, потому что его дело — фазы жизненного цикла |

### Subpath `@nestling/container/tokens`

Экспортирует только примитив DI-токена (`makeToken`, `Token`,
`InjectionToken`) и семейства DI-токенов, без билдера и графа.
Предназначен для пакетов, которые объявляют DI-токены, но не должны
тянуть контейнер в свою зависимость, например
[`@nestling/operations`](../nestling.operations).

## Границы пакета

Пакет не содержит скоупов запроса, ленивого создания провайдеров и
инкапсуляции во время выполнения: контекст запроса даёт `@nestling/app`,
видимость держится на экспортах ES-модулей.

## Лицензия

MIT
