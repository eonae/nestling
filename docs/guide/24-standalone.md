# 24. Без `makeApp`

> Гайд по текущему API; сверено с кодом `examples.simple-http-server` (2026-09-05)
> и `examples.container` (2026-09-05).
> Целевое описание: [design/transports.md](../design/transports.md) §1,
> [design/composition.md](../design/composition.md) §1,
> [design/container.md](../design/container.md). Почему так: записи
> [ideas.md](../decisions/ideas.md) «Жизненный цикл: фазы,
> `@OnStart`, гарантия `dispatch`» и «Token families + модули без
> рантайм-инкапсуляции».

Приложение целиком не нужно. Нужно встроить несколько endpoint'ов в
существующий процесс или скрипт, или собрать граф зависимостей без
транспорта, например для экспорта в визуализацию. Оба случая решаются
теми же примитивами, из которых состоит сборка приложения.

## HTTP-сервер из транспорта и `dispatch`

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

Три шага, которые сборка делает на фазах WIRE и START, здесь написаны
руками. `makeDispatch` строит таблицу «паттерн, хендлер» из деклараций,
принимая только исполнимые декларации — без неразрешённых зависимостей у
класса-хендлера и классов-юнитов пайплайна: декларация с зависимостями не
проходит по типам, и вызов не компилируется. Две декларации одного
транспорта с одним и тем же паттерном останавливают `makeDispatch` с
ошибкой. У транспорта нет
метода `listen()` без аргументов: принимать запросы он начинает только в
`serve(dispatch, signal)`, когда таблица маршрутов уже построена.
Остановку по сигналу процесса корень вешает сам: сигнал прерывает
выполняющиеся запросы, `close()` ждёт закрытия соединений.

Декларации с зависимостями сначала получают их через
`endpoint.resolve(...)`; в собранном приложении это делает контейнер.
Читать `process.env` в корне здесь допустимо: секции конфига без ядра
конфигурации нет.

## Endpoint без пайплайна и endpoint с pre-юнитом

```typescript
// packages/examples.simple-http-server/src/endpoints/create-user.endpoint.ts
export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/users',
  input: CreateUserInput,
  output: CreateUserOutput,
  errors: [EmailTaken],
  handler: async (
    input: CreateUserInput,
  ): Output<CreateUserOutput, typeof EmailTaken> => {
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
  handler: async (_payload, meta) => ({
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
Второй возвращает 409 с кодом `conflict:email_taken`. Третий отдаёт NDJSON из
формы `stream(T)`.

## Контейнер без приложения

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

`ContainerBuilder` собирает тот же граф, что `makeApp` в `main.ts` того
же примера, но без фаз приложения и транспортов. Ядро конфигурации,
которое сборка через `makeApp` регистрирует сама, здесь подключается
вызовом `configKernel` с привязкой источников к ключам секций, как в
главе [22](./22-config-sources.md). Плагин логирования регистрируется
своими модулями: `appLogging.modules` — обычный массив значений.
`build()` создаёт все провайдеры сразу и проверяет граф целиком:
отсутствующая зависимость и цикл останавливают сборку одной ошибкой со
списком узлов.

```typescript
// packages/examples.container/src/runtime/reload.spec.ts (фрагмент)
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

main().catch(console.error);
```

`toJSON()` отдаёт граф с узлами, рёбрами и принадлежностью модулям.
Скрипт пишет его в файл, а `@nestling/viz` рисует в браузере. Транспорт
для этого не нужен, поэтому скрипт собирает контейнер, а не приложение.

## Проверка

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

```bash
yarn workspace examples.simple-http-server test
yarn workspace examples.container export-metadata && yarn workspace examples.container visualize
```

Глава [25. Расширить ядро своим пакетом](./25-extending.md) показывает,
как поверх тех же публичных примитивов пишется отдельный пакет.
