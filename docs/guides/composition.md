# Composition root: `assemble`, фичи и фазы

> Гайд по **текущему API**; сверено с кодом `examples.app-with-http` (2026-09-01).
> Разделы про конфиг и `@OnStart` сверены с `examples.simple-app`,
> раздел про standalone — с `examples.simple-http-server`.

Приложение Nestling собирается одной функцией — `assemble`. Она принимает
описание приложения и возвращает `App` с тремя методами: `run()`, `check()`
и `close()`. Публичного конструктора у `App` нет.

```typescript
import { assemble } from '@nestling/app';
import { http } from '@nestling/transport.http';

await assemble({
  modules: [OrdersModule],
  transports: [http({ port: 3000 })],
}).run();
```

Каждое поле описания опционально. Приложению из одного модуля не нужны ни
фичи, ни `select`, ни конфиг: эти уровни подключаются по мере
необходимости, а пока не подключены, ничего не стоят.

Гайд идёт по уровням: L0 (модули и транспорт), L1 (конфиг), L2 (фичи и
`select`). Дальше — параметризованные инфраструктурные модули, фазы
жизненного цикла, политики сборки и standalone-режим без `App`.

## L0 — модули и транспорт

```typescript
await assemble({
  modules: [UsersModule],
  transports: [http({ port: 3000 })],   // явная опция сильнее HTTP_PORT
}).run();
```

`http()` возвращает не экземпляр транспорта, а провайдер. Его зависимости
(порт и хост из конфиг-секции транспорта) подставляет контейнер. Поле
`transports:` — сокращённая запись регистрации этого провайдера: тот же
провайдер можно объявить в `providers:` любого модуля, в том числе
инфраструктурного модуля фичи.

Порт и хост выбираются по приоритету: сначала явные опции фабрики, затем
конфиг (`HTTP_PORT`, `HTTP_HOST`), затем значение по умолчанию транспорта.

Список транспортов приложения отдельно не настраивается. Он выводится из
двух источников: токены, на которые ссылаются найденные декларации
endpoint'ов, и токены провайдеров из `transports:`. Если декларация
ссылается на транспорт, которого нет в графе, сборка падает на фазе
ASSEMBLE — так же, как при любой другой незарегистрированной зависимости:

```
Transport 'cli' is required by endpoint 'users:list' declared in module
'module:cli', but is not registered in the container. Add it to
'transports:' of assemble({ … }) or to 'providers:' of a module
(for example cli()).
```

## L1 — конфиг

```typescript
// packages/examples.simple-app/src/main.ts (сокращено)
const app = assemble({
  modules: [LoggingModule, AppModule],
  providers: [Demo],
  config: [
    [objectSource({ APP_LOG_LEVEL: 'debug' }, 'defaults'), appConfigKeys],
  ],
});

await app.run();
```

Поле `config` — плоский список пар «источник, ключи». Порядок в списке
задаёт приоритет: источник, указанный раньше, побеждает. `process.env`
читается всегда, с самым низким приоритетом, и в списке не указывается.
Если приложению хватает переменных окружения, поле `config` не нужно:
модуль конфига регистрируется в любом случае.

Подробно о конфиге — [config.md](./config.md).

## L2 — фичи и `select`

```typescript
// packages/examples.app-with-http/src/features.ts
export const OpsFeature = makeFeature({
  name: 'ops',
  modules: [OpsModule],
});

export const QuotasFeature = makeFeature({
  name: 'quotas',
  modules: [QuotasModule],   // владеет контрактом, который вызывает users
});

export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  dependsOn: [OpsFeature, QuotasFeature],   // выбрали users — включатся и они
});
```

Фича — это значение: набор модулей плюс ссылки на фичи, без которых она не
работает. `dependsOn` принимает значения фич, а не их имена. Глобального
реестра фич нет, и объявление фичи само по себе ничего не регистрирует.

`quotas` указана в `dependsOn` не для удобства. Фича `users` вызывает её
через контракт, а `request`-контракт без реализации в том же процессе —
ошибка сборки ([ports.md](./ports.md)). Поэтому топология «users без
quotas» падает на фазе ASSEMBLE, а не на первом запросе.

Подмножество фич выбирается до сборки контейнера, на фазе 0 (BOOTSTRAP).
Для этого есть единственный способ прочитать конфиг до сборки —
`load(section)`. Он работает синхронно и читает только `process.env`;
источники из поля `config` в нём не участвуют.

