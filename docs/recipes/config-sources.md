# Конфиг из файла и без перезапуска

> Гайд по текущему API; сверено с кодом `5383a51c`.
> Целевое описание: [design/config.md](../design/config.md), разделы 2–8.
> Почему так: записи [ideas.md](../decisions/ideas.md) «Конфиг:
> keys-capability вместо `configs:`-владения» [2026-07-10], «Конфиг:
> `secret()` и общие ключи» [2026-07-13], «Конфиг: `derived`,
> `env({ prefix })`, описания полей через конвертеры» [2026-09-06] и
> «Конфигурация: привязки на `run()`, `env()` и `dotenv()` умолчанием,
> `bind()`, `needs` у источника» [2026-09-13].

Часть значений в проде приходит не из окружения: из файла, из Vault, из
объекта с умолчаниями для локального запуска. Один ключ, например
`DATABASE_URL`, читают две секции. Лимит запросов нужно менять на ходу,
не перезапуская процесс.

Объявление секции, вывод ключей, `secret()` и остановка старта на
невалидном конфиге описаны в главе [7](../guide/07-config.md). Здесь только то,
что появляется сверх этого.

## Источник, привязанный к ключам секции

```typescript
// src/main.ts
const defaults: ConfigSource = {
  name: 'defaults',
  get: (key) => ({ APP_METRICS_PREFIX: 'demo' } as Record<string, string>)[key],
};
const runtime: ConfigSource = {
  name: 'runtime',
  get: (key) => ({ RUNTIME_RPS: '50' } as Record<string, string>)[key],
};

const app = makeApp({
  features: [AppFeature],
  plugins: [counters],
  providers: [Demo],
}).build();

await app.run({
  config: [
    bind(defaults, { keys: appConfigKeys }),
    bind(runtime, { keys: runtimeConfigKeys }),
    bind(env()),
  ],
});
await app.close();
```

Опция `config` у `run()` принимает список привязок `bind(source, options?)`.
Источник — объект с интерфейсом `ConfigSource`: обязательный метод
`get(key)` и необязательные `name`, `needs`, `init(values)`,
`watch(notify)` и `close()`. `options.keys` — `.keys` секции или глоб вида
`'*_URL'`, по умолчанию `'*'`. В примере источниками служат `defaults` и
`runtime` — самодельные объекты поверх обычной записи; координат им
неоткуда брать, поэтому `needs` они не объявляют, а `init` пишется без
параметров. Источник файла или Vault реализует тот же интерфейс в
отдельном пакете; в ядре готовых источников с сетью нет.

Правила чтения:

- порядок списка задаёт приоритет: ключ берётся из первой привязки, чья
  `keys` покрывает ключ и чей источник вернул не `undefined`;
- `keys` ограничивает область источника: `defaults` привязан к ключам
  секции `app` и для других секций не опрашивается. Область, не
  покрывающая ни одного объявленного ключа, даёт предупреждение на
  старте: так ловится опечатка в глобе;
- `env()` — источник, как и любой другой: без явной привязки `bind(env())`
  в списке `process.env` не читается вовсе. `DATABASE_URL` в примере не
  покрыт ни `defaults`, ни `runtime`, поэтому его читает `env()`, стоящий
  последним по приоритету;
- ключ, которого не покрыла ни одна привязка, читается как `undefined`, а
  дальше решает схема поля: `.default()`, `.optional()` или ошибка
  валидации.

Невалидный конфиг останавливает старт до открытия сокета:
`ConfigValidationError` перечисляет все ошибки секции и то, из каких
источников читалось каждое значение.

Тот же список принимает `bootstrapConfig()` при сборке контейнера без
`makeApp`, через `ContainerBuilder`:

```typescript
// src/container.ts
export const makeContainer = async (
  runtime: ConfigSource = { name: 'runtime', get: () => undefined },
): Promise<BuiltContainer> => {
  const config = await bootstrapConfig([
    bind(defaults, { keys: appConfigKeys }),
    bind(runtime, { keys: runtimeConfigKeys }),
  ]);

  const builder = new ContainerBuilder()
    .register(configKernel(config))
    // Корневой логгер живёт вне графа: `makeApp` создаёт его на фазе 0 и
    // регистрирует значением сам, здесь это делает вызывающий код
    .register(valueProvider(RootLogger$, makeKernelLogger(config)))
    // Kernel-модули, которые `build` регистрирует сам: логгер ядра читает
    // секцию `nestlingLog` и идентификатор запроса из контекста
    .register(contextKernel(), loggerKernel())
    // Веток переключателей у примера нет, поэтому карта значений пуста
    .register(...resolveBranches(counters.modules, {}))
    .register(AppModule);

  // Пробы — после модулей: узел ядра называет каждый вклад поимённо.
  // Фазы здесь нет вовсе, поэтому её читалка отвечает RUN, как и в
  // тестовом прогоне
  registerHealth(builder, () => 'RUN');

  return builder.build();
};
```

