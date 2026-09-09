# 23. Конфиг из файла и без перезапуска

> Гайд по текущему API; сверено с кодом `container` (2026-09-09).
> Целевое описание: [design/config.md](../design/config.md), разделы 2–8.
> Почему так: записи [ideas.md](../decisions/ideas.md) «Конфиг:
> keys-capability вместо `configs:`-владения» [2026-07-10], «Конфиг:
> `secret()` и общие ключи» [2026-07-13] и «Конфиг: `derived`,
> `env({ prefix })`, описания полей через конвертеры» [2026-09-06].

Часть значений в проде приходит не из окружения: из файла, из Vault, из
объекта с умолчаниями для локального запуска. Один ключ, например
`DATABASE_URL`, читают две секции. Лимит запросов нужно менять на ходу,
не перезапуская процесс.

Объявление секции, вывод ключей, `secret()` и остановка старта на
невалидном конфиге описаны в главе [7](./07-config.md). Здесь только то,
что появляется сверх этого.

## Источник, привязанный к ключам секции

```typescript
// examples/container/src/main.ts
const app = makeApp({
  features: [AppFeature],
  plugins: [appCounters],
  providers: [Demo],
  config: [
    [objectSource({ APP_METRICS_PREFIX: 'demo' }, 'defaults'), appConfigKeys],
    [objectSource({ RUNTIME_RPS: '50' }, 'runtime'), runtimeConfigKeys],
  ],
}).assemble();

await app.run();
await app.close();
```

Поле `config` принимает список пар «источник, цель». Источник — объект с
интерфейсом `ConfigSource`: обязательный метод `get(key)` и необязательные
`name`, `init()`, `watch(notify)` и `close()`. Цель — `.keys` секции, глоб
вида `'*_URL'` или массив из них. В примере источником служит
`objectSource`, объект поверх обычной записи. Источник файла или Vault
реализует тот же интерфейс в отдельном пакете; в ядре готовых источников
нет.

Правила чтения:

- порядок списка задаёт приоритет: ключ берётся из первой привязки, чья
  цель покрывает ключ и чей источник вернул не `undefined`;
- цель ограничивает область источника: `objectSource` из первой строки
  привязан к ключам секции `app` и для других секций не опрашивается.
  Цель, не покрывающая ни одного объявленного ключа, даёт предупреждение
  на старте: так ловится опечатка в глобе;
- `process.env` опрашивается последним и всегда; в список его не
  добавляют. `DATABASE_URL` в примере нигде не привязан и читается из
  окружения;
- ключ, которого нет ни в одном источнике, читается как `undefined`, а
  дальше решает схема поля: `.default()`, `.optional()` или ошибка
  валидации.

Невалидный конфиг останавливает старт до открытия сокета:
`ConfigValidationError` перечисляет все ошибки секции и то, из каких
источников читалось каждое значение.

Тот же список принимает `bootstrapConfig()` при сборке контейнера без
`makeApp`, через `ContainerBuilder`:

```typescript
// examples/container/src/container.ts
export const makeContainer = async (
  runtime: ConfigSource = objectSource({}, 'runtime'),
): Promise<BuiltContainer> => {
  const config = await bootstrapConfig([
    [objectSource({ APP_METRICS_PREFIX: 'demo' }, 'defaults'), appConfigKeys],
    [runtime, runtimeConfigKeys],
  ]);

  const builder = new ContainerBuilder()
    .register(configKernel(config))
    // Корневой логгер живёт вне графа: `makeApp` создаёт его на фазе 0 и
    // регистрирует значением сам, здесь это делает вызывающий код
    .register(valueProvider(RootLogger$, makeKernelLogger(config)))
    // Kernel-модули, которые `assemble` регистрирует сам: логгер ядра читает
    // секцию `nestlingLog` и идентификатор запроса из контекста
    .register(contextKernel(), loggerKernel())
    // Веток переключателей у примера нет, поэтому карта значений пуста
    .register(...resolveBranches(appCounters.modules, {}))
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
регистрирует сама сборка. Плагин `appCounters` регистрируется своими
модулями. В списке `modules` могут стоять ветки переключателей, поэтому его
раскрывает `resolveBranches(modules, values)`: у примера веток нет, и карта
значений пуста. Пробы подключает `registerHealth`: узел `Health$` собирается
и без `makeApp`, а фазу ему называет вызывающий код
([глава 24](./24-ops.md)).

## Один `.env` на несколько сервисов

Один файл окружения обслуживает несколько сервисов, если каждый читает
свои значения под своей приставкой. Приставку задаёт источник `env`:

```typescript
config: [[env({ prefix: 'SERVICE_1_' }), '*']],
```

Источник читает `SERVICE_1_<KEY>` и отдаёт значение под именем `KEY`.
Приоритет он получает по позиции привязки, как любой другой источник,
поэтому `SERVICE_1_HTTP_PORT` перекрывает `HTTP_PORT`. Ключ, которого под
приставкой нет, читается неявным `process.env` без неё: `DATABASE_URL`
остаётся общим для всех сервисов.

Секции про приставку не знают. `.keys` перечисляет `HTTP_PORT` и
`HTTP_HOST`, снимок реестра называет те же имена, и глоб привязки тоже
пишется без приставки. Приставка живёт в источнике, и только там.

## Право привязки вместо секции

```typescript
// examples/container/src/config/app.config.ts
export const AppConfig = makeConfig('app', {
  metricsPrefix: z.string().min(1).default('app'),
  databaseUrl: secret(
    from('DATABASE_URL', z.url().default('postgresql://localhost:5432/myapp')),
  ),
});

export const appConfigKeys = AppConfig.keys;
```

```typescript
// examples/container/src/config/index.ts
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
// examples/container/src/health/health.config.ts
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
// examples/container/src/config/secrets.spec.ts (фрагмент)
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
конвертер схем — тот же `zodConverter` из `@nestling/openapi.zod`, что
строит документ OpenAPI в главе [12](./12-openapi-and-client.md):

```typescript
import { zodConverter } from '@nestling/openapi.zod';

const snapshot = describeConfig({ converters: [zodConverter()] });

snapshot.sections[0].keys[0].schema;
// { outcome: 'converted', vendor: 'zod', json: { description: '…', default: 20 } }
```

Описание ключа несёт JSON Schema его листа и исход конвертации. Исходов
три: `declared` — схему объявили аннотацией, `converted` — её получил
конвертер, `unconvertible` — конвертера для этого вендора в списке нет.
Последний отличает «конвертер не передали» от «описания у поля нет».
Описание, умолчание и перечисление лежат полями самой схемы:
`description`, `default` и `enum`.

Из этого снимка собирается таблица переменных для документации по
развёртыванию. Markdown, колонки и порядок строк выбирает тот, кто пишет
документацию: фреймворк отдаёт данные и на этом останавливается. Без
`converters` снимок остаётся прежним — поля `schema` в нём нет.

## Значения без перезапуска

```typescript
// examples/container/src/runtime/runtime.config.ts
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
// examples/container/src/runtime/rate-limiter.ts
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

Обновления приходят от источника с методом `watch()`. У `objectSource`
он есть: вызов `set(key, value)` уведомляет читалку. Два отличия от
старта:

- невалидное значение на старте останавливает приложение; невалидное
  обновление отбрасывается, остаётся последний валидный снимок, а читалка
  пишет предупреждение с префиксом `[nestling/config]`;
- reloadable-секция, ключи которой покрыты только источниками без
  `watch()`, поднимается и предупреждает при старте: обновлений не будет.

## Вычисляемое поле при перезагрузке

Вычисляемое поле секции описано в главе [7](./07-config.md). У
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
// examples/container/src/runtime/reload.spec.ts
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
yarn workspace @examples/container start:dev
yarn workspace @examples/container test
```

Эксплуатационные endpoint'ы: кто сейчас подключён к сервису и как
завершить подписку. Глава [24](./24-ops.md).