```typescript
// packages/examples.app-with-http/src/main.ts (сокращено)
const RootConfig = makeConfig('app', {
  features: z.string().default('all'),   // ключ APP_FEATURES
});

const cfg = load(RootConfig);

const app = assemble({
  features: [UsersFeature, OpsFeature, QuotasFeature],
  select: cfg.features,          // 'all' | 'users' | 'users,billing'
  transports: [http({ port: 3000 })],
});

await app.run();
```

`select` принимает три формы: `'all'`, строку с именами через запятую
(`'users,billing'`; пробелы вокруг имён игнорируются) и массив имён
(`['users', 'billing']`). Если `features` заданы, а `select` нет,
выбираются все фичи.

Невыбранной фичи в приложении нет целиком: её модули не попадают в
контейнер, провайдеры не создаются, endpoint'ы не регистрируются ни в одном
транспорте. Это верно, даже если файлы этой фичи импортированы процессом.

Ошибки выбора обнаруживаются до построения контейнера: неизвестное имя
(сообщение перечисляет доступные), две разные фичи с одним `name`, пустой
выбор (`''` или `[]`; «ничего» записывается отсутствием `features`), а
также `select` без `features`. Цикл в `dependsOn` ошибкой не является:
поле описывает, что без чего не работает, а не порядок построения. Выбрав
одну из двух взаимно зависимых фич, вы получите обе.

Модули из `modules:` корня и модули выбранных фич регистрируются вместе.
Одно и то же значение модуля, встреченное несколько раз, регистрируется
один раз. Два разных значения с одинаковым `name` роняют сборку (см.
«Инфраструктура: параметризованные модули»). Порядок регистрации: сначала
модуль конфига из ядра, затем `modules:` корня, затем модули выбранных фич
в порядке выбора.

## Инфраструктура: параметризованные модули

Сквозная инфраструктура — логирование, метрики, реестр подписок —
объявляется обычными модулями и попадает в граф через `modules:` корня или
через импорты модулей фичи. Отдельного примитива «плагин» нет: ни типа, ни
поля `plugins:` в корне, ни `DynamicModule`/`forRoot`.

### Объявление

Параметризованный модуль — это функция, которая возвращает модуль:

```typescript
// packages/examples.app-with-http/src/modules/logger/logger.module.ts
export const logging = (options: LoggingOptions): Module =>
  makeModule({
    name: 'module:logging',
    providers: [
      factoryProvider(
        ILogger,
        (config: Config<typeof LoggerConfig>) =>
          new ConsoleLogger(options.service, config.level),
        [LoggerConfig],
      ),
      AuditOutcome,          // юнит слоя регистрируется вместе с модулем
    ],
    exports: [ILogger],
  });
```

### Одно значение на приложение

Вызовите фабрику один раз и импортируйте полученное значение везде, где оно
нужно:

```typescript
// packages/examples.app-with-http/src/infrastructure.ts
export const appLogging = logging({ service: 'app-with-http' });

// packages/examples.app-with-http/src/users.module.ts
export const UsersModule = makeAppModule({
  name: 'module:users',
  imports: [appLogging],       // инфраструктура подключается вместе с фичей
  /* ... */
});
```

Повторный вызов `logging({ … })` даёт другое значение с тем же именем, и
сборка на этом падает:

```
Two different modules are named 'module:logging'. A module name is the
attribution key of its providers, exports and endpoints, so it must be
unique. Either share one module value between its consumers (create it once
and import that value), or give the two configurations different names. If
neither is the case, check for a duplicated package in your dependencies -
two copies give two values of the same module.
```

Опции модулей структурно не сравниваются: два вызова с одинаковыми опциями
— это два разных модуля.

### Параметр или секция конфига

Параметр функции — решение composition root: какие провайдеры существуют,
какая реализация выбрана, как назван экземпляр. Всё, что меняется без
пересборки образа (адреса, уровни, таймауты), живёт в конфиг-секции. Модуль
объявляет секцию сам и экспортирует наружу только `.keys`:

```typescript
// packages/examples.app-with-http/src/modules/logger/logger.config.ts
export const LoggerConfig = makeConfig('log', {
  level: z.enum(['debug', 'info', 'error']).default('info'),  // LOG_LEVEL
});

export const loggerConfigKeys = LoggerConfig.keys;
```

