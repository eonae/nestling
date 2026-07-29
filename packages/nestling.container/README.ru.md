# @nestling/container

Лёгкий типобезопасный **IoC-контейнер** (DI-контейнер) на новых JS-декораторах и без сторонних зависимостей. Является основой будущего фреймворка `Nestling.js`

## Disclaimer

`Nestling` - _моя персональная_ версия Nest.js, который я люблю и ненавижу одновременно.

По сути он берёт из Nest.js  то, чем я и мои команды пользуются, оставляя за бортом всё лишнее. Для меня лишнее. О том, какой путь привёл меня к странной идее написания **очередного** JS-фреймворка, я обязательно напишу - возможно это будет интересно.

Но не здесь.

А здесь главное - что если Nest.js позиционирует себя, как opinionated решение, то `Nestling` - ещё более opinionated.

## ECMAScript декораторы

Прежде, чем окунуться в детальное сравнение и описания функций контейнера, стоит сказать о ключевой особенности: `Nestling` не использует экспериментальные TS-декораторы. Взамен используются декораторы из стандарта JS.

Я тоже скучаю по декораторам для параметров, но на самом деле в стандарте есть ряд плюсов, о которых рассказано ниже.


## Чем отличается DI Nestling и что у него общего с Nest-контейнером.

**Чего здесь нет:**
- `ForwardRef` - потому что циклических зависимостей **не должно быть никогда!**
- `REQUEST` и `TRANSIENT` скоупов для провайдеров. Строго говоря, Scope.REQUEST и не может быть функцией именно DI-контейнера. Это вообще непростая штука, тесно связывающая контейнер с приложением, где он используется. Вместо этого в `@nestling/app` имеется удобная обёртка над ALS. Ну а вместо Scope.TRANSIENT есть механизм On Demand инъекции, описанный ниже.
- Модулей, как классов. И соответственно lifecycle-хуков на модулях, методов configure и прочего, что есть в Nest.js. В несте вообще порядок работы хуков неочевиден, а с хуками на модулях - тем более. Вряд ли многие смогут на вскидку сказать какой OnModuleInit сработает раньше: на модуле или на сервисе в нём.

