# Composition root: `assemble`, фичи и фазы

> Гайд по **текущему API**; сверено с кодом `examples.app-with-http` (2026-08-01).

Приложение собирается одной функцией — `assemble`. Публичного конструктора
`App` не существует: `assemble` возвращает уже собранный план, а `App`
остаётся типом результата с двумя методами — `run()` и `close()`.

```typescript
import { assemble } from '@nestling/app';
import { http } from '@nestling/transport.http';

await assemble({
  modules: [OrdersModule],
  transports: [http({ port: 3000 })],
}).run();
```

Каждое поле опционально. Приложение из одного модуля не упоминает ни фичу,
ни `select`, ни конфиг — за них не платишь, пока они не нужны.

## L0 — модули и транспорт

Транспорт — **провайдер**, а не инстанс: `http()` возвращает провайдера,
зависимости которому (порт и хост из конфиг-секции) инжектит контейнер.
Поле `transports:` — сахар регистрации; тот же провайдер легально объявить
в `providers:` любого модуля, в том числе infra-модуля фичи.

```typescript
// packages/examples.app-with-http/src/main.ts
await assemble({
  modules: [UsersModule],
  transports: [http({ port: 3000 })],   // явная опция сильнее HTTP_PORT
}).run();
```

Приоритет значений: явные опции фабрики > конфиг (`HTTP_PORT`, `HTTP_HOST`)
> дефолт транспорта.

Множество транспортов приложения **выводится**, а не конфигурируется:
это токены, на которые ссылаются обнаруженные декларации, плюс токены
провайдеров из `transports:`. Ручка, чей транспорт не зарегистрирован в
графе, роняет старт на фазе ASSEMBLE — тем же fail-fast'ом, что и любая
незарегистрированная зависимость:

```
Transport 'cli' is required by endpoint 'users:list' declared in module
'module:cli', but is not registered in the container. Add it to
'transports:' of assemble({ … }) or to 'providers:' of a module
(for example cli()).
```

## L1 — конфиг

Привязка источников — плоский список `config: [[источник, таргет]]`, где
порядок задаёт приоритет; `process.env` — неявный пол и в списке не
упоминается. Приложению, которому хватает env, писать в корне про конфиг
нечего: kernel-машинерия регистрируется всегда.

```typescript
// packages/examples.simple-app/src/main.ts
await assemble({
  modules: [LoggingModule, AppModule],
  config: [
    [objectSource({ APP_LOG_LEVEL: 'debug' }, 'defaults'), appConfigKeys],
  ],
}).run();
```

Полная модель конфига — [config.md](./config.md).

## L2 — фичи и `select`

Фича — значение: бандл модулей плюс ссылки на фичи, без которых она не
работает. `dependsOn` принимает **значения**, а не имена: глобального
реестра фич нет, и объявление фичи ничего не регистрирует.

```typescript
// packages/examples.app-with-http/src/features.ts
export const OpsFeature = makeFeature({
  name: 'ops',
  modules: [OpsModule],
});

export const QuotasFeature = makeFeature({
  name: 'quotas',
  modules: [QuotasModule],   // владеет контрактом, который зовёт users
});

export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  dependsOn: [OpsFeature, QuotasFeature],   // выбрал users → приедут сами
});
```

`quotas` в `dependsOn` — не вкусовщина: `users` зовёт её контрактом, а
`request` без co-located реализации это ошибка **сборки**
([ports.md](./ports.md)). Топология «users без quotas» падает на ASSEMBLE,
а не на первом запросе.

Выбор подмножества считается **до** сборки — это фаза 0 (BOOTSTRAP), и
единственное пред-сборочное чтение конфига делает `load(section)`:
синхронно, только из `process.env`, привязанные источники в нём не
участвуют.

