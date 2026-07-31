# Конфигурация

> Гайд по **текущему API**; сверено с кодом `examples.simple-app` (2026-07-31).

Конфигурация в Nestling — не сервис и не модуль, а **секция**: рекорд полей со
схемами. Объявление секции есть значение; узел графа появляется ровно тогда,
когда кто-то секцию инжектит. Регистрировать её негде — ни `providers:`,
ни `imports:`, ни ключа `configs:` у модуля не существует.

## Объявление секции

```typescript
// packages/examples.simple-app/src/config/app.config.ts
import { from, makeConfig } from '@nestling/config';
import { z } from 'zod';

export const AppConfig = makeConfig('app', {
  databaseUrl: from(
    'DATABASE_URL',
    z.url().default('postgresql://localhost:5432/myapp'),
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

`describeConfig()` отдаёт снимок реестра: секции, их ключи, флаг `reloadable`,
признак «потреблена графом» и объявленные глобы. Без значений и без сети —
снимок пригоден для генерации документации на этапе сборки артефактов.

## Тестовый источник

`objectSource(record, name)` — источник поверх обычного объекта, с `watch` и
`set`/`assign` для проверки reloadable. Ни файлов, ни сети:

```typescript
const source = objectSource({ RUNTIME_RPS: '10' }, 'test');
source.set('RUNTIME_RPS', '20'); // reloadable-секция перепроецируется
```

Готовые источники (файл, волт) живут пакетами поверх `ConfigSource`; в ядре
только интерфейс, env-пол и этот объектный источник.
