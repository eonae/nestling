# Конфигурация

> Гайд по **текущему API**; сверено с кодом `examples.simple-app` (2026-09-02).

Конфигурация в Nestling описывается секциями. Секция — это объект, где
каждому полю сопоставлена схема. Секцию объявляют как константу и
инжектируют как обычную зависимость. Регистрировать её в модуле не нужно:
у модуля нет ключа `configs:`, а в `providers:` и `dependsOn:` секция не
указывается. Узел графа для секции создаётся при сборке, когда кто-то
упоминает её в `deps`.

## Объявление секции

```typescript
// packages/examples.simple-app/src/config/app.config.ts
import { from, makeConfig, secret } from '@nestling/config';
import { z } from 'zod';

export const AppConfig = makeConfig('app', {
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  databaseUrl: secret(
    from('DATABASE_URL', z.url().default('postgresql://localhost:5432/myapp')),
  ),
});

export const appConfigKeys = AppConfig.keys;
```

`makeConfig(prefix, fields)` принимает префикс и объект полей. Каждое поле
описывается схемой; из схемы выводятся и валидация, и тип значения.

Имя ключа для поля выводится из префикса и имени поля: `logLevel` в секции
`app` читается из `APP_LOG_LEVEL`. Разделитель ставится на границе
«строчная буква или цифра, затем прописная» и «прописная, затем прописная
и строчная»:

| Поле | Ключ (префикс `app`) |
|---|---|
| `logLevel` | `APP_LOG_LEVEL` |
| `maxItems` | `APP_MAX_ITEMS` |
| `httpURL` | `APP_HTTP_URL` |
| `s3Bucket` | `APP_S3_BUCKET` |