```typescript
// packages/examples.app-with-http/src/main.ts
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

Формы `select`: `'all'`, `'users,billing'` (пробелы по краям имён
игнорируются) и `['users','billing']`. Если `features` заданы, а `select`
отсутствует — выбраны все.

**Не выбрал фичу — её в приложении нет целиком:** модули не попадают в
контейнер, провайдеры не инстанцируются (следствие жадного контейнера),
эндпоинты не регистрируются ни в одном транспорте — даже если файлы этих
фич импортированы процессом.

Расхождения выбора — ошибка сборки, до построения контейнера: неизвестное
имя (с перечнем доступных), две разные фичи с одинаковым `name`, пустой
выбор (`''`/`[]` — «ничего» пишется отсутствием `features`) и `select` без
`features`. Цикл в `dependsOn` при этом **легален**: поле описывает
необходимость, а не порядок построения, — выбрав одну из взаимно зависимых
фич, получаешь обе.

`modules:` корня и модули выбранных фич совмещаются; дедупликация модулей —
**по значению**, как в `ContainerBuilder`: одно и то же значение, встреченное
несколько раз, регистрируется один раз, а два разных значения с одним `name`
роняют сборку (см. «Инфраструктура: параметризованные модули»). Порядок
регистрации: kernel-модуль конфига → `modules:` корня → модули выбранных фич
в порядке выбора.

## Инфраструктура: параметризованные модули

Отдельного примитива «плагин» в ядре нет: ни типа, ни поля `plugins:` в
корне, ни `DynamicModule`/`forRoot`, ни хука конфигурации. Перечень полей
`assemble` закрыт, и сквозная инфраструктура приезжает в граф теми же
`modules:`/`providers:`, что и всё остальное.

**Как объявить.** Параметризованная инфраструктура — функция, возвращающая
модуль:

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
      AuditOutcome,          // юнит слоя едет вместе с модулем
    ],
    exports: [ILogger],
  });
```

**Где создаётся значение.** Один раз — и дальше разделяется импортом:

```typescript
// packages/examples.app-with-http/src/infrastructure.ts
export const appLogging = logging({ service: 'app-with-http' });

// packages/examples.app-with-http/src/users.module.ts
export const UsersModule = makeAppModule({
  name: 'module:users',
  imports: [appLogging],       // инфраструктура едет вместе с фичей
  /* ... */
});
```

Повторный вызов фабрики — **другое значение под тем же именем**, и сборка на
этом падает:

```
Two different modules are named 'module:logging'. A module name is the
attribution key of its providers and exports, so it must be unique. Either
share one module value between its consumers (create it once and import that
value), or give the two configurations different names. If neither is the
case, check for a duplicated package in your dependencies - two copies give
two values of the same module.
```

Структурного сравнения опций нет: «одинаковые опции — один модуль» требовало
бы обхода произвольных значений в рантайме и превращало бы тихую потерю в
тихое слияние.

**Что параметр, а что секция.** Параметр функции — решение composition root
(какие провайдеры существуют, какая реализация выбрана, как назван инстанс).
Всё, что меняется без пересборки образа — адреса, уровни, таймауты, — живёт
в конфиг-секции, которую модуль объявляет сам и наружу отдаёт только
`.keys`:

```typescript
// packages/examples.app-with-http/src/modules/logger/logger.config.ts
export const LoggerConfig = makeConfig('log', {
  level: z.enum(['debug', 'info', 'error']).default('info'),  // LOG_LEVEL
});

export const loggerConfigKeys = LoggerConfig.keys;
```

**Как выражается требование окружения.** Обычной зависимостью: инфра-модулю
нужен HTTP-транспорт — он инжектит его токен, и невыполненное требование
падает на ASSEMBLE как неудовлетворённая зависимость. Отдельного механизма
(«только для этих транспортов») не существует.

**Как гарантируется вездесущность слоя.** Инфра-модуль экспортирует
pipeline-слой значением, ручки композируют его явно, а инвариант в корне
требует его от всех — см. «Инварианты сборки: `policies`» ниже. Ambient
middleware, который навесил бы слой невидимо, в ядре нет.

**Feature-scoped против ambient.** Импортировала фича — приедет вместе с ней
и уедет, если фича не выбрана, даже когда её файлы импортированы процессом.
Две co-located фичи, импортирующие одно значение, делят один инстанс; при
разнесении по процессам каждый получает свой. Процесс-глобальная
инфраструктура объявляется в `modules:` корня — и «глобальность» означает
ровно наличие провайдера в графе: инжектнуть его сможет лишь тот, кто
импортировал токен.

```typescript
// packages/examples.app-with-http/src/app.spec.ts
await using app = await assembleTest({ ...spec, select: 'ops' });

expect(app.get(ILogger)).toBeNull();   // фичу не выбрали — инфры нет
```

**Инфраструктура, которой нужен состав приложения.** Модуль вправе
инжектировать `Discovery$` — результат дискавери, зарегистрированный
`assemble` значением. Это единственный способ увидеть **выбранную**
топологию целиком, не дублируя `select` в корне: два списка разъехались бы,
и заметить это было бы нечем.

```typescript
factoryProvider(Report$, (discovery) => summarize(discovery.endpoints), [Discovery$])
```