**А что есть:**
- Провайдеры трёх привычных видов: value, class и factory
- Возможность упрощённо объявлять class-провайдеры при помощи декоратора `@Injectable`
- Токены для инъекции, как в Nest.js могут быть ссылкой на класс или строкой, но за счёт магии [branded types](https://dev.to/themuneebh/typescript-branded-types-in-depth-overview-and-use-cases-60e) и пары хелперов, работа со строками удобнее
- Методы жизненного цикла `OnInit` и `OnDestroy` для провайдеров. В отличие от Nest.js, они работают при вызове соответствующих методов (`init` и `destroy`) на контейнере строго в **топологическом порядке**.
- Модульная система, более простая, чем в Nest.js, а кроме того - необязательная. Можно добавлять провайдеры и без модулей.
- Авто-регистрация провайдеров и модулей через декораторы и связи. То есть, если все ваши провайдеры разложены по модулям и эти модули импортируются в корневой модуль - в контейнере достаточно зарегистрировать только его. Зависимости подтянутся автоматически.

## Использование отдельно в том числе в браузере

Да, ещё одно важное отличие. Если Nest-контейнер встроен в приложение и неотделим, то `@nestling/container` - самостоятельный `маленький` пакет без сторонних зависимостей, который можно использовать где угодно: на фронтенде, в консольных приложениям. Даже в любом вашем любимом фреймворке, например fastify или, прости Господи, express.

> Общался со знакомым FE-техлидом и получил от него запрос на ленивую инициализацию провайдеров. То есть, чтобы поддеревья зависимостей в контейнере создавались в момент вызова `container.get(...)`. Пока думаю, т. к. это несколько усложняет реализацию, чему я отчаянно сопротивляюсь.

## К вопросу о простоте

Малое количество строк кода, хорошая инлайн документация в виде JSDoc и других комментариев, отсутствие зависимостей и ясность алгоритмов - всё это ценно само по себе.

Но ещё это - залог безопасности, которая в наше время становится всё более насущной проблемой.


## Установка

```bash
npm install @nestling/container
```

## Основные концепции

### DI -> DIP -> IoC -> IoC-контейнер

Если вы использовали Nest.js или библиотеки типа inversify, ну или просто хорошо подкованы в теории, то вам не нужно объяснять что такое IoC- (DI-) контейнер и какую задачу он решает.

Если же нет - рекомендую почитать что-то [типа этого](https://habr.com/ru/articles/131993/)


### Провайдеры

В мире DI **провайдер** - это что-то вроде чертежа, сообщающего контейнеру, как создать экземпляр чего-либо. В `Nestling`, как и в Nest.js провайдеры - это либо простые объекты-определения(`ProviderDefinition`), либо классы с декоратором `@Injectable`.

### Токены: как идентифицируются зависимости

**Токен** - это то, что вы используете для запроса зависимости. Это может быть одно из двух:

1. **Конструктор класса** - самый простой случай:
```typescript
class UserService {}

// Токен - это сам класс
container.get(UserService);
```

2. **Брендированная строка** - для интерфейсов и абстрактных зависимостей:
```typescript
import { makeToken } from '@nestling/container';

interface ILogger {
  log(message: string): void;
}

// Создаём токен для интерфейса
const ILogger = makeToken<ILogger>('ILogger');

// Используем его для регистрации и получения
container.get(ILogger);
```

**Зачем это нужно?** Интерфейсы и типы в TypeScript эфемерны - они исчезают при транспиляции в JavaScript. Функция `makeToken` позволяет их **материализовать**: создать runtime-представление типа, которое можно использовать как ключ в контейнере. По сути, это брендированная строка с привязанной информацией о типе для TypeScript.

Примерно также устроено и в NestJS, но здесь всё более явно и типобезопасно.

### Шорткат @Injectable

Когда вы контролируете код класса, можете использовать шорткат вместо написания `classProvider`:

```typescript
import { Injectable } from '@nestling/container';

// Вместо: classProvider(UserService, UserService)
// Просто декорируйте класс:
@Injectable([])
class UserService {
  // ваш код
}

// С зависимостями:
@Injectable([DatabaseService])
class UserRepository {
  constructor(private db: DatabaseService) {}
}

// С токеном интерфейса:
@Injectable(ILogger, [])
class ConsoleLogger implements ILogger {
  log(message: string) { console.log(message); }
}
```

**Важно**: это работает только для классов, которые вы можете изменить. Для сторонних классов или когда нужен больший контроль, используйте явные провайдеры.

### От провайдеров к экземплярам: граф зависимостей

Когда вы собираете контейнер, происходит интересное:

1. **Провайдеры резолвятся** в реальные экземпляры
2. **Зависимости связываются** - каждый экземпляр получает свои зависимости
3. **Строится DAG (направленный ациклический граф)**, представляющий дерево зависимостей
4. **Циклические зависимости обнаруживаются** и отклоняются, то есть вызывают ошибку сборки

Это тот же трёхфазный подход, что и в NestJS:
- Фаза регистрации (вы определяете провайдеры)
- Фаза валидации (проверка циклических зависимостей)
- Фаза инстанциирования (всё оживает)

```typescript
import { ContainerBuilder } from '@nestling/container';

const container = await new ContainerBuilder()
  .register(UserService)
  .register(DatabaseService)
  .register(LoggerService)
  .build(); // <- валидация и инстанцирование происходят здесь

await container.init(); // <- lifecycle хуки выполняются здесь
```

### Ручная регистрация vs модули

Вы можете регистрировать зависимости вручную, одну за одной:

```typescript
const container = await new ContainerBuilder()
  .register(DatabaseService)
  .register(UserRepository)
  .register(UserService)
  .register(valueProvider('CONFIG', config))
  .build();
```

**Но внимание!** Каждый зарегистрированный провайдер должен иметь ВСЕ свои зависимости также зарегистрированными. Контейнер не регистрирует транзитивные зависимости автоматически - вы должны быть явными. Это сделано специально: явное лучше неявного.

Для лучшей организации используйте **модули**:

```typescript
import { makeModule } from '@nestling/container';

const databaseModule = makeModule({
  name: 'DatabaseModule',
  providers: [DatabaseService, ConnectionPool],
  exports: [DatabaseService] // только это видно снаружи
});

const userModule = makeModule({
  name: 'UserModule',
  imports: [databaseModule], // получает DatabaseService отсюда
  providers: [UserRepository, UserService],
  exports: [UserService]
});

const container = await new ContainerBuilder()
  .register(userModule)
  .build();
```

### Модули: простые объекты, а не классы

Вот где мы расходимся с NestJS. В Nest модули - это классы с декораторами:

```typescript
// Способ NestJS - модули это классы
@Module({
  imports: [DatabaseModule],
  providers: [UserService],
  exports: [UserService]
})
export class UserModule {}
```

**Зачем?** Нет хорошей причины. У модулей нет lifecycle хуков (они есть у сервисов), у них нет бизнес-логики, это просто конфигурация. Делать их классами добавляет церемонности без пользы.

**@nestling/container** всё упрощает:

```typescript
// Наш способ - модули это простые объекты
const userModule = makeModule({
  name: 'UserModule',
  imports: [databaseModule],
  providers: [UserService],
  exports: [UserService]
});
```

Чище. Проще. Просто конфигурация.

### Lifecycle хуки: там, где им место

Lifecycle хуки (`@OnInit`, `@OnDestroy`) для сервисов, а не для модулей:

```typescript
import { Injectable, OnInit, OnDestroy } from '@nestling/container';

@Injectable([])
class DatabaseService {
  @OnInit()
  async connect() {
    console.log('Подключаемся к базе данных...');
    // логика инициализации
  }

  @OnDestroy()
  async disconnect() {
    console.log('Отключаемся...');
    // логика очистки
  }
}
```

Контейнер вызывает эти хуки в правильном порядке:
- `init()`: вызывает хуки `@OnInit` в топологическом порядке (сначала зависимости)
- `destroy()`: вызывает хуки `@OnDestroy` в обратном топологическом порядке

Это похоже на `OnModuleInit` и `OnModuleDestroy` из NestJS, но без церемоний с классами модулей.

#### Важно: регистрация хуков и тестирование

Метаданные lifecycle хуков регистрируются при **создании каждого экземпляра класса** (через механизм `context.addInitializer` в декораторах). Это означает, что если вы создаёте несколько экземпляров одного класса, метаданные могут накапливаться.

В обычном использовании это не проблема, так как контейнер создаёт синглтоны - один экземпляр на класс. Однако в **тестах** это может вызвать неожиданное поведение, если классы переиспользуются между тестами:

```typescript
// ❌ Проблема: класс определён вне beforeEach
@Injectable(IService, [])
class MyService {
  @OnInit()
  async init() { /* ... */ }
}

describe('Tests', () => {
  it('test 1', async () => {
    const container = await new ContainerBuilder()
      .register(classProvider(IService, MyService))
      .build();
    // Первое создание экземпляра - метаданные регистрируются
  });

  it('test 2', async () => {
    const container = await new ContainerBuilder()
      .register(classProvider(IService, MyService))
      .build();
    // Второе создание экземпляра - метаданные добавляются снова!
  });
});

// ✅ Решение: переопределяйте классы в beforeEach
describe('Tests', () => {
  let MyService: any;

  beforeEach(() => {
    @Injectable(IService, [])
    class MyServiceImpl {
      @OnInit()
      async init() { /* ... */ }
    }
    MyService = MyServiceImpl;
  });

  it('test 1', async () => {
    const container = await new ContainerBuilder()
      .register(classProvider(IService, MyService))
      .build();
    // Каждый тест использует свежий конструктор
  });
});
```

Переопределение классов в `beforeEach` гарантирует, что каждый тест работает с чистыми метаданными.

**См. также**: раздел «Динамические провайдеры» ниже объясняет, как ведут себя lifecycle-хуки, когда один рецепт порождает много экземпляров.

### Динамические провайдеры: семейства токенов

Иногда нужно несколько экземпляров одного интерфейса с разными конфигурациями: разные логгеры для разных частей приложения, клиент на каждый upstream, очередь на каждое имя. Это и есть **семейство токенов**: один рецепт, много членов, адресуемых параметром.

```typescript
interface ILoggerService {
  log(message: string): void;
}

// Семейство токенов. Вызов возвращает обычный мемоизированный токен:
// ILogger('users') === 'Logger:users'
const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Logger');
```

Член семейства — обычный `TokenString`, поэтому он работает везде, где работает токен: в deps `@Injectable`, в deps фабричного провайдера, в `container.get()`:

```typescript
@Injectable([ILogger('users')])
class UserService {
  constructor(private logger: ILoggerService) {}
}
```

Регистрируется **один рецепт на всё семейство**, а не провайдер на каждого члена. Рецепт возвращает обычное определение провайдера:

```typescript
const loggingModule = makeModule({
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
  exports: [ILogger], // семейство целиком, а не по одному члену
});
```

На `build()` контейнер собирает всех членов семейства, упомянутых в deps зарегистрированных провайдеров, вызывает рецепт **ровно один раз на уникальный параметр** и регистрирует результат обычным узлом графа. Дальше член неотличим от провайдера, зарегистрированного руками: жадное инстанцирование, дедупликация (два потребителя `ILogger('users')` получают один инстанс), проверка циклов, lifecycle-хуки, атрибуция к модулю, визуализация.

Никакой рантайм-резолюции нет. Член, от которого никто не зависит, не создаётся, и `container.get()` вернёт для него `null`. Если провайдер, порождённый рецептом, сам зависит от члена семейства, сбор повторяется, пока не перестанут появляться новые члены.

**Правило: члены создаются только вызовом семейства.** `makeToken<ILoggerService>('Logger:users')` даёт строку, которая лишь похожа на члена, — контейнер сообщит об отсутствующем провайдере (с подсказкой, на какое семейство это похоже).

Сборка падает с точечной ошибкой, если член запрошен, а `familyProvider` для его семейства не зарегистрирован; если рецепт вернул провайдер с чужим токеном; если для одного семейства зарегистрирован второй рецепт.

#### Consumer-aware члены: `Family.auto`

`ILogger.auto` — сентинел, который `@Injectable` заменяет на `ILogger('<ИмяДекорируемогоКласса>')` **в момент декорирования**: потребитель известен статически, в рантайме ничего не резолвится.

```typescript
@Injectable([IDatabase, ILogger.auto])
class UserRepository {
  // получает члена 'Logger:UserRepository'
  constructor(private db: IDatabase, private logger: ILoggerService) {}
}
```

Это закрывает нестовский кейс `transient + INQUIRER` без transient-скоупа. Два класса с `.auto` получают двух разных членов из одного рецепта; `.auto`-член и явный `ILogger('UserRepository')` — один и тот же узел.

Ограничения v1: `.auto` допустим только в deps классового `@Injectable`. В deps фабричного провайдера (класса-потребителя там нет) это ошибка регистрации, а на классе с пустым `constructor.name` — ошибка при декорировании. Escape hatch — явный вызов семейства. Поскольку id члена берётся из `constructor.name`, минификация с переименованием классов переименовала бы и членов: целевая среда — серверный Node без минификации.

#### Lifecycle членов

Каждый член — отдельный экземпляр и выполняет свои lifecycle-хуки. Это то, что нужно, когда каждый экземпляр владеет своим ресурсом (например, своим соединением).

Если же нужна **общая инициализация один раз для всех членов** (например, один пул соединений), правильный паттерн — вынести общее в обычный синглтон и зависеть от него из рецепта:

```typescript
const IConnectionPool = makeToken<IConnectionPool>('IConnectionPool');

@Injectable(IConnectionPool, [])
class ConnectionPool implements IConnectionPool {
  @OnInit()
  async initialize() {
    console.log('Инициализируем пул соединений один раз');
  }

  @OnDestroy()
  async cleanup() {
    console.log('Закрываем пул');
  }
}

const loggingModule = makeModule({
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
  exports: [ILogger],
});
```

### Видимость модулей: strictExports

По умолчанию `exports` модуля — метаданные: ничего не enforced, а видимость на деле решают ES-модули (не экспортировал токен из пакета — снаружи его нечем запросить).

Если хочется, чтобы декларации проверялись, включите opt-in проверку на сборке:

```typescript
const container = await new ContainerBuilder({ strictExports: true })
  .register(AppModule)
  .build();
```

При `strictExports: true` `build()` обходит готовый граф и для каждого ребра `потребитель → зависимость`, где зависимость принадлежит модулю M, а потребитель — нет, требует, чтобы токен зависимости был в `exports` модуля M. Правила:

- рёбра внутри одного модуля допускаются всегда;
- зависимости без модуля потребляются свободно;
- отсутствующий или пустой `exports` означает, что **не экспортировано ничего**: включил строгий режим — объявляй exports честно;
- семейство токенов в `exports` экспортирует всех своих материализованных членов;
- все нарушения сообщаются одной ошибкой списком `потребитель → зависимость (модуль)`.

Это lint по собранному графу, а не рантайм-инкапсуляция: проверок при `get()` или инжекте нет. Флаг выключен по умолчанию, поэтому существующие контейнеры собираются как раньше.

## Полный пример

Давайте соберём простое приложение с логированием, базой данных и управлением пользователями:

```typescript
import {
  Injectable,
  makeToken,
  makeModule,
  ContainerBuilder,
  OnInit,
  OnDestroy,
  valueProvider,
  factoryProvider
} from '@nestling/container';

// 1. Определяем интерфейсы и токены
interface ILogger {
  log(message: string): void;
}

interface IDatabase {
  query(sql: string): Promise<any>;
}

const ILogger = makeToken<ILogger>('ILogger');
const IDatabase = makeToken<IDatabase>('IDatabase');

// 2. Реализуем сервисы с lifecycle хуками
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
    console.log('Подключаемся к PostgreSQL...');
  }

  @OnDestroy()
  async disconnect() {
    console.log('Отключаемся от PostgreSQL...');
  }

  async query(sql: string) {
    return `Результат: ${sql}`;
  }
}

@Injectable([IDatabase, ILogger])
class UserService {
  constructor(
    private db: IDatabase,
    private logger: ILogger
  ) {}

  async getUsers() {
    this.logger.log('Получаем пользователей');
    return this.db.query('SELECT * FROM users');
  }
}

// 3. Организуем в модули
const loggingModule = makeModule({
  name: 'LoggingModule',
  providers: [ConsoleLogger],
  exports: [ILogger]
});

const databaseModule = makeModule({
  name: 'DatabaseModule',
  imports: [loggingModule],
  providers: [PostgresDatabase],
  exports: [IDatabase]
});

const userModule = makeModule({
  name: 'UserModule',
  imports: [databaseModule, loggingModule],
  providers: [UserService],
  exports: [UserService]
});

// 4. Собираем и используем
async function main() {
  const container = await new ContainerBuilder()
    .register(userModule)
    .build();

  await container.init();

  const userService = container.get(UserService);
  const users = await userService.getUsers();
  console.log(users);

  await container.destroy();
}

main().catch(console.error);
```

## Сравнение с NestJS

| Функционал | NestJS | @nestling/container |
|-----------|--------|---------------------|
| Модули | Классы с декораторами | Простые объекты |
| Провайдеры | Неявно через декораторы | Явные определения + шорткаты |
| Токены | Injection tokens или классы | То же: брендированные строки или классы |
| Lifecycle | `OnModuleInit`, `OnModuleDestroy` | `@OnInit`, `@OnDestroy` на сервисах |
| Граф зависимостей | Скрыт | Доступен через `toJSON()` |
| Циклические зависимости | Обнаруживаются | Обнаруживаются |
| Типобезопасность | Хорошая (с emitDecoratorMetadata) | Отличная (полный вывод типов) |
| Кривая обучения | Крутая | Пологая |

**Философия**: NestJS оптимизирован для полноты функционала. **@nestling/container** оптимизирован для ясности и простоты. Та же мощь, меньше магии.

## Продвинутое: визуализация графа зависимостей

Уникальная функция: полный доступ к графу зависимостей:

```typescript
const container = await new ContainerBuilder()
  .register(appModule)
  .build();

// Экспорт в JSON
const graph = await container.toJSON();
console.log(JSON.stringify(graph, null, 2));

// Ручной обход
await container.traverse(
  (node) => {
    console.log(`${node.id} зависит от:`, 
      node.dependencies.map(d => d.id)
    );
  },
  { direction: 'topological' }
);
```

Используйте **@nestling/viz** для интерактивной визуализации вашего дерева зависимостей.

## Справочник API

### Основные функции

- `makeToken<T>(id: string): TokenString<T>` - Создать токен инъекции
- `makeTokenFamily<T, [param: string]>(name): TokenFamily<T>` - Создать семейство токенов; `Family(param)` возвращает мемоизированного члена `"<name>:<param>"`, `Family.auto` — consumer-aware сентинел
- `Injectable(deps: InjectionToken[])` - Декорировать класс как инъектируемый
- `Injectable(token: TokenString, deps: InjectionToken[])` - Injectable с явным токеном
- `makeModule(config: Module): Module` - Создать модуль

### Фабрики провайдеров

- `classProvider<T>(token, class)` - Создать class provider (класс должен быть декорирован `@Injectable`)
- `valueProvider<T>(token, value)` - Создать value provider
- `factoryProvider<T>(token, factory, deps)` - Создать factory provider
- `familyProvider<T>(family, recipe)` - Зарегистрировать один рецепт на всё семейство токенов; рецепт `(param) => ProviderDefinition<T>` вызывается по разу на каждого упомянутого члена на сборке

### API контейнера

- `new ContainerBuilder(options?: { strictExports?: boolean })` - Создать builder
- `.register(...providers | ...familyProviders | ...modules)` - Зарегистрировать зависимости
- `.build()` - Собрать контейнер (async)
- `container.get<T>(token)` - Получить экземпляр (или `null`, если не зарегистрирован)
- `container.getOrThrow<T>(token)` - Получить экземпляр (бросает ошибку, если не зарегистрирован)
- `container.init()` - Запустить хуки инициализации
- `container.destroy()` - Запустить хуки уничтожения
- `container.toJSON()` - Экспортировать граф зависимостей

## Лицензия

MIT
