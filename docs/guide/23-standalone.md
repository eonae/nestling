# 23. Без `assemble`

> Гайд по текущему API; сверено с кодом `examples.simple-http-server` (2026-09-03)
> и `examples.container` (2026-09-03).
> Целевое описание: [design/transports.md](../design/transports.md) §1,
> [design/composition.md](../design/composition.md) §1,
> [design/container.md](../design/container.md). Почему так: записи
> [ideas.md](../decisions/ideas.md) «Жизненный цикл: фазы,
> `@OnStart`, гарантия `dispatch`» и «Token families + модули без
> рантайм-инкапсуляции».

## Задача

Приложение целиком не нужно. Нужно встроить несколько endpoint'ов в
существующий процесс или скрипт, или собрать граф зависимостей без
транспорта, например для экспорта в визуализацию. Оба случая решаются
теми же примитивами, из которых состоит `assemble`.

## Решение

### HTTP-сервер из транспорта и `dispatch`

```typescript
// packages/examples.simple-http-server/src/main.ts
const PORT = Number(process.env.PORT) || 3000;

const server = new HttpTransport({ port: PORT });

// У деклараций нет `deps`, поэтому `makeDispatch` принимает их как есть
const dispatch = makeDispatch([SayHello, CreateUser, ExportLogs]);

// Общий сигнал остановки: после взвода транспорт не принимает новые запросы
const shutdown = new AbortController();

server
  .serve(dispatch, shutdown.signal)
  .then(() => {
    console.log(`HTTP server listening on http://localhost:${PORT}`);
  })
  .catch((error: unknown) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });

// Остановка: сигнал отменяет выполняющиеся запросы, `close()` ждёт соединения
const stop = async (signal: string): Promise<void> => {
  console.log(`${signal} received, shutting down`);
  shutdown.abort();
  await server.close();
  process.exit(0);
};

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
```

Три шага, которые `assemble` делает на фазах WIRE и START, здесь написаны
руками. `makeDispatch` строит таблицу «паттерн, хендлер» из деклараций.
`serve(dispatch, signal)` открывает сокет и начинает принимать запросы.
Остановку по сигналу процесса корень вешает сам: сигнал прерывает
выполняющиеся запросы, `close()` ждёт закрытия соединений.

`makeDispatch` принимает только декларации без `deps`, класс-хендлеров
и классов-юнитов. Декларации с зависимостями сначала получают их через
`endpoint.resolve(...)`; под `assemble` это делает контейнер. Читать
`process.env` в корне здесь допустимо: секции конфига без ядра конфигурации
нет.

### Endpoint без пайплайна и endpoint с pre-юнитом

```typescript
// packages/examples.simple-http-server/src/endpoints/create-user.endpoint.ts
export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/users',
  input: CreateUserInput,
  output: CreateUserOutput,
  errors: [EmailTaken],
  handle: async (
    input: CreateUserInput,
  ): Output<CreateUserOutput, FailOf<typeof EmailTaken>> => {
    if (taken.has(input.email)) {
      return EmailTaken({ email: input.email });
    }

    return { id: Math.floor(Math.random() * 1000), ...input };
  },
});
```

Поле `pipeline` необязательно. Декларацию без него исполняет тот же
рантайм с пустым пайплайном: вход проверяется схемой, ответ сверяется со
списком `errors:`, контекст запроса открыт.

```typescript
// packages/examples.simple-http-server/src/common/units.ts
export const withStartedAt: PreUnitFn<
  EmptyInput,
  { startedAt: number }
> = () => ({ startedAt: Date.now() });
```

```typescript
// packages/examples.simple-http-server/src/endpoints/say-hello.endpoint.ts
export const SayHello = httpEndpoint({
  method: 'GET',
  path: '/',
  output: SayHelloOutput,
  pipeline: makePipeline().pre(withStartedAt),
  handle: async (_payload, meta) => ({
    message: 'Hello from Nestling',
    startedAt: new Date(meta.startedAt).toISOString(),
  }),
});
```

Pre-юнит возвращает добавку к контексту. Хендлер читает её из второго
аргумента `meta` вместе с `signal` и `fail`; тип поля `startedAt`
выводится из юнита.

```bash
yarn workspace examples.simple-http-server start:dev
curl localhost:3000/
curl -X POST localhost:3000/users -H 'content-type: application/json' \
  -d '{"name":"Alice","email":"taken@example.com"}'
curl -N localhost:3000/logs/export
```

Первый запрос отвечает `{"message":"Hello from Nestling","startedAt":"…"}`.
Второй возвращает 409 с кодом `EMAIL_TAKEN`. Третий отдаёт NDJSON из
формы `stream(T)`.

### Контейнер без приложения

```typescript
// packages/examples.container/src/container.ts
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