Значение read-only: инжектируемая дискавери это поверхность интроспекции, а
не точка расширения — состав приложения определяется деревом модулей, а не
графом. Первый её потребитель — модуль документации
([openapi.md](./openapi.md)).

## Фазы жизненного цикла

`app.run()` проводит приложение по фазам:

| Фаза | Что происходит |
|---|---|
| **0 BOOTSTRAP** | `load(section)` в корне: `select` считается до контейнера |
| **1 ASSEMBLE** | резолв выбора → дерево модулей → дискавери → `build()` → сверка транспортов и форм io → проверка `policies:` |
| **2 INIT** | `@OnInit` по топосорту; `dispatch` ещё не существует |
| **3 WIRE** | гашение зависимостей деклараций, `dispatch` на каждый транспорт |
| **4 START** | `@OnStart` по топосорту, затем `serve(dispatch, signal)` |
| **5 RUN** | приложение обслуживает запросы |
| **6 SHUTDOWN** | `abort(signal)` → `close()` транспортов в реверсе → `@OnDestroy` |

Фазы 0 и 1 — fail-fast: всё, что может не сойтись (невалидный конфиг,
отсутствующий транспорт, форма вне способностей, незарегистрированная
зависимость ручки), падает **до** захвата ресурсов. Провайдер, открывающий
соединение в `@OnInit`, его не откроет.

### `@OnStart` — хук фазы START

Третий хук контейнера рядом с `@OnInit`/`@OnDestroy`. Отличие в том, **что
он видит**: `@OnInit` вызывается, когда готовы зависимости узла, а
`@OnStart` — когда проинициализирован и связан весь граф. Это место для
планировщиков, консьюмеров и подписок.

```typescript
// packages/examples.simple-app/src/demo.ts
@Injectable([UserService, IDatabase, ILogger('app')])
export class Demo {
  constructor(
    private readonly users: UserService,
    private readonly database: IDatabase,
    private readonly logger: ILogger,
  ) {}

  @OnStart()
  async show(): Promise<void> {
    await this.database.connect();
    this.logger.log('Users:', await this.users.getUsers());
  }
}
```

Хуки `@OnStart` выполняются по топосорту (зависимости раньше зависимых) и
ровно один раз на инстанс; повторный `run()` их не повторяет.

### Почему транспорт не может уйти в эфир раньше времени

Go-live — единственный метод `serve(dispatch, signal)`. Нульарного
`listen()` в контракте транспорта нет, как нет и метода регистрации
отдельной ручки. Всё, чем транспорт обслуживает запросы, приезжает одним
объектом:

- `dispatch.routes` — проекции деклараций (паттерн, формы io, bind-карта,
  объявленные отказы). `handle` и `pipeline` в них отсутствуют;
- `dispatch.call(pattern, ctx, options?)` — исполнение ручки.

`dispatch` рождается в фазе WIRE и не регистрируется в контейнере —
инжектить его нечем. Транспорту, открывшему сокет в `@OnInit`, просто
нечего маршрутизировать: это гарантия состава данных, а не конвенция.

### Остановка

`app.close()` выполняет SHUTDOWN строгим реверсом START: сначала взводится
`signal`, переданный транспортам (новые запросы не принимаются, in-flight
отменяются кооперативно), затем `close()` транспортов в обратном порядке
(дренаж соединений), и только после этого `container.destroy()` с
`@OnDestroy` в реверсе топосорта.

`run()` ставит обработчики `SIGTERM`/`SIGINT`, переводящие приложение в
SHUTDOWN, и снимает их по завершении `close()`. Оба метода идемпотентны.

На старте печатается одна строка состава сборки, а следом — по строке на
каждую ручку, выведенную из-под инвариантов (если такие есть):

```
[nestling] features: users, ops, quotas; transports: http, bus
[nestling] detached from policies: GET /health (http) — liveness-проба балансировщика: строка аудита на каждый удар — шум, а не наблюдаемость
```

## Инварианты сборки: `policies`

Пайплайн объявляется на каждой ручке своим значением, и типы не ловят
забытый слой: хендлер, не использующий `identity`, типобезопасен и с
auth-слоем, и без него. Инвариант объявляется значением в корне и
проверяется на собранном графе:

```typescript
// packages/examples.app-with-http/src/main.ts
import { everyEndpoint } from '@nestling/pipeline';
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
  ],
});
```