### Требование к окружению

Если инфраструктурному модулю нужен, например, HTTP-транспорт, он инжектит
его токен как обычную зависимость. Невыполненное требование падает на фазе
ASSEMBLE как неудовлетворённая зависимость. Отдельного механизма «только
для этих транспортов» нет.

### Слой для всех endpoint'ов

Инфраструктурный модуль экспортирует слой пайплайна как значение,
endpoint'ы подключают его явно через `pipeline:`, а политика в корне
требует его от всех endpoint'ов (раздел «Инварианты сборки: `policies`»
ниже). Невидимого middleware, который добавлял бы слой ко всем endpoint'ам
автоматически, нет.

### Область действия

Модуль, импортированный фичей, попадает в граф вместе с ней и не попадает,
если фича не выбрана — даже когда его файлы импортированы процессом. Две
фичи в одном процессе, импортирующие одно значение модуля, получают один
экземпляр; при разнесении по процессам у каждого процесса будет свой.
Инфраструктура для всего процесса объявляется в `modules:` корня.
«Глобальность» здесь означает только наличие провайдера в графе:
инжектировать его сможет лишь тот, кто импортировал токен.

```typescript
// packages/examples.app-with-http/src/app.spec.ts
await using app = await assembleTest({ ...spec, select: 'ops' });

expect(app.get(ILogger)).not.toBeNull();   // ops импортирует логирование
expect(app.get(ActivityHub)).toBeNull();   // users не выбрана — её провайдеров нет
```

### Доступ к составу приложения

Модуль может инжектировать `Discovery$` — результат discovery, который
`assemble` регистрирует как значение. Это единственный способ увидеть
выбранную топологию целиком, не дублируя `select` в корне.

```typescript
factoryProvider(Report$, (discovery) => summarize(discovery.endpoints), [Discovery$])
```

Значение доступно только для чтения: через него можно посмотреть состав
приложения, но не изменить его. Состав определяется деревом модулей.
Первый потребитель `Discovery$` — модуль документации
([openapi.md](./openapi.md)).

## Фазы жизненного цикла

`app.run()` проводит приложение по фазам:

| Фаза | Что происходит |
|---|---|
| 0 BOOTSTRAP | `load(section)` в корне: `select` вычисляется до создания контейнера |
| 1 ASSEMBLE | разбор `select` → дерево модулей → discovery → `build()` → проверка транспортов и форм io → проверка `policies:` |
| 2 INIT | `@OnInit` в топологическом порядке; `dispatch` ещё не существует |
| 3 WIRE | декларации получают зависимости из контейнера; для каждого транспорта создаётся `dispatch` |
| 4 START | `@OnStart` в топологическом порядке, затем `serve(dispatch, signal)` |
| 5 RUN | приложение обслуживает запросы |
| 6 SHUTDOWN | `abort(signal)` → `close()` транспортов в обратном порядке → `@OnDestroy` |

Фазы 0 и 1 проверяют всё, что может не сойтись: невалидный конфиг,
отсутствующий транспорт, форму io, которую транспорт не поддерживает,
незарегистрированную зависимость endpoint'а. Любая из этих ошибок
останавливает запуск до того, как приложение займёт хоть один ресурс:
провайдер, который открывает соединение в `@OnInit`, до `@OnInit` не
дойдёт.

### Хук `@OnStart`

`@OnStart` — третий хук контейнера рядом с `@OnInit` и `@OnDestroy`.
Разница в том, что видит хук: `@OnInit` вызывается, когда готовы
зависимости этого узла, а `@OnStart` — когда весь граф уже создан,
инициализирован и связан. Здесь запускают планировщики, консьюмеры
очередей и подписки.

```typescript
// packages/examples.simple-app/src/demo.ts (сокращено)
@Injectable([
  UserService,
  IDatabase,
  IApiClient,
  ILogger('app'),
  AppService,
  HealthService,
  AppConfig,
])
export class Demo {
  constructor(
    private readonly users: UserService,
    private readonly database: IDatabase,
    private readonly api: IApiClient,
    private readonly logger: ILogger,
    /* ... */
  ) {}

  @OnStart()
  async show(): Promise<void> {
    await this.database.connect();
    this.logger.log('Users:', await this.users.getUsers());
    /* ... */
  }
}
```