`ContainerBuilder` собирает тот же граф, что `assemble` в `main.ts` того
же примера, но без фаз приложения и транспортов. Ядро конфигурации, которое
`assemble` регистрирует сам, здесь подключается вызовом `configKernel` с
привязкой источников к ключам секций, как в главе
[21](./21-config-sources.md). Плагин логирования регистрируется своими
модулями: `appLogging.modules` — обычный массив значений. `build()`
создаёт все провайдеры сразу и проверяет граф.

```typescript
// packages/examples.container/src/runtime/reload.spec.ts
    container = await makeContainer(source);
    await container.init();
    // Подписка `onChange` открывается в `@OnStart`
    await container.start();
    limiter = container.getOrThrow(RateLimiter);
    // …
    await container.destroy();
```

Хуки жизненного цикла вызываются явно: `init()` выполняет `@OnInit` в
топологическом порядке, `start()` выполняет `@OnStart`, `destroy()`
выполняет `@OnDestroy` в обратном порядке. `getOrThrow(token)` возвращает
инстанс по токену.

```typescript
// packages/examples.container/src/cli.ts
export const main = async () => {
  const container = await makeContainer();

  const metadata = await container.toJSON();
  const json = JSON.stringify(metadata, null, 2);

  await writeFile('di-metadata.json', json);
};
```

`toJSON()` отдаёт граф с узлами, рёбрами и принадлежностью модулям.
Скрипт пишет его в файл, а `@nestling/viz` рисует в браузере. Транспорт
для этого не нужен, поэтому скрипт собирает контейнер, а не приложение.

## Что гарантирует фреймворк

- `makeDispatch` принимает только исполнимые декларации. Декларация с
  `deps` или класс-хендлером не проходит по типам: вызов не компилируется.
- Две декларации одного транспорта с одним паттерном останавливают
  `makeDispatch` с ошибкой.
- У транспорта нет метода `listen()` без аргументов. Принимать запросы
  он начинает только в `serve(dispatch, signal)`, когда таблица маршрутов
  уже построена.
- `build()` проверяет граф целиком: отсутствующая зависимость и цикл
  останавливают сборку одной ошибкой со списком узлов.

## Как проверить

```typescript
// packages/examples.simple-http-server/src/dispatch.spec.ts
const dispatch = makeDispatch([SayHello, CreateUser, ExportLogs]);

/** Вызывает endpoint с готовым payload, минуя разбор HTTP-запроса */
const call = (endpoint: ExecutableDeclaration, payload?: unknown) => {
  const raw: Raw = {
    transport: 'http',
    pattern: endpoint.pattern,
    payload,
    attributes: {},
  };

  const meta: EndpointMeta = {
    transport: 'http',
    pattern: endpoint.pattern,
    input: endpoint.input,
    output: endpoint.output,
    errors: endpoint.errors,
  };

  return dispatch.call(endpoint.pattern, makeEmptyContext(raw, meta));
};

  it('отдаёт значение pre-юнита хендлеру', async () => {
    const response = await call(SayHello);

    expect(response.isSuccess).toBe(true);
    expect(response.value).toMatchObject({ message: 'Hello from Nestling' });
  });
```

Без `assembleTest` кадр запроса собирает сам тест: `makeEmptyContext`
строит начальный контекст из описания запроса и декларации, а
`dispatch.call` исполняет endpoint тем же путём, что и транспорт. Остальные
тесты файла проверяют отказ схемы, объявленный отказ и потоковый ответ.

## Запускаемый код

| Файл | Что показывает |
|---|---|
| `packages/examples.simple-http-server/src/main.ts` | `HttpTransport`, `makeDispatch`, `serve`, остановка по сигналу |
| `packages/examples.simple-http-server/src/endpoints/say-hello.endpoint.ts` | pre-юнит и чтение `meta` |
| `packages/examples.simple-http-server/src/endpoints/create-user.endpoint.ts` | endpoint без `pipeline` |
| `packages/examples.simple-http-server/src/endpoints/export-logs.endpoint.ts` | `stream(T)` на выходе без приложения |
| `packages/examples.simple-http-server/src/dispatch.spec.ts` | вызов через `dispatch.call` |
| `packages/examples.container/src/container.ts` | `ContainerBuilder` с ядром конфигурации |
| `packages/examples.container/src/cli.ts` | экспорт графа для `@nestling/viz` |

```bash
yarn workspace examples.simple-http-server start:dev
yarn workspace examples.simple-http-server test
yarn workspace examples.container export-metadata && yarn workspace examples.container visualize
```

## Дальше

Глава [24. Расширить ядро своим пакетом](./24-extending.md) показывает,
как поверх тех же публичных примитивов пишется отдельный пакет.
