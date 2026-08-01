# Конфигурация

> Гайд по **текущему API**; сверено с кодом `examples.simple-app` (2026-08-01).

Конфигурация в Nestling — не сервис и не модуль, а **секция**: рекорд полей со
схемами. Объявление секции есть значение; узел графа появляется ровно тогда,
когда кто-то секцию инжектит. Регистрировать её негде — ни `providers:`,
ни `imports:`, ни ключа `configs:` у модуля не существует.

## Объявление секции

```typescript
// packages/examples.simple-app/src/config/app.config.ts
import { from, makeConfig, secret } from '@nestling/config';
import { z } from 'zod';

export const AppConfig = makeConfig('app', {
  databaseUrl: secret(
    from('DATABASE_URL', z.url().default('postgresql://localhost:5432/myapp')),
  ),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const appConfigKeys = AppConfig.keys;
```

Имя ключа выводится из префикса: `logLevel` → `APP_LOG_LEVEL`. Правило
детерминированное — разделитель встаёт на границе «строчная или цифра →
прописная» и «прописная → прописная, за которой идёт строчная»:

| Поле | Ключ (префикс `app`) |
|---|---|
| `logLevel` | `APP_LOG_LEVEL` |
| `maxItems` | `APP_MAX_ITEMS` |
| `httpURL` | `APP_HTTP_URL` |
| `s3Bucket` | `APP_S3_BUCKET` |

