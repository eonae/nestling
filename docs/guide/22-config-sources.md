# 22. Конфиг из файла и без перезапуска

> Гайд по текущему API; сверено с кодом `container` (2026-09-05).
> Целевое описание: [design/config.md](../design/config.md), разделы 2–6.
> Почему так: записи [ideas.md](../decisions/ideas.md) «Конфиг:
> keys-capability вместо `configs:`-владения» [2026-07-10] и «Конфиг:
> `secret()` и общие ключи» [2026-07-13].

Часть значений в проде приходит не из окружения: из файла, из Vault, из
объекта с умолчаниями для локального запуска. Один ключ, например
`DATABASE_URL`, читают две секции. Лимит запросов нужно менять на ходу,
не перезапуская процесс.

Объявление секции, вывод ключей, `secret()` и остановка старта на
невалидном конфиге описаны в главе [6](./06-config.md). Здесь только то,
что появляется сверх этого.

## Источник, привязанный к ключам секции

```typescript
// examples/container/src/main.ts
const app = makeApp({
  features: [AppFeature],
  plugins: [appLogging],
  providers: [Demo],
  config: [
    [objectSource({ APP_LOG_LEVEL: 'debug' }, 'defaults'), appConfigKeys],
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

Тот же список принимает `configKernel()` при сборке контейнера без
`makeApp`, через `ContainerBuilder`:

```typescript
// examples/container/src/container.ts
export const makeContainer = async (
  runtime: ConfigSource = objectSource({}, 'runtime'),
): Promise<BuiltContainer> => {
  return await new ContainerBuilder()
    .register(
      configKernel([
        [objectSource({ APP_LOG_LEVEL: 'debug' }, 'defaults'), appConfigKeys],
        [runtime, runtimeConfigKeys],
      ]),
    )
    .register(...appLogging.modules)
    .register(AppModule)
    .build();
};
```

`ContainerBuilder` собирает тот же граф, что `makeApp` в `main.ts` того
же примера, но без фаз приложения и без транспортов. `configKernel`
подключает ядро конфигурации, которое при сборке через `makeApp`
регистрирует сама сборка. Плагин логирования регистрируется своими
модулями: `appLogging.modules` — обычный массив значений.

## Право привязки вместо секции

```typescript
// examples/container/src/config/app.config.ts
export const AppConfig = makeConfig('app', {
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
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

С секцией связаны два права. Токен секции даёт право читать её: кто
импортировал `AppConfig`, тот может указать его в `deps`. `AppConfig.keys`
даёт право привязать источник к её ключам и ничего больше: указать `.keys`
в `deps` нельзя, это ошибка компиляции — право привязки не даёт права
читать. Поэтому из папки конфига наружу уходит только `appConfigKeys`, а
токен секции импортируют по прямому пути внутри приложения.

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
@Injectable([RuntimeConfig, Logger.auto])
export class RateLimiter {
  /** Значения `rps`, пришедшие через `onChange` */
  readonly history: number[] = [];

  readonly #unsubscribe = new AbortController();

  constructor(
    private readonly config: Config<typeof RuntimeConfig>,
    private readonly logger: Logger,
  ) {}

  get limit(): number {
    return this.config.rps;
  }

  @OnStart()
  watch(): void {
    this.config.onChange(this.#unsubscribe.signal, (next) => {
      this.history.push(next.rps);
      this.logger.log(`rate limit changed to ${next.rps} rps`);
    });
  }

  @OnDestroy()
  stop(): void {
    this.#unsubscribe.abort();
  }
}
```

У потребителя два способа увидеть новое значение. Первый: читать поле при
каждом обращении, как делает `limit`. Подписка для этого не нужна. Второй:
`onChange(signal, callback)`, когда на смену значения нужно отреагировать,
например перестроить ресурс. Подписка снимается, когда взводится
`signal`; здесь его держит `AbortController`, который `@OnDestroy`
взводит при остановке. Значение, скопированное в конструкторе, не
обновится, поэтому reloadable включается для секции явно.

Обновления приходят от источника с методом `watch()`. У `objectSource`
он есть: вызов `set(key, value)` уведомляет читалку. Два отличия от
старта:

- невалидное значение на старте останавливает приложение; невалидное
  обновление отбрасывается, остаётся последний валидный снимок, а читалка
  пишет предупреждение с префиксом `[nestling/config]`;
- reloadable-секция, ключи которой покрыты только источниками без
  `watch()`, поднимается и предупреждает при старте: обновлений не будет.

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
завершить подписку. Глава [23](./23-ops.md).
