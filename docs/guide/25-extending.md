# 25. Расширить ядро своим пакетом

> Гайд по текущему API; сверено с кодом `nestling.subscriptions` (2026-09-05).
> Целевое описание: [design/principles.md](../design/principles.md), раздел
> «Граница ядра», и [design/streaming.md](../design/streaming.md) §4.1.
> Почему так: записи [ideas.md](../decisions/ideas.md) «[2026-07-14]
> «Kernel 1.0» — граница ядра» и «[2026-08-01] Реестр подписок: результат
> dogfooding-замера».

Приложению нужна возможность, которой в ядре нет: дедупликация команд по
ключу идемпотентности, outbox, реестр открытых подписок с
административным закрытием. Такой пакет пишется отдельно, не трогая ядро
и не форкая его: он подключается к корню как обычный плагин, тестируется
через `assembleTest` и не тянет в приложение ни вендора схем, ни
хранилища.

Такой пакет называется сателлитом: он собран поверх публичных примитивов
ядра и живёт вне него. Образец в этой главе — `@nestling/subscriptions`,
реестр подписок из [главы 23](./23-ops.md).

## Публичные примитивы

Ядро не даёт сателлиту ни хуков, ни точек расширения. Всё, что нужно,
уже есть в публичных пакетах:

| Примитив | Пакет | Для чего реестру |
|---|---|---|
| `makePlugin` | `@nestling/app` | подключение к корню через `plugins:` |
| `@Injectable`, `@OnDestroy` | `@nestling/container` | реестр как singleton графа, класс-юниты слоя |
| `makePipeline`, фазы `.pre` и `.finally` | `@nestling/pipeline` | слой `tracked`: запись живёт столько, сколько подписка |
| `AbortSignal` | стандарт языка | сигнал подписки, объединяющий три причины отмены |
| `Topic` | `@nestling/streams` | лента изменений реестра |
| `makeEvent`, `jsonSchema` | `@nestling/operations` | факты жизненного цикла для других фич и процессов |

В `dependencies` пакета только эти пакеты и `@common/misc` с типами
Standard Schema. `@nestling/app` нужен только тестам и лежит в
`devDependencies`.

Критерий границы ядра: сателлит пишется без правок ядра. Если
возможность не выражается публичными примитивами, не хватает примитива,
и чинится именно он, а не сателлит. Реестр подписок этот критерий
прошёл: изменений в пакетах ядра за время его написания не было.

## Слой как экспортируемое значение

```typescript
// packages/nestling.subscriptions/src/layer.ts
@Injectable([SubscriptionRegistry])
export class TrackSubscription {
  constructor(private readonly registry: SubscriptionRegistry) {}

  handle(ctx: SubscriptionContext): { subscription: TrackedSubscription } {
    return { subscription: this.registry.open(ctx) };
  }
}

@Injectable([SubscriptionRegistry])
export class UntrackSubscription {
  constructor(private readonly registry: SubscriptionRegistry) {}

  handle(
    outcome: Outcome,
    _res: ResponseContext,
    // Собственные поля слоя в ответной фазе — `Partial`: регистрация
    // могла не случиться (внешний pre упал раньше). Тогда снимать нечего
    ctx: { input: { subscription?: TrackedSubscription } },
  ): void {
    const id = ctx.input.subscription?.id;

    if (id !== undefined) {
      this.registry.close(id, outcome);
    }
  }
}

export const tracked = makePipeline()
  .pre(TrackSubscription)
  .finally(UntrackSubscription);
```

Слой состоит из двух юнитов в форме класса: обоим нужен реестр из
контейнера. Pre-юнит возвращает поле `subscription`, и хендлер видит его
в типах как `meta.subscription`. Юнит `.finally` для потокового `output`
выполняется после того, как поток закончился, оборвался или был закрыт
потребителем, поэтому запись снимается в тот же момент, когда подписка
действительно завершилась. Своего хука или таймера реестру не нужно.

Приложение подключает слой так же, как любой свой: `compose(observability,
tracked)`. Обязательность слоя задаёт политика корня
`everyEndpoint({ … }).hasLayer(tracked)`, а не скрытый механизм пакета.

## Своё поле в `meta` и объединённый сигнал