`from('DATABASE_URL', schema)` отменяет префикс целиком и задаёт **точное**
имя — так объявляют ключ, который читает не только эта секция.
`secret(...)` помечает поле секретным (раздел «[Секреты](#секреты)»); порядок
обёрток единственный: `secret()` снаружи, `from()` внутри.

Лист — любая схема [Standard Schema v1](./../design/schemas.md): zod, valibot,
arktype, что угодно. Пакет не интроспектирует схему и не ветвится по вендору;
перечень полей берётся с уровня JS-объекта.

**Источник в объявлении не называется.** Секция провенанс-слепа: она знает имя
ключа и не знает, откуда придёт значение. «Откуда читать» настраивается только
в корне.

## Инжект

```typescript
// packages/examples.simple-app/src/database/database.service.ts
import { AppConfig } from '../config/app.config';

import type { Config } from '@nestling/config';
import { Injectable } from '@nestling/container';

@Injectable(IDatabase, [AppConfig, ILogger('db')])
export class Database implements IDatabase {
  constructor(config: Config<typeof AppConfig>, logger: ILogger) {}
}
```

`Config<typeof AppConfig>` — объект `{ databaseUrl: string; logLevel: 'debug' |
'info' | 'warn' | 'error' }`: тип каждого поля это **выход** его схемы,
обёртка `from()` для вывода прозрачна. Обращение к несуществующему полю —
ошибка компиляции.

Секция работает и в deps фабричного провайдера, и в рецепте семейства:

```typescript
// packages/examples.simple-app/src/logging/logging.module.ts
familyProvider(ILogger, (scope) =>
  factoryProvider(
    ILogger(scope),
    (config: Config<typeof AppConfig>) => ({
      log: (...args) => console.log(`[${config.logLevel}] Logger:${scope}`, ...args),
    }),
    [AppConfig] as const,
  ),
);
```

Материализованный узел неотличим от обычного: он участвует в проверке циклов,
топологическом порядке инстанцирования, `container.getOrThrow()` и
визуализации. Секция, которую никто не инжектнул, в граф не попадает — её
ключи не читаются и не валидируются.

## Две capability: инжект и привязка

У секции ровно два права, и они разведены:

- **инжект** — сам токен (`AppConfig`). Приватность держится видимостью
  ES-модулей: пакет его не экспортирует, и чужой инжект нельзя даже написать.
  Рантайм-проверок владения нет — нарушение нечем выразить;
- **привязка** — `AppConfig.keys`: branded-хэндл набора ключей. Инжектить им
  нечего (в `deps` он не годится — ошибка компиляции), поэтому экспорт
  безопасен.

```typescript
// packages/examples.simple-app/src/config/index.ts
export { appConfigKeys } from './app.config';
```

## Привязка источников в корне

Источник — объект `ConfigSource { get; init?; watch?; close? }`, не провайдер.
Читает их одна приватная читалка; её токен из пакета не экспортируется.

```typescript
// packages/examples.simple-app/src/container.ts
import { configKernel, objectSource } from '@nestling/config';

await new ContainerBuilder()
  .register(
    configKernel([
      [objectSource({ APP_LOG_LEVEL: 'debug' }, 'defaults'), appConfigKeys],
    ]),
  )
  .register(LoggingModule)
  .register(AppModule)
  .build();
```

Правила чтения:

- **порядок списка = приоритет**: ключ разрешается первой привязкой, чей
  таргет его покрывает и чей источник вернул не-`undefined`;
- **таргет ограничивает область источника**: `objectSource` выше привязан
  хэндлом `appConfigKeys`, значит для ключей других секций он не опрашивается
  вовсе. Таргетом может быть хэндл, глоб (`'*_URL'`, `'*'`) или их массив;
- **`process.env` — неявный пол**: опрашивается последним, объявлять его в
  списке нельзя и не нужно. В примере `DATABASE_URL` в привязках не упомянут
  и приезжает из окружения;
- ключ, которого нет нигде, читается как `undefined` — и дальше решает схема
  поля.

Приложению, которому хватает env, про конфиг в корне писать нечего:

```typescript
const app = assemble({ modules: [UsersModule], transports: [http()] });
```

Kernel-модуль конфига регистрируется **всегда**; поле `config:` функции
`assemble` — та же плоская форма `[[source, target]]`.

Единственное чтение конфига **до** сборки — `load(section)`: синхронное
чтение ключей секции из `process.env` с валидацией и fail-fast, без
контейнера и без привязанных источников. Оно нужно ровно там, где значение
требуется раньше графа, — прежде всего для `select`
([composition.md](./composition.md)):

```typescript
const RootConfig = makeConfig('app', { features: z.string().default('all') });

const cfg = load(RootConfig);   // читает APP_FEATURES из process.env
```

## Fail-fast на старте

Жадный контейнер инстанцирует все потреблённые секции на `build()`, значит
валидация — eager. Поля проверяются **независимо**: отказ одного не прекращает
проверку остальных, и все отказы секции уезжают в одну `ConfigValidationError`
с именами ключей, issues и перечнем опрошенных источников.

```
ConfigValidationError: Config section 'app' is invalid:
  - APP_LOG_LEVEL (field 'logLevel'): Invalid option: expected one of "debug"|"info"|"warn"|"error"
  - DATABASE_URL (field 'databaseUrl'): Invalid URL
Sources consulted, in priority order: defaults, process.env
```

Невалидный конфиг убивает старт **до** того, как транспорт начнёт слушать.
Отсутствие значения отдельным видом отказа не является: читалка отдаёт
`undefined`, а `.default()`/`.optional()` в схеме решают, ошибка это или нет.

## Секреты

`secret(leaf)` помечает поле секретным. Обёртка принимает и схему, и результат
`from()`, и порядок вложения **единственный** — `secret()` снаружи, `from()`
внутри: секретность есть свойство поля, `from()` лишь называет его ключ.

```typescript
export const AppConfig = makeConfig('app', {
  apiToken: secret(z.string()),                            // APP_API_TOKEN
  databaseUrl: secret(from('DATABASE_URL', z.url())),      // DATABASE_URL
});
```

Обратный порядок (`from('KEY', secret(schema))`) не проходит по типам, а если
обойти их приведением — падает в точке объявления с текстом, называющим
секцию, поле и канонический порядок.

Для потребителя не меняется **ничего**: тип поля — по-прежнему `string`,
`Secret<T>` в API нет, валидация та же самая (обёртка в проверке значения не
участвует). Меняется то, что печатает фреймворк. Поверхностей ровно три.

**1. Ошибка валидации.** Сообщения issue'ев секретного поля заменяются на
`<redacted>` — и в тексте, и в объекте `error.failures[].issues`: вендор волен
вставить в своё сообщение полученное значение, а `failures` читает чужой
логгер.

```
ConfigValidationError: Config section 'app' is invalid:
  - DATABASE_URL (field 'databaseUrl'): <redacted>
  - APP_LOG_LEVEL (field 'logLevel'): Invalid option: expected one of "debug"|…
Sources consulted, in priority order: defaults, process.env
```

Имя ключа, имя поля и число отказов остаются всегда. Важное исключение: если
ключ **не задан вовсе**, редактировать нечего — сообщение показывается
целиком, и `Invalid input: expected string, received undefined` вы увидите
как есть. Это самая частая ошибка с секретами, и прятать её незачем.

**2. Печать проекции.** У секции с секретами появляются неперечислимые
`toJSON()` и `nodejs.util.inspect.custom`, отдающие копию с `'***'`:

```typescript
console.log(cfg);              // { databaseUrl: '***', logLevel: 'debug' }
JSON.stringify(cfg);           // {"databaseUrl":"***","logLevel":"debug"}
cfg.databaseUrl;               // 'postgresql://user:hunter2@db:5432/app'
```

Редактируется **печать**, а не значение: чтение поля отдаёт настоящее.
`Object.keys(cfg)` и форма объекта не меняются, а секция без единого
секретного поля не получает этих членов вовсе — её поведение прежнее.

**3. Снимок `describeConfig()`.** Ключ несёт флаг `secret`; значений в снимке
нет и не было.

**Граница гарантии.** Фреймворк отвечает за то, что печатает сам. Спред,
`Object.values` и ваша собственная интерполяция обходят редактирование:

```typescript
console.log({ ...cfg });                       // настоящее значение
logger.log(`connecting to ${cfg.databaseUrl}`); // и здесь тоже
```

Это документированное свойство v1, а не дефект: закрыть его мог бы только
брендированный `Secret<T>` с `.reveal()`, который заражает типы потребителя и
потому отвергнут. В примере `examples.simple-app` видно, как с этим жить: в
лог уходит `new URL(cfg.databaseUrl).host`, а не URL целиком.

## Общие ключи

Один ключ могут читать сколько угодно секций: право читать ключ не означает
владения им. Второй читатель объявляется без ведома первого — ошибки «ключ
уже занят» не существует.

```typescript
// app.config.ts
export const AppConfig = makeConfig('app', {
  databaseUrl: secret(from('DATABASE_URL', z.url())),
});

// health/health.config.ts — тот же ключ, своя схема, без пометки
export const HealthConfig = makeConfig('health', {
  databaseUrl: from('DATABASE_URL', z.string()),
});
```

Правила:

- **валидация независима.** Каждая секция проверяет сырое значение своей
  схемой; две секции законно видят ключ по-разному (`z.url()` и `z.string()`,
  `z.string()` и `z.coerce.number()`). Отказ у любого читателя — fail-fast на
  сборке, с именем именно его секции;
- **секретность считается по объединению.** Хоть одна секция пометила ключ
  `secret()` → ключ секретен везде: печать `HealthConfig` выше редактирована,
  хотя `secret()` в ней не написано. Объединение считается по **объявленным**
  секциям, а не по потреблённым: лишний `'***'` не стоит ничего, недостающий
  стоит утечки;
- **единственный конфликт — несогласованный `reloadable`.** Объявите
  `HealthConfig` через `makeConfig.reloadable`, и сборка упадёт:

```
ConfigSharedKeyError: Config key 'DATABASE_URL' is read by sections with
different 'reloadable' flags:
  - section 'app' (field 'databaseUrl'): not reloadable
  - section 'health' (field 'databaseUrl'): reloadable
A shared key has one value for all its readers, so «the value may change under
your feet» must be agreed by all of them. Fix it either way: declare 'app'
with makeConfig.reloadable, or drop makeConfig.reloadable from 'health'.
```

Проверка живёт в границах **одной сборки** и считает только фактически
материализованные секции: объявление, не попавшее в выбранную топологию,
конфликта не создаёт, а две `build()` в одном процессе независимы.

Кто читает ключ — видно в снимке реестра, по объявленным секциям:

```typescript
describeConfig().keys;
// [{ key: 'DATABASE_URL', secret: true, readers: [
//     { section: 'app',    field: 'databaseUrl', exact: true, reloadable: false, secret: true  },
//     { section: 'health', field: 'databaseUrl', exact: true, reloadable: false, secret: false },
//   ] }]
```

## Reloadable

```typescript
export const Runtime = makeConfig.reloadable('runtime', {
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  rps: z.coerce.number().default(100),
});
```

Проекция такой секции — read-latest: чтение поля отдаёт последнее валидное
значение, подписка для этого не нужна. Инстанс **стабилен**: обновление меняет
значения на месте, уже розданные ссылки остаются валидными.

```typescript
@Injectable([Runtime])
class RateLimiter {
  #bucket = new TokenBucket(100);

  constructor(private cfg: Config<typeof Runtime>) {}

  @OnInit()
  start() {
    this.#bucket.refill(this.cfg.rps);
    this.cfg.onChange(this.signal, (next) => this.#bucket.refill(next.rps));
  }
}
```

`onChange(signal, cb)` построен на `Topic` из `@nestling/streams`; подписка
снимается по взведению `signal`. У обычной секции `onChange` нет — ни в типах,
ни в рантайме.

Две асимметрии, о которых стоит помнить:

- **старт: невалидное значение → процесс не поднимается; reload: невалидное
  значение → keep last-good + warn.** Живой процесс не падает из-за плохого
  горячего значения, и частичное обновление не применяется наполовину —
  снапшот заменяется только целиком;
- **вступит ли изменение в силу — ответственность потребителя.** Read-latest и
  `onChange` — да; значение, скопированное в конструкторе, — нет. Поэтому
  reloadable и сделан opt-in.

Reloadable-секция, чьи ключи не покрыты ни одним источником с `watch`
(например, только env), поднимается штатно — с предупреждением о том, что
обновлений не будет.

## Одиночные ключи и unbound-глобы

Для on-demand-инфраструктуры есть семейство `Config(key)` — сырое значение
ключа без валидации:

```typescript
import { Config, keysGlob } from '@nestling/config';

const addressKey = (server: string) => `${server.toUpperCase()}_GRPC_ADDRESS`;

export const grpcAddressKeys = keysGlob('*_GRPC_ADDRESS');

familyProvider(GrpcClient, (server) => ({
  provide: GrpcClient(server),
  useFactory: (address: unknown) => new Client(String(address)),
  deps: [Config(addressKey(server))],
}));
```

Инжектнул клиента — адрес приехал сам: жадный билдер материализует ровно те
ключи, что упомянуты в `deps`. Пакет инфраструктуры экспортирует свой глоб
симметрично тому, как секция экспортирует `.keys`, и корень привязывает его
к источнику.

## Предупреждения и интроспекция

Читалка сверяет каждый таргет с реестром объявленных ключей и предупреждает о
привязке, не покрывшей ни одного, — опечатка в глобе (`'*_UR'` вместо
`'*_URL'`) иначе молча не привязывала бы ничего. Это именно предупреждение:
глоб легитимно может смотреть на unbound-ключи семейств. Канал подменяем
(`configKernel(bindings, { onWarn })`), по умолчанию — `console.warn` с
префиксом `[nestling/config]`.

`describeConfig()` отдаёт снимок реестра двумя проекциями одних данных:

- `sections` — что читает каждая секция: её ключи (с полем, признаком точного
  имени и эффективным флагом `secret`), `reloadable` и признак «потреблена
  графом»;
- `keys` — кто читает каждый ключ: сам ключ, его эффективная секретность и
  перечень читателей. `readers.length > 1` и означает «ключ общий»;
- `globs` — объявленные unbound-глобы.

Без значений и без сети — снимок пригоден для генерации документации на этапе
сборки артефактов, когда графа ещё не существует. Именно поэтому секретность и
перечень читателей считаются по **объявленным** секциям.

## Тестовый источник

`objectSource(record, name)` — источник поверх обычного объекта, с `watch` и
`set`/`assign` для проверки reloadable. Ни файлов, ни сети:

```typescript
const source = objectSource({ RUNTIME_RPS: '10' }, 'test');
source.set('RUNTIME_RPS', '20'); // reloadable-секция перепроецируется
```

Готовые источники (файл, волт) живут пакетами поверх `ConfigSource`; в ядре
только интерфейс, env-пол и этот объектный источник.