`ContainerBuilder` собирает тот же граф, что `makeApp` в `main.ts` того
же примера, но без фаз приложения и без транспортов. Фазы здесь две и они
разделены явно: `bootstrapConfig` поднимает источники — это единственный
ввод-вывод, — а `build()` собирает граф синхронно. `configKernel(config)`
подключает ядро конфигурации, а `contextKernel()` и `loggerKernel()` —
контекст запроса и логгер ядра. При сборке через `makeApp` все три
регистрирует сама сборка. Плагин `counters` регистрируется своими
модулями. В списке `modules` могут стоять ветки переключателей, поэтому его
раскрывает `resolveBranches(modules, values)`: у примера веток нет, и карта
значений пуста. Пробы подключает `registerHealth`: узел `Health$` собирается
и без `makeApp`, а фазу ему называет вызывающий код (рецепт [«Кто
сейчас подключён и как его отключить»](./ops.md)).

## Источник за координатами другого источника

```typescript
// src/main.ts
import { bind, defaultSources } from '@nestlingjs/app';
import { vault, VaultConfig } from '@nestlingjs/config.vault';

await app.build(argv(process.argv)).run({
  config: [
    bind(vault(VaultConfig, { retries: 2 }), { timeout: 3000 }),
    ...defaultSources,
  ],
});
```

Локально ключи лежат в `.env`, на стенде — в Vault, и переписывать
корень под каждую среду не нужно: `defaultSources` остаётся в списке, а
Vault встаёт перед ним. Адрес и учётные данные самого Vault приходят из `.env`
или из окружения — их называет секция `VaultConfig`, которую источник
объявил полем `needs`.

Два порядка здесь разные, и путать их не нужно:

- **порядок списка — приоритет разрешения ключа.** Vault стоит выше, и
  ключ, который знают и он, и `.env`, разрешается значением Vault;
- **очерёдность подъёма выводится из `needs`.** Vault поднимается
  **после** `env()` и `dotenv('.env')`, потому что они покрывают ключи
  его секции координат. Порядок подъёма уходит в логгер ядра уровнем
  `debug`.

Секция координат проецируется из источников, поднятых раньше, и её
значения фиксируются в снимке. Поэтому сам Vault про `VAULT_ADDR` не
спрашивается, даже когда привязан без `keys`: иначе координаты Vault
искались бы в самом Vault. По той же причине источник, поднявшийся
позже, координат не меняет.

Отказы фазы 0 называют источник:

- координат нет ни в одном поднятом источнике — отказ с перечнем
  недостающих ключей; `bind(vault(VaultConfig), { optional: true })`
  вместо отказа пропускает источник;
- привязки ссылаются друг на друга через `needs` — отказ до первого
  запроса, с цепочкой имён источников; `optional` его не проглатывает;
- секция `needs` объявлена `makeConfig.reloadable` или не объявлена
  вовсе — отказ безусловный: у координат перепроекции нет, а
  несуществующая секция означает неимпортированный модуль.

Приложению с двумя хранилищами секция `VaultConfig` не подойдёт — ключ
один на оба. Тогда оно объявляет свою секцию той же формы и передаёт её
тем же аргументом:

```typescript
const BillingVault = makeConfig('billingVault', {
  addr: z.url(),
  token: secret(z.string()),
  mount: z.string().default('secret'),
  path: z.string(),
});

bind(vault(BillingVault)); // BILLING_VAULT_ADDR, BILLING_VAULT_TOKEN, …
```

Наблюдения у источника нет: секрет читается один раз на фазе 0 и живёт в
снимке, поэтому смена секрета доходит до процесса перезапуском.

## Один `.env` на несколько сервисов

Один файл окружения обслуживает несколько сервисов, если каждый читает
свои значения под своей приставкой. Приставку задаёт источник `env`:

```typescript
config: [bind(env({ prefix: 'SERVICE_1_' })), bind(env())],
```