```typescript
// packages/nestling.subscriptions/src/registry.ts (фрагмент)
  open(ctx: SubscriptionContext): TrackedSubscription {
    const id = crypto.randomUUID();
    const controller = new AbortController();
    // …
    return {
      id,
      // Один сигнал на три причины отмены: дисконнект, shutdown, kill
      signal: AbortSignal.any([ctx.signal, controller.signal]),
    };
  }
```

Ключ `signal` в `meta` зарезервирован пайплайном: сигнал запроса
подменить нельзя. Поэтому административный канал закрытия живёт во втором
поле, `meta.subscription.signal`. Он объединяет сигнал запроса и
контроллер записи, и хендлер одной подпиской получает отключение клиента,
остановку приложения и закрытие администратором. Метод `abort()` только
взводит контроллер; запись удаляет `.finally`, когда поток дотёк.

## `Topic` как лента изменений

```typescript
// packages/nestling.subscriptions/src/registry.ts (фрагмент)
    this.#feed = new Topic<SubscriptionEvent>({
      buffer: options.feedBuffer ?? DEFAULT_FEED_BUFFER,
      onSlowConsumer: 'drop-oldest',
    });
  // …
  watch(signal?: AbortSignal): AsyncIterableIterator<SubscriptionEvent> {
    return this.#feed.subscribe(signal);
  }
  // …
  @OnDestroy()
  dispose(): void {
    this.#feed.close();
  }
```

Лента реестра устроена так же, как лента активности в
[главе 14](./14-live-feed.md): `push` не ждёт наблюдателей, медленный
наблюдатель теряет события по `drop-oldest`, `@OnDestroy` закрывает ленту
на остановке, и наблюдатели завершаются нормально.

## Факты жизненного цикла операциями

```typescript
// packages/nestling.subscriptions/src/operations.ts
export const SubscriptionOpened = makeEvent({
  name: 'subscriptions.opened',
  input: record<SubscriptionOpenedFact>({
    node: optionalStr(),
    id: str(),
    transport: str(),
    pattern: str(),
    kind: str(KINDS),
    identity: optionalStr(),
    startedAt: num(),
  }),
  doc: {
    summary: 'Подписка открыта',
    description:
      'Факт публикуется реестром подписок при регистрации подписки. ' +
      'Наблюдение кластерное: имя узла едет полем `node`.',
  },
});
```

Факты «подписка открыта» и «подписка закрыта» публикуются обычными
`event`-операциями. Приёмник в любой фиче и в любом процессе пишет
`implement(SubscriptionOpened, { subscriber: '…' })`, как в фиче `ops` из
[главы 23](./23-ops.md). Схемы фактов написаны руками в `schema.ts` и
реализуют Standard Schema, поэтому пакет не зависит от zod и не навязывает
приложению вендора. Аннотация `jsonSchema(...)` даёт этим схемам JSON
Schema, и факты попадают в документ и в снапшот совместимости из
[главы 18](./18-compatibility.md).

## Параметризованный плагин

```typescript
// packages/nestling.subscriptions/src/module.ts
export const subscriptions = (options: SubscriptionsOptions = {}): Plugin => {
  const deps: readonly InjectionToken[] = options.publish
    ? [SubscriptionOpened.emitter, SubscriptionClosed.emitter]
    : [];

  const registry: FactoryProviderDefinition<SubscriptionRegistry> = {
    provide: SubscriptionRegistry,
    useFactory: (
      opened?: Emitter<typeof SubscriptionOpened>,
      closed?: Emitter<typeof SubscriptionClosed>,
    ) => new SubscriptionRegistry(options, opened, closed),
    deps,
  };

  return makePlugin({
    name: '@nestling/subscriptions',
    providers: [registry, TrackSubscription, UntrackSubscription],
  });
};
```

Плагин сателлита устроен так же, как плагин логирования из
[главы 12](./12-features.md): функция принимает решения композиции и
возвращает значение `makePlugin`. Класс-юниты слоя регистрирует сам
плагин, поэтому endpoint со слоем `tracked` без `subscriptions()` в корне
останавливает сборку на фазе ASSEMBLE: класс-юнит слоя не получает
зависимостей. Второе значение `subscriptions({ … })` в одном и том же
корне тоже останавливает сборку: два плагина с одним именем. Список
`deps` фабрики зависит от опции `publish`: при выключенной публикации
вызывателей операций в графе нет.

## Тестовые двойники через subpath `./testing`