`everyEndpoint(filter)` сужает множество ручек двумя опциональными полями:
`transport` — **токен** транспорта (`HttpTransport$`, а не провайдер
`http()`), `pattern` — `RegExp` по строке паттерна (`'GET /api/users'`).
Оба вместе сужают конъюнктивно, пустой фильтр берёт все ручки приложения.

`hasLayer(layer, label?)` требует, чтобы пайплайн ручки **происходил** от
переданного значения-слоя. Идентичность ссылочная: одноимённая копия слоя из
соседнего файла политику не удовлетворит, а `compose(base, authedBase)`,
`compose(compose(base, authedBase), extra)` и `authedBase.pre(withTenant())`
— удовлетворят. Второй аргумент — только метка для текста ошибки: имя слоя
из переменной не выводится.

### Как читать сообщение о нарушении

Проверка идёт последней в фазе ASSEMBLE — после сверки транспортов и форм
io, до `@OnInit`: ни один ресурс не захвачен, ни один сокет не открыт.
Прогоняются все политики сразу, поэтому чинить приходится не по одной ручке
за прогон:

```
2 endpoint violation(s) of assembly policies:

policy: every endpoint (transport 'http') has layer 'observability'
  - GET /api/users (http, module 'module:users'): its pipeline is not composed from layer 'observability'
  - GET /metrics (http, module 'module:ops'): it declares no pipeline, so it cannot be composed from layer 'observability'

Fix each handle by composing the required layer into its 'pipeline:', or opt
out deliberately with detached: '<reason>' in its declaration.
```

Ручка без `pipeline` — нарушение, а не пропуск: для инварианта «ручка
защищена» отсутствие пайплайна и отсутствие слоя неразличимы.

### Когда законен `detached`

Ручка, которой инвариант мешает по делу, помечается причиной прямо в
декларации:

```typescript
// packages/examples.app-with-http/src/modules/ops/health.endpoint.ts
export const Health = httpEndpoint({
  method: 'GET',
  path: '/health',
  output: HealthOutput,
  detached:
    'liveness-проба балансировщика: строка аудита на каждый удар — шум, а не наблюдаемость',
  handle: async () => new Ok({ status: 'up' }),
});
```

Правила ровно три:

- **причина обязательна** — тип поля `string`, поэтому `detached: true`
  невыразим, а пустая строка отвергается в момент создания декларации;
- **opt-out тотален** — помеченная ручка выпадает из **всех** политик
  приложения; адресации политики по имени нет;
- **opt-out виден** — `App` печатает список detached-ручек на старте, а
  `check()` возвращает их значением, поэтому тест сравнивает состав, а не
  парсит вывод:

```typescript
// packages/examples.app-with-http/src/app.spec.ts
const [{ report }] = await checkTopologies(spec, ['all']);

expect(
  report.endpoints
    .filter(({ detached }) => detached !== undefined)
    .map(({ pattern }) => pattern),
).toEqual(['GET /health']);
```

Инварианты проверяются везде, где строится граф: `run()`, `check()` (значит,
и `checkTopologies` по каждой топологии матрицы) и `assembleTest`. Тестовый
корень их не ослабляет.

### ESLint-правило — подсказка, не гарантия

`@nestling/eslint-plugin` даёт правило `endpoint-has-layer`: оно
подсвечивает декларацию в редакторе, пока автор её пишет.

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

Разница с политикой принципиальная. Правило синтаксическое: оно видит только
буквальные случаи в том же файле и **молчит** везде, где значение
непрозрачно — пайплайн приехал параметром фабрики, вернулся из неизвестной
функции, импортирован без локального объявления или спрятан за spread'ом.
Ложное срабатывание на легальном коде хуже пропуска, потому что пропущенный
случай всё равно ловит policy-check. Отсюда и рекомендованный уровень
`warn`: красный CI создавал бы ощущение гарантии, которой у правила нет.

## Standalone: транспорт без `App`

Тот же `dispatch`, только собранный руками. Декларации должны быть
исполнимы (`TNeeds = never`) — декларацию с непогашенными `deps` типы не
пропустят:

```typescript
// packages/examples.simple-http-server/src/main.ts
const server = new HttpTransport({ port: 3000 });
const dispatch = makeDispatch([SayHello, CreateUser, SearchUsers]);
const shutdown = new AbortController();

await server.serve(dispatch, shutdown.signal);

// остановка: сигнал отменяет in-flight, close() дренирует соединения
shutdown.abort();
await server.close();
```

Транспорт, поднятый на порту `0`, сообщает фактический адрес методом
`address()` — до `serve` и после `close()` он возвращает `null`.