Источник читает `SERVICE_1_<KEY>` и отдаёт значение под именем `KEY`.
Приоритет он получает по позиции привязки, как любой другой источник,
поэтому `SERVICE_1_HTTP_PORT` перекрывает `HTTP_PORT`. Привязка
`env({ prefix })` ключ без приставки не покрывает: общим он остаётся
только явной второй привязкой без приставки — `bind(env())` последним
элементом списка, — и тогда `DATABASE_URL`, которого нет под
`SERVICE_1_`, читает она.

Секции про приставку не знают. `.keys` перечисляет `HTTP_PORT` и
`HTTP_HOST`, снимок реестра называет те же имена, и глоб привязки тоже
пишется без приставки. Приставка живёт в источнике, и только там.

## Право привязки вместо секции

```typescript
// src/config/app.config.ts
export const AppConfig = makeConfig('app', {
  metricsPrefix: z.string().min(1).default('app'),
  databaseUrl: secret(
    from('DATABASE_URL', z.url().default('postgresql://localhost:5432/myapp')),
  ),
});

export const appConfigKeys = AppConfig.keys;
```

```typescript
// src/config/index.ts
export { appConfigKeys } from './app.config.js';
```

С секцией связаны два права. DI-токен секции даёт право читать её: кто
импортировал `AppConfig`, тот может указать его в `deps`. `AppConfig.keys`
даёт право привязать источник к её ключам и ничего больше: указать `.keys`
в `deps` нельзя, это ошибка компиляции — право привязки не даёт права
читать. Поэтому из папки конфига наружу уходит только `appConfigKeys`, а
DI-токен секции импортируют по прямому пути внутри приложения.

## Общий ключ у двух секций

```typescript
// src/health/health.config.ts
export const HealthConfig = makeConfig('health', {
  databaseUrl: from(
    'DATABASE_URL',
    z.string().default('postgresql://localhost:5432/myapp'),
  ),
});
```

Вторая секция объявляет чтение ключа без ведома первой. Правила общего
ключа:

- каждая секция проверяет сырое значение своей схемой: `app` требует
  `z.url()`, `health` принимает `z.string()`; ошибка у любой из них
  останавливает сборку с именем именно этой секции;
- секретность ключа общая для всех читателей: `app` пометила
  `DATABASE_URL` как `secret()`, поэтому печать `HealthConfig` показывает
  `'***'`, хотя в её объявлении `secret()` нет;
- единственный конфликт двух читателей — разный флаг `reloadable`.
  Объявите `HealthConfig` через `makeConfig.reloadable`, и сборка упадёт с
  `ConfigSharedKeyError`, которая называет ключ, обе секции и обе починки.

Кто читает ключ, показывает `describeConfig()`. Снимок строится по
объявленным секциям и не обращается к источникам:

```typescript
// src/config/secrets.spec.ts (фрагмент)
    const entry = describeConfig().keys.find(
      (item) => item.key === 'DATABASE_URL',
    );

    expect(entry?.secret).toBe(true);
    expect(entry?.readers.map((reader) => reader.section).sort()).toEqual([
      'app',
      'health',
    ]);
```

## Описания полей в снимке

Снимок отдаёт описания, умолчания и перечисления полей, если передать ему
конвертер схем — тот же `zodConverter` из `@nestlingjs/schema.zod`, который
генератор документа из главы [13](../guide/13-openapi-and-client.md)
подставляет умолчанием. Здесь умолчания нет: список остаётся данными
вызывающего, и без него снимок прежний.

```typescript
import { zodConverter } from '@nestlingjs/schema.zod';

const snapshot = describeConfig({ converters: [zodConverter()] });

snapshot.sections[0].keys[0].schema;
// { outcome: 'converted', vendor: 'zod', json: { description: '…', default: 20 } }
```

Описание ключа несёт JSON Schema его листа и исход конвертации. Исходов
три: `declared` — схему объявили аннотацией, `converted` — её получил
конвертер, `unconvertible` — конвертера для этого вендора в списке нет.
Последний отличает «конвертера для этого вендора нет» от «описания у поля
нет». Описание, умолчание и перечисление лежат полями самой схемы:
`description`, `default` и `enum`.

Секции самих пакетов фреймворка приходят исходом `converted`: они написаны
на том же валидаторе, конвертер которого передан списком.

Из этого снимка собирается таблица переменных для документации по
развёртыванию. Markdown, колонки и порядок строк выбирает тот, кто пишет
документацию: фреймворк отдаёт данные и на этом останавливается. Без
`converters` снимок остаётся прежним — поля `schema` в нём нет.

## Значения без перезапуска

```typescript
// src/runtime/runtime.config.ts
export const RuntimeConfig = makeConfig.reloadable('runtime', {
  rps: z.coerce.number().int().positive().default(100),
});

export const runtimeConfigKeys = RuntimeConfig.keys;
```