```json
// packages/nestling.transport.nats/package.json (фрагмент)
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./testing": {
      "testing": {
        "types": "./dist/testing/index.d.ts",
        "import": "./dist/testing/index.js"
      }
    }
  },
```

Если сателлит поставляет двойники для тестов, как `NatsDouble` из
[главы 17](./17-split.md), положите их в subpath `./testing` под условием
экспорта `"testing"`. В production-сборке условие не включено, и импорт
`@nestling/transport.nats/testing` не разрешается на уровне Node. Раннер
включает условие сам:

```javascript
// jest
testEnvironmentOptions: { customExportConditions: ['testing', 'node', 'node-addons'] }
```

Пакету, который импортирует такой subpath, нужно `customConditions:
['testing']` в `tsconfig.json`.

## Свой транспорт

```typescript
// packages/nestling.subscriptions/src/__fixtures__/transport.ts
export const TestTransport$: Token<ITransport> =
  makeToken<ITransport>('transport:test');

export class TestTransport implements ITransport {
  // …
  readonly capabilities: TransportCapabilities = STREAMING;

  async serve(dispatch: Dispatch, signal: AbortSignal): Promise<void> {
    this.dispatch = dispatch;
    this.signal = signal;
    this.serving = true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

export const testTransport = (): TransportDeclaration =>
  transportValue(TestTransport$, new TestTransport());
```

Транспорт реализует интерфейс `ITransport` из `@nestling/transport`:
поле `capabilities` перечисляет формы io, которые он умеет передавать,
`serve(dispatch, signal)` получает таблицу маршрутов и общий сигнал
остановки, `close()` освобождает ресурсы. Метода запуска без маршрутов в
интерфейсе нет. Декларация, форма io которой не входит в `capabilities`
транспорта, отклоняется до обслуживания первого запроса. На транспорт
ссылаются токеном экземпляра, а объявление для словаря `transports:` даёт
`transportValue(token, instance)`. Реальные транспорты `http()`, `cli()`
и `nats()` построены на том же интерфейсе.

## Проверка

Сателлит тестируется тем же тестовым корнем, что и приложение. Тест
пакета собирает плагин, одну фичу и транспорт-фикстуру:

```typescript
// packages/nestling.subscriptions/src/module.spec.ts (фрагмент)
  it('видит подписку, убивает её и снимает запись', async () => {
    await using testApp = await assembleTest(
      makeApp({
        plugins: [subscriptions()],
        features: [makeFeature({ name: 'module:ticks', endpoints: [Ticks] })],
        transports: [testTransport()],
      }),
    );

    const registry = testApp.get(SubscriptionRegistry);
    // …
    const response = await testApp.call(Ticks);
    expect(response.isSuccess).toBe(true);

    const [info] = registry.list();
    expect(info).toMatchObject({
      transport: 'test',
      pattern: 'ticks:watch',
      kind: 'events',
    });

    const items: Tick[] = [];
    for await (const tick of streamOf<Tick>(response)) {
      items.push(tick);
      if (items.length === 2) {
        expect(registry.abort(info.id, 'админ закрыл подписку')).toBe(true);
      }
    }

    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(registry.size).toBe(0);
  });
```

Endpoint `Ticks` в тесте объявлен через `makeEndpoint` на транспорте
фикстуры: HTTP пакету не нужен, а способности транспорта объявляются
значением. Второй тест того же файла проверяет остановку: после
`testApp.close()` поток дотекает, `.finally` снимает запись, и наблюдатель
ленты завершается нормально.

```bash
yarn workspace @nestling/subscriptions test
```

Подключение в приложении:

```typescript
// packages/examples.app-with-http/src/app.ts (фрагмент)
export const appSubscriptions = subscriptions({
  identity: (ctx) => (ctx.input as { requestId?: string }).requestId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true,
  node: 'app-with-http',
});
```

Как этим пользуется эксплуатация, показывает [глава 23](./23-ops.md).

Это последняя глава. Целевое описание каждой подсистемы лежит в
[design/](../design/README.md), причины решений в
[decisions/ideas.md](../decisions/ideas.md). Альтернативные формы,
которые главы показывали по одному разу, собраны в
[приложении А](./appendix-a-alternatives.md); соответствия понятиям
NestJS в [приложении Б](./appendix-b-from-nestjs.md).