`from('DATABASE_URL', schema)` отключает префикс и задаёт точное имя ключа.
Так объявляют ключ, который читает не только эта секция. `secret(...)`
помечает поле секретным (раздел «[Секреты](#секреты)»). Обёртки
вкладываются в одном порядке: `secret()` снаружи, `from()` внутри.

Схемой поля может быть любая схема
[Standard Schema v1](./../design/schemas.md): zod, valibot, arktype.
Пакет не заглядывает внутрь схемы и не зависит от её библиотеки; список
полей он берёт из ключей объекта.

В объявлении секции нет указания, откуда брать значения. Секция знает
только имена ключей. Источники значений настраиваются в composition root
(раздел «Привязка источников в корне»).

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

Укажите токен секции в `deps`, а тип значения опишите как
`Config<typeof AppConfig>`. Для секции выше это
`{ logLevel: 'debug' | 'info' | 'warn' | 'error'; databaseUrl: string }`:
тип каждого поля равен выходному типу его схемы, обёртка `from()` на тип
не влияет. Обращение к полю, которого нет в секции, — ошибка компиляции.

Секция работает и в `deps` фабричного провайдера, и в рецепте семейства
токенов:

```typescript
// packages/examples.simple-app/src/logging/logging.plugin.ts
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

Узел секции ничем не отличается от других узлов графа: он участвует в
проверке циклов и в топологическом порядке создания, его возвращает
`container.getOrThrow()`, он виден в визуализации. Секция, которую никто
не инжектирует, в граф не попадает: её ключи не читаются и не проверяются.

## Два права: инжект и привязка

С секцией связаны два разных права.

- **Инжект** даёт сам токен (`AppConfig`). Чтобы посторонний код не читал
  секцию, не экспортируйте токен из пакета: зависимость, которую нельзя
  импортировать, нельзя и объявить. Проверок владения во время выполнения
  нет.
- **Привязку источника** даёт `AppConfig.keys` — типизированное описание
  набора ключей. В `deps` его указать нельзя (ошибка компиляции), поэтому
  экспортировать его безопасно.

```typescript
// packages/examples.simple-app/src/config/index.ts
export { appConfigKeys } from './app.config';
```

## Привязка источников в корне

```typescript
// packages/examples.simple-app/src/main.ts
import { assemble } from '@nestling/app';
import { objectSource } from '@nestling/config';

const app = assemble({
  features: [AppFeature],
  plugins: [appLogging],
  providers: [Demo],
  config: [
    [objectSource({ APP_LOG_LEVEL: 'debug' }, 'defaults'), appConfigKeys],
  ],
});
```

Поле `config` принимает список пар `[источник, цель]`. Источник — объект
с интерфейсом `ConfigSource { get; name?; init?; watch?; close? }`, не
провайдер. Цель — `.keys` секции, глоб (`'*_URL'`, `'*'`) или массив того
и другого. Значения читает один внутренний читатель; его токен пакет не
экспортирует.

Правила чтения:

- Порядок списка задаёт приоритет. Ключ берётся из первой привязки, чья
  цель покрывает этот ключ и чей источник вернул не `undefined`.
- Цель ограничивает область источника. В примере `objectSource` привязан к
  `appConfigKeys`, поэтому для ключей других секций он не опрашивается.
- `process.env` опрашивается последним и всегда. В список его не
  добавляют. В примере `DATABASE_URL` в привязках не упомянут и читается из
  окружения.
- Ключ, которого нет ни в одном источнике, читается как `undefined`.
  Дальше решает схема поля: `.default()` подставит значение, `.optional()`
  разрешит отсутствие, строгая схема даст ошибку валидации.

Приложению, которому хватает `process.env`, поле `config` не нужно. Модуль
конфига регистрируется в `assemble` всегда:

```typescript
const app = assemble({ features: [UsersFeature], transports: [http()] });
```

Тот же список привязок принимает `configKernel()` — для контейнера без
`assemble`:

```typescript
// packages/examples.simple-app/src/container.ts
import { configKernel, objectSource } from '@nestling/config';

await new ContainerBuilder()
  .register(
    configKernel([
      [objectSource({ APP_LOG_LEVEL: 'debug' }, 'defaults'), appConfigKeys],
    ]),
  )
  // Контейнер используется автономно: единицы слоя приложения ему не
  // нужны, а их модули — обычные значения
  .register(...appLogging.modules)
  .register(AppModule)
  .build();
```

### Чтение до сборки: `load`

```typescript
const RootConfig = makeConfig('app', { features: z.string().default('all') });

const cfg = load(RootConfig);   // читает APP_FEATURES из process.env
```

`load(section)` читает секцию синхронно из `process.env`, без контейнера и
без привязанных источников, с той же валидацией. Используйте его там, где
значение нужно раньше графа, прежде всего для `select`
([composition.md](./composition.md)).

## Fail-fast на старте

Контейнер создаёт все инжектированные секции в `build()`, поэтому и
валидация происходит на сборке. Поля проверяются независимо: ошибка в
одном поле не останавливает проверку остальных. Все ошибки секции
собираются в одну `ConfigValidationError` с именами ключей, сообщениями
схем и списком опрошенных источников:

```
ConfigValidationError: Config section 'app' is invalid:
  - APP_LOG_LEVEL (field 'logLevel'): Invalid option: expected one of "debug"|"info"|"warn"|"error"
  - DATABASE_URL (field 'databaseUrl'): Invalid URL
Sources consulted, in priority order: defaults, process.env
```

Невалидный конфиг останавливает запуск до того, как транспорт начнёт
принимать запросы. Отсутствующее значение само по себе ошибкой не
считается: читатель возвращает `undefined`, а `.default()` или
`.optional()` в схеме решают, допустимо ли это.

## Секреты

```typescript
export const AppConfig = makeConfig('app', {
  apiToken: secret(z.string()),                            // APP_API_TOKEN
  databaseUrl: secret(from('DATABASE_URL', z.url())),      // DATABASE_URL
});
```

`secret(leaf)` помечает поле секретным. Обёртка принимает схему или
результат `from()`. Порядок вложения один: `secret()` снаружи, `from()`
внутри. Обратный порядок (`from('KEY', secret(schema))`) не проходит
проверку типов; если обойти её приведением, объявление упадёт с ошибкой,
в которой названы секция, поле и правильный порядок.

Для кода, который читает секцию, ничего не меняется: тип поля остаётся
`string`, отдельного типа `Secret<T>` нет, валидация та же. Меняется
только то, что печатает фреймворк, — в трёх местах.

**Ошибка валидации.** Сообщения схемы для секретного поля заменяются на
`<redacted>` и в тексте ошибки, и в объекте `error.failures[].issues`.
Библиотека схем может вставить полученное значение в своё сообщение, а
`failures` может прочитать сторонний логгер.

```
ConfigValidationError: Config section 'app' is invalid:
  - APP_LOG_LEVEL (field 'logLevel'): Invalid option: expected one of "debug"|…
  - DATABASE_URL (field 'databaseUrl'): <redacted>
Sources consulted, in priority order: defaults, process.env
```

Имя ключа, имя поля и число ошибок видны всегда. Исключение: если ключ не
задан вовсе, скрывать нечего, и сообщение
`Invalid input: expected string, received undefined` показывается целиком.
Это самая частая ошибка с секретами, и её видно сразу.

Печать секции. У секции с секретами появляются неперечислимые методы
`toJSON()` и `nodejs.util.inspect.custom`. Они возвращают копию, где
секретные поля заменены на `'***'`:

```typescript
console.log(cfg);              // { logLevel: 'debug', databaseUrl: '***' }
JSON.stringify(cfg);           // {"logLevel":"debug","databaseUrl":"***"}
cfg.databaseUrl;               // 'postgresql://user:hunter2@db:5432/app'
```

Скрывается печать, а не значение: чтение поля возвращает настоящую строку.
`Object.keys(cfg)` и форма объекта не меняются. У секции без секретных
полей этих методов нет.

Снимок `describeConfig()`. У ключа есть флаг `secret`; значений в снимке
нет.

Фреймворк скрывает только то, что печатает сам. Спред, `Object.values` и
ваша собственная интерполяция строк показывают настоящее значение:

```typescript
console.log({ ...cfg });                       // настоящее значение
logger.log(`connecting to ${cfg.databaseUrl}`); // и здесь тоже
```

В примере `examples.simple-app` в лог уходит `new URL(cfg.databaseUrl).host`,
а не строка целиком.

## Общие ключи

```typescript
// packages/examples.simple-app/src/config/app.config.ts
export const AppConfig = makeConfig('app', {
  databaseUrl: secret(from('DATABASE_URL', z.url())),
});

// packages/examples.simple-app/src/health/health.config.ts
export const HealthConfig = makeConfig('health', {
  databaseUrl: from('DATABASE_URL', z.string()),
});
```

Один ключ могут читать несколько секций. Вторая секция объявляет ключ без
ведома первой; ошибки «ключ уже занят» нет.

Правила:

- Каждая секция проверяет сырое значение своей схемой. Две секции могут
  видеть один ключ по-разному: `z.url()` и `z.string()`, `z.string()` и
  `z.coerce.number()`. Ошибка у любой из них останавливает сборку с именем
  именно этой секции.
- Секретность ключа общая для всех читателей. Если хотя бы одна секция
  пометила ключ `secret()`, он секретен везде: печать `HealthConfig` выше
  скрывает `databaseUrl`, хотя `secret()` в ней не написан. Секретность
  считается по объявленным секциям, а не по инжектированным.
- Единственный конфликт — разный флаг `reloadable`. Объявите
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

Проверка работает в рамках одной сборки и учитывает только секции, которые
в неё попали. Объявление, не вошедшее в выбранную топологию, конфликта не
создаёт; два `build()` в одном процессе независимы.

Кто читает ключ, показывает снимок реестра:

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

`makeConfig.reloadable` объявляет секцию, значения которой обновляются без
перезапуска приложения. Чтение поля возвращает последнее валидное
значение; подписываться для этого не нужно. Объект секции не
пересоздаётся: обновление меняет значения на месте, и уже розданные ссылки
остаются рабочими.

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

`onChange(signal, cb)` вызывает `cb` при каждом обновлении. Подписка
снимается, когда срабатывает `signal`. Метод построен на `Topic` из
`@nestling/streams`. У обычной секции `onChange` нет ни в типах, ни во
время выполнения.

Два отличия от обычной секции:

- На старте невалидное значение останавливает процесс. При обновлении
  невалидное значение не применяется: секция сохраняет последние валидные
  значения и пишет предупреждение. Обновление применяется только целиком;
  частичного обновления не бывает.
- Вступит ли изменение в силу, зависит от кода, который читает секцию.
  Чтение поля и `onChange` видят новое значение; значение, скопированное в
  конструкторе, — нет. Поэтому reloadable включается для секции явно.

Если ключи reloadable-секции не покрыты ни одним источником с `watch`
(например, только `process.env`), приложение запускается, но пишет
предупреждение: обновлений не будет.

## Одиночные ключи и глобы

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

Семейство `Config(key)` даёт сырое значение одного ключа, без схемы и без
валидации. Оно нужно инфраструктуре, которая создаёт клиентов по
требованию: адрес сервера попадает в граф, как только кто-то инжектирует
клиента, потому что контейнер создаёт при сборке ровно те ключи, что
указаны в `deps`. Пакет инфраструктуры экспортирует глоб своих ключей
(`keysGlob`) так же, как секция экспортирует `.keys`, а корень привязывает
глоб к источнику.

## Предупреждения и интроспекция

Читатель сверяет каждую цель привязки с реестром объявленных ключей. Если
цель не покрывает ни одного ключа, он пишет предупреждение: иначе опечатка
в глобе (`'*_UR'` вместо `'*_URL'`) молча оставила бы привязку без
действия. Это предупреждение, а не ошибка: глоб может быть объявлен для
ключей семейства `Config(key)`, которых в реестре секций нет. По умолчанию
предупреждения идут в `console.warn` с префиксом `[nestling/config]`;
канал меняется опцией `configKernel(bindings, { onWarn })`.

`describeConfig()` возвращает снимок реестра объявлений в двух проекциях:

- `sections` — что читает каждая секция: ключи (имя поля, задано ли имя
  точно через `from()`, итоговый флаг `secret`), флаг `reloadable` и
  признак `consumed` — инжектировал ли секцию кто-нибудь;
- `keys` — кто читает каждый ключ: сам ключ, его итоговая секретность и
  список читателей. Ключ с `readers.length > 1` — общий;
- `globs` — объявленные глобы.

Значений в снимке нет, и источники для него не опрашиваются. Поэтому снимок
подходит для генерации документации при сборке артефактов, когда графа ещё
нет. По той же причине секретность и список читателей считаются по
объявленным секциям.

## Тестовый источник

```typescript
const source = objectSource({ RUNTIME_RPS: '10' }, 'test');
source.set('RUNTIME_RPS', '20'); // reloadable-секция перечитывает значения
```

`objectSource(record, name)` — источник поверх обычного объекта, без файлов
и сети. У него есть `watch`, а также `set` и `assign` для проверки
reloadable-секций в тестах.

Готовые источники (файл, Vault) поставляются отдельными пакетами поверх
интерфейса `ConfigSource`. В ядре есть только интерфейс, `process.env` и
этот объектный источник.
