# @nestling/container

Лёгкий типобезопасный **IoC-контейнер** (DI-контейнер) на новых JS-декораторах и без зависимостей. Является основой будущего фреймворка `Nestling.js`

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

Да, ещё одно важное отличие. Если Nest-контейнер встроен в приложение и неотделим, то `@nestling/container` - самостоятельный `маленький` пакет без зависимостей, который можно использовать где угодно: на фронтенде, в консольных приложениям. Даже в любом вашем любимом фреймворке, например fastify или, прости Господи, express.

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

**См. также**: раздел "Динамические провайдеры" ниже содержит дополнительное предупреждение о накоплении метаданных при создании нескольких экземпляров одного класса.

### Динамические провайдеры: токены с параметрами

Иногда нужно несколько экземпляров одного интерфейса с разными конфигурациями. Например, разные логгеры для разных частей приложения:

```typescript
// Определяем интерфейс логгера
interface ILogger {
  log(message: string): void;
}

// Создаём функцию-фабрику для токенов (пример из @examples.simple-app)
const ILogger = (context: string) => makeToken<ILogger>(`ILogger:${context}`);

// В модуле используйте функцию-фабрику для динамического создания провайдеров:
const loggingModule = makeModule({
  name: 'LoggingModule',
  providers: () => [ // <- Функция, а не массив!
    factoryProvider(
      ILogger('app'),
      () => new ConsoleLogger('app'),
      []
    ),
    factoryProvider(
      ILogger('db'),
      () => new ConsoleLogger('db'),
      []
    )
  ],
  exports: [ILogger('app'), ILogger('db')]
});
```

Функциональная форма позволяет вычислять провайдеры динамически. Это особенно полезно, когда:
- Нужны параметризованные токены
- Провайдеры зависят от runtime конфигурации
- Вы загружаете провайдеры асинхронно

Функция вызывается в фазе сборки, давая вам шанс настроить динамические зависимости до начала инстанцирования.

**Важно**: если вы создаёте несколько экземпляров одного класса (например, `new ConsoleLogger('app')` и `new ConsoleLogger('db')`), каждый экземпляр будет выполнять свои lifecycle хуки. Это нормально, если каждый экземпляр должен выполнить собственную инициализацию (например, установить своё соединение).

Однако, если вам нужна **общая инициализация один раз для всех экземпляров** (например, один пул соединений), правильный паттерн - вынести общую логику в отдельную зависимость-синглтон:

```typescript
// Определяем интерфейс и токен для пула соединений
interface IConnectionPool {
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
}

const IConnectionPool = makeToken<IConnectionPool>('IConnectionPool');

// Общий ресурс - синглтон с lifecycle хуками
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

// Логгеры используют общий ресурс
const loggingModule = makeModule({
  name: 'LoggingModule',
  providers: () => [
    ConnectionPool,
    factoryProvider(
      ILogger('app'),
      (pool) => new ConsoleLogger('app', pool),
      [IConnectionPool]
    ),
    factoryProvider(
      ILogger('db'),
      (pool) => new ConsoleLogger('db', pool),
      [IConnectionPool]
    )
  ],
  exports: [ILogger('app'), ILogger('db')]
});
```

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
- `Injectable(deps: InjectionToken[])` - Декорировать класс как инъектируемый
- `Injectable(token: TokenString, deps: InjectionToken[])` - Injectable с явным токеном
- `makeModule(config: Module): Module` - Создать модуль

### Фабрики провайдеров

- `classProvider<T>(token, class)` - Создать class provider (класс должен быть декорирован `@Injectable`)
- `valueProvider<T>(token, value)` - Создать value provider
- `factoryProvider<T>(token, factory, deps)` - Создать factory provider

### API контейнера

- `new ContainerBuilder()` - Создать builder
- `.register(...providers | ...modules)` - Зарегистрировать зависимости
- `.build()` - Собрать контейнер (async)
- `container.get<T>(token)` - Получить экземпляр
- `container.init()` - Запустить хуки инициализации
- `container.destroy()` - Запустить хуки уничтожения
- `container.toJSON()` - Экспортировать граф зависимостей

## Лицензия

MIT