`makeConfig.reloadable` объявляет секцию, значения которой обновляются на
месте. Объект секции не пересоздаётся: ссылка, полученная в конструкторе,
остаётся рабочей, а чтение поля отдаёт последнее валидное значение. Поле
с именем `onChange` в такой секции запрещено: это имя занято подпиской.

```typescript
// src/runtime/rate-limiter.ts
@Component([RuntimeConfig, Logger$.auto])
export class RateLimiter {
  /** Значения `rps`, пришедшие через `onChange` */
  readonly history: number[] = [];

  constructor(
    private readonly config: Config<typeof RuntimeConfig>,
    private readonly logger: Logger,
  ) {}

  get limit(): number {
    return this.config.rps;
  }

  @OnStart()
  watch(signal: AbortSignal): void {
    this.config.onChange(signal, (next) => {
      this.history.push(next.rps);
      this.logger.info('rate limit changed', { rps: next.rps });
    });
  }
}
```

У потребителя два способа увидеть новое значение. Первый: читать поле при
каждом обращении, как делает `limit`. Подписка для этого не нужна. Второй:
`onChange(signal, callback)`, когда на смену значения нужно отреагировать,
например перестроить ресурс. Подписка снимается, когда взводится `signal`;
хук `@OnStart` получает его аргументом — это тот же канал остановки, что
получают транспорты, поэтому своего `AbortController` держать не нужно.
Значение, скопированное в конструкторе, не обновится, поэтому reloadable
включается для секции явно.

Обновления приходят от источника с методом `watch()`. У `vars()` из
`@nestlingjs/testing` он есть — прогон ниже проверяет reload им же; в
проде так же ведёт себя файловый источник, следящий за файлом. Два
отличия от старта:

- невалидное значение на старте останавливает приложение; невалидное
  обновление отбрасывается, остаётся последний валидный снимок, а читалка
  пишет предупреждение в логгер ядра `nestling:config`;
- reloadable-секция, ключи которой покрыты только источниками без
  `watch()`, поднимается и предупреждает при старте: обновлений не будет.

## Вычисляемое поле при перезагрузке

Вычисляемое поле секции описано в главе [7](../guide/07-config.md). У
reloadable-секции у него есть своё поведение: оно пересчитывается, когда
изменилось значение хотя бы одной зависимости.

```typescript
const RuntimeConfig = makeConfig.reloadable(
  'runtime',
  { rps: z.coerce.number().int().positive().default(100) },
  (derived) => ({ perMinute: derived(['rps'], (rps) => rps * 60) }),
);
```

Обновление `RUNTIME_RPS` даёт новое `perMinute`, и подписчики `onChange`
получают секцию с обоими новыми значениями. Если значения зависимостей
совпали с прежними, функция поля не вызывается вовсе. Сравнение
поверхностное, по идентичности: схема, отдающая новый объект на каждой
проверке, вызывает пересчёт всегда.

Ошибка функции при перезагрузке ведёт себя как невалидное значение ключа:
секция целиком сохраняет последний валидный снимок, подписчики не
вызываются, а читалка пишет предупреждение. На старте та же ошибка
останавливает приложение — это `ConfigDerivedError`, и она называет
секцию, поле и список зависимостей.

## Проверка

Тест собирает контейнер с источником, который потом меняет:

```typescript
// src/runtime/reload.spec.ts
  it('отдаёт новое значение после обновления источника', async () => {
    source.set('RUNTIME_RPS', '20');
    await settle();

    expect(limiter.limit).toBe(20);
    expect(limiter.history).toEqual([20]);
  });

  it('оставляет последнее валидное значение при невалидном обновлении', async () => {
    source.set('RUNTIME_RPS', 'many');
    await settle();

    expect(limiter.limit).toBe(20);
    expect(limiter.history).toEqual([20]);
  });
```

Подписка `onChange` открывается в `@OnStart`, поэтому тест вызывает
`container.start()` после `init()`. Второй тест показывает, что
невалидное обновление не доходит ни до чтения, ни до подписки.

Секреты и общий ключ проверяет `config/secrets.spec.ts`: печать секции
`health` равна `{"databaseUrl":"***"}`, а чтение поля отдаёт настоящий
адрес.

```bash
yarn start:dev
yarn test
```

Эксплуатационные endpoint'ы: кто сейчас подключён к сервису и как
завершить подписку — рецепт [«Кто сейчас подключён и как его
отключить»](./ops.md).