Хуки `@OnStart` выполняются в топологическом порядке (зависимости раньше
зависимых) и ровно один раз на экземпляр. Повторный вызов `run()` их не
повторяет.

### Что получает транспорт

Транспорт начинает принимать запросы в единственном методе —
`serve(dispatch, signal)`. Метода `listen()` без аргументов у транспорта
нет, как нет и метода регистрации отдельного endpoint'а. Всё, что нужно
для обслуживания запросов, приходит одним объектом `dispatch`:

- `dispatch.routes` — описания endpoint'ов: паттерн, формы io, bind-карта,
  объявленные отказы. Полей `handle` и `pipeline` в них нет;
- `dispatch.call(pattern, ctx, options?)` — выполнение endpoint'а.

`dispatch` создаётся на фазе WIRE и в контейнере не регистрируется,
поэтому инжектировать его нельзя. Транспорт, который открыл бы сокет в
`@OnInit`, не смог бы обслужить ни одного запроса: у него ещё нет ни
маршрутов, ни функции вызова.

### Остановка

`app.close()` выполняет фазу SHUTDOWN в порядке, обратном START. Сначала
срабатывает `signal`, переданный транспортам: новые запросы не
принимаются, текущие отменяются через `AbortSignal`. Затем вызывается
`close()` транспортов в обратном порядке; транспорт дожидается завершения
открытых соединений. После этого `container.destroy()` вызывает
`@OnDestroy` в обратном топологическом порядке.

`run()` ставит обработчики `SIGTERM` и `SIGINT`, которые переводят
приложение в SHUTDOWN, и снимает их по завершении `close()`. Оба метода
идемпотентны.

На старте приложение печатает одну строку с составом сборки. Если есть
endpoint'ы, выведенные из-под политик, за ней идёт по строке на каждый:

```
[nestling] features: users, ops, quotas; transports: http, bus
[nestling] detached from policies: GET /health (http) — liveness-проба балансировщика: строка аудита на каждый удар — шум, а не наблюдаемость
```

## Инварианты сборки: `policies`

Пайплайн объявляется в каждом endpoint'е отдельно, и типы не заметят
забытый слой: хендлер, который не читает `identity`, одинаково корректен и
с auth-слоем, и без него. Политика закрывает эту дыру: инвариант
объявляется значением в корне и проверяется на собранном графе.

```typescript
// packages/examples.app-with-http/src/main.ts (сокращено)
import { everyEndpoint, RequestId } from '@nestling/pipeline';
import { http, HttpTransport$ } from '@nestling/transport.http';

import { observability } from './modules/logger';

const app = assemble({
  features: [UsersFeature, OpsFeature, QuotasFeature],
  select: cfg.features,
  transports: [http({ port: 3000 })],
  policies: [
    everyEndpoint({ transport: HttpTransport$ }).hasLayer(
      observability,
      'observability',
    ),
    everyEndpoint({ transport: HttpTransport$ }).hasVar(
      RequestId,
      'requestId',
    ),
  ],
});
```

`everyEndpoint(filter)` выбирает endpoint'ы по двум необязательным полям.
`transport` — токен транспорта (`HttpTransport$`, а не провайдер `http()`).
`pattern` — регулярное выражение, которое проверяется по строке паттерна
(например, `'GET /api/users'`). Если заданы оба поля, endpoint должен
подходить под оба; пустой фильтр выбирает все endpoint'ы приложения.

`hasLayer(layer, label?)` требует, чтобы пайплайн endpoint'а был составлен
из переданного слоя. Сравнение идёт по ссылке: копия слоя с тем же
содержимым из соседнего файла политику не удовлетворяет. Если политика
требует `authedBase`, ей удовлетворяют `compose(base, authedBase)`,
`compose(compose(base, authedBase), extra)` и
`authedBase.pre(withTenant())`. Второй аргумент — метка для текста ошибки;
имя слоя из переменной не выводится.

`hasVar(variable, label?)` требует, чтобы пайплайн endpoint'а объявлял
контекстную переменную юнитом вида `<Var>.provide(…)`. Так защищается
чтение `Ctx(RequestId)` из глубины графа, где типов входа уже нет.
Сравнение переменных тоже идёт по ссылке.

### Сообщение о нарушении

