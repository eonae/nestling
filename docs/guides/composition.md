# Composition root: `assemble`, фичи и фазы

> Гайд по **текущему API**; сверено с кодом `examples.app-with-http` (2026-07-31).

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
export const LoggingFeature = makeFeature({
  name: 'logging',
  modules: [LoggerModule],
});

export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  dependsOn: [LoggingFeature],   // выбрал users → logging приедет сам
});
```

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
  features: [UsersFeature, LoggingFeature],
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
по имени, как в `ContainerBuilder`. Порядок регистрации: kernel-модуль
конфига → `modules:` корня → модули выбранных фич в порядке выбора.

## Фазы жизненного цикла

`app.run()` проводит приложение по фазам:

| Фаза | Что происходит |
|---|---|
| **0 BOOTSTRAP** | `load(section)` в корне: `select` считается до контейнера |
| **1 ASSEMBLE** | резолв выбора → дерево модулей → дискавери → `build()` → сверка транспортов и форм io |
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

На старте печатается одна строка состава сборки:

```
[nestling] features: users, logging; transports: http
```

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