Политики проверяются последними на фазе ASSEMBLE: после проверки
транспортов и форм io и до `@OnInit`. К этому моменту не занят ни один
ресурс и не открыт ни один сокет. Проверяются сразу все политики, поэтому
сообщение перечисляет все нарушения за один запуск:

```
2 endpoint violation(s) of assembly policies:

policy: every endpoint (transport 'http') has layer 'observability'
  - GET /api/users (http, module 'module:users'): its pipeline is not composed from layer 'observability'
  - GET /metrics (http, module 'module:ops'): it declares no pipeline, so it cannot be composed from layer 'observability'

Fix each handle by composing the required layer into its 'pipeline:', or opt
out deliberately with detached: '<reason>' in its declaration.
```

Endpoint без `pipeline` — тоже нарушение. Для инварианта «endpoint
защищён» отсутствие пайплайна и отсутствие слоя означают одно и то же.

### Исключение из политик: `detached`

Endpoint, которому инвариант действительно мешает, помечается причиной
прямо в декларации:

```typescript
// packages/examples.app-with-http/src/modules/ops/health.endpoint.ts (сокращено)
export const Health = httpEndpoint({
  method: 'GET',
  path: '/health',
  output: HealthOutput,
  detached:
    'liveness-проба балансировщика: строка аудита на каждый удар — шум, а не наблюдаемость',
  handle: async () => new Ok({ status: 'up' }),
});
```

Три правила:

- причина обязательна: тип поля — `string`, поэтому `detached: true` не
  скомпилируется, а пустая строка отклоняется при создании декларации;
- исключение действует на все политики приложения сразу: привязать
  `detached` к одной политике нельзя;
- исключение видно: `App` печатает список помеченных endpoint'ов на старте,
  а `check()` возвращает их в отчёте, так что тест сравнивает значения, а
  не разбирает вывод.

```typescript
// packages/examples.app-with-http/src/app.spec.ts
const [{ report }] = await checkTopologies(spec, ['all']);

expect(
  report.endpoints
    .filter(({ detached }) => detached !== undefined)
    .map(({ pattern, detached }) => ({ pattern, detached })),
).toEqual([
  {
    pattern: 'GET /health',
    detached:
      'liveness-проба балансировщика: строка аудита на каждый удар — шум, а не наблюдаемость',
  },
]);
```

Политики проверяются везде, где строится граф: в `run()`, в `check()` (а
значит, и в `checkTopologies` для каждой топологии) и в `assembleTest`.
Тестовая сборка их не ослабляет.

### ESLint-правило `endpoint-has-layer`

`@nestling/eslint-plugin` даёт правило `endpoint-has-layer`. Оно
подсвечивает декларацию без нужного слоя прямо в редакторе:

```javascript
// packages/examples.app-with-http/eslint.config.js
import nestling from '@nestling/eslint-plugin';

export default [
  ...base,
  {
    files: ['src/**/*.ts'],
    plugins: { '@nestling': nestling },
    rules: {
      '@nestling/endpoint-has-layer': [
        'warn',
        { layer: 'observability', constructorName: 'httpEndpoint' },
      ],
    },
  },
];
```

Правило — подсказка, а не гарантия. Оно синтаксическое: видит только явные
случаи в том же файле и молчит, если значение пайплайна непрозрачно —
пришло параметром фабрики, вернулось из другой функции, импортировано или
спрятано за spread. Гарантию даёт политика на собранном графе, поэтому
рекомендуемый уровень правила — `warn`.

## Standalone: транспорт без `App`

Тот же `dispatch` можно собрать вручную. Декларации при этом должны быть
исполнимыми, то есть без `deps` (`TNeeds = never`): декларацию с
неразрешёнными зависимостями `makeDispatch` не примет на уровне типов.

```typescript
// packages/examples.simple-http-server/src/main.ts (сокращено)
const server = new HttpTransport({ port: PORT });
const dispatch = makeDispatch([
  SayHello,
  CreateUser,
  SearchUsers,
  StreamLogs,
  ExportLogs,
  UploadReport,
]);
const shutdown = new AbortController();

await server.serve(dispatch, shutdown.signal);

// остановка: сигнал отменяет текущие запросы, close() ждёт закрытия соединений
shutdown.abort();
await server.close();
```

Транспорт, запущенный на порту `0`, сообщает фактический адрес методом
`address()`. До `serve` и после `close()` метод возвращает `null`.
