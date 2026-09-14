# 20. Разнести фичи по процессам, не меняя их код

> Гайд по текущему API; сверено с кодом `92353887`.
> Целевое описание: [design/composition.md](../design/composition.md) «L4»,
> [design/operations.md](../design/operations.md) §3 и §4.4,
> [design/transports.md](../design/transports.md) §7. Почему так: записи
> [ideas.md](../decisions/ideas.md) «NATS: шина приложения, а не сосед;
> `durable` в контракте; `propagate` двумя каналами», «Модель композиции:
> фича, плагин, операция» и «Разбор обзоров d/10 и d/13» [2026-09-12],
> пункт 2.

Фичи `users` и `notifications` работают в одном процессе и общаются
операциями. Рассылка медленная, ретраится и масштабируется отдельно от
приёма регистраций, поэтому её хочется развернуть отдельным сервисом.
Вызовы `notifications.check-address` и подписку на `users.registered`
переписывать не хочется: пусть те же фичи работают в двух процессах, а
сообщения между ними переносит брокер.

Обратное направление даёт локальный запуск. Та же декларация с
`--features all` поднимает все фичи в одном процессе, и операции между
ними доставляет шина внутри процесса: вызов `notifications.check-address` на брокер не
выходит. Брокер и несколько процессов нужны стенду, а не разработчику —
локально приложение запускается одной командой и тогда, когда на стенде
его фичи разнесены по сервисам.

## Объявите шину и назначьте ей роль

```typescript
// src/app.ts
export function declareApp(options: DeclareOptions = {}): App {
  const exporter = prometheusExporter();

  return makeApp({
    features: [UsersFeature, NotificationsFeature],
    plugins: [metricsPlugin(exporter)],
    // Шина приложения — обычный транспорт. `intercom:` назначает ему роль
    // переносчика операций между процессами: вызов операции, владелец
    // которой не выбран в этой сборке, уходит через этот транспорт
    transports: [nats({ ...options.nats, name: 'events' }), http()],
    intercom: 'events',
    metrics: exporter,
  });
}

/** Приложение: то же значение для `main.ts`, тестов и проверки топологий */
export const app = declareApp();
```

Декларация одна на все процессы развёртывания: между ними меняется
только аргумент `app.build(select)`. Функция `declareApp` нужна тесту:
он передаёт в транспорт соединение с двойником брокера, а серверу метрик
— эфемерный порт. Про метрики и endpoint `/metrics` — [глава
22](./22-metrics.md).

`nats({ name })` объявляет транспорт так же, как `http()`. Адрес брокера
транспорт читает из своей секции конфига: ключ `NATS_SERVERS`, по
умолчанию `nats://127.0.0.1:4222`. `intercom: 'events'` назначает этому
транспорту роль переносчика операций. Пока роль не назначена, операции
между фичами доставляет шина внутри процесса. После назначения её место
занимает брокер: шина в приложении одна. Объявленная шина без назначенной
роли останавливает сборку, а в роль интеркома встают только транспорты,
переносящие операции: `http()` в `intercom:` не компилируется. Без роли
переносчика вызов операции, чей владелец не выбран, останавливает сборку,
как в главе [19](./19-select.md).

Роль процесса задаёт выбор фич, который `main.ts` передаёт маркером
`argv(process.argv)`, как в главе [19](./19-select.md).

## Оставьте код фич как есть

```typescript
// src/features/users/registration.service.ts
@Component([CheckAddress.caller, UserRegistered.emitter])
export class RegistrationService {
  constructor(
    private readonly addresses: Port<typeof CheckAddress>,
    private readonly registered: Emitter<typeof UserRegistered>,
  ) {}

  /** Регистрирует пользователя; возвращает `false`, если адрес отвергнут */
  async register(email: string): Promise<boolean> {
    const checked = await this.addresses.call({ email });

    if (checked.isFail) {
      // Отказ владельца приходит `Fail` того же определения `AddressRejected`
      // и из соседнего процесса, и из этого
      return false;
    }

    await this.registered.emit({ id: randomUUID(), email });

    return true;
  }
}
```

Этот класс не отличается от того, который работал в одном процессе. Он
зависит от вызывателя и эмиттера, а не от сервисов соседней фичи. Куда
уходит вызов, решает сборка.

При выборе `'users'` владельца `notifications.check-address` в процессе нет. Сборка
привязывает `CheckAddress.caller` к удалённому вызывателю: вызов уходит на
брокер как запрос с ожиданием ответа, а объявленный отказ `AddressRejected`
возвращается тем же `Fail`, что и при вызове внутри процесса. Реплики
владельца образуют queue-group, и каждое сообщение получает одна из них.
При выборе `'all'` обе фичи работают в одном процессе, запрос
выполняется напрямую, а событие всё равно уходит через брокер: его
подписчики могут быть в других процессах.

## Долговечность события и контекст через границу процесса

```typescript
// src/operations.ts
export const UserRegistered = makeEvent({
  name: 'users.registered',
  durable: true,
  input: UserRegisteredInput,
});
```

`durable: true` означает, что доставка переживает перезапуск подписчика.
Транспорт NATS заводит под таким subject'ом поток JetStream: издатель
ждёт подтверждения записи в поток, подписчик читает из потока и
подтверждает обработку. Подписчик, который в момент публикации не работал,
получит событие после запуска. Поле принимают только `command` и `event`:
у `request` вызывающий ждёт ответа, и `durable: true` для него не
компилируется.

```typescript
// src/features/notifications/welcome-email.endpoint.ts
@Handler([Mailer$])
class WelcomeEmailHandler {
  constructor(private readonly mailer: Mailer) {}

  async handle(payload: UserRegisteredInput) {
    await this.mailer.send(payload.email, welcome(payload));
  }
}

export const WelcomeEmail = implement(UserRegistered, {
  // Имя подписчика — адрес подписки: в одном процессе различает
  // подписки на одно событие, у брокера становится именем queue-группы
  // и durable-потребителя
  subscriber: 'welcome-email',
  pipeline: traced,
  handler: WelcomeEmailHandler,
});
```

Имя подписчика из главы [15](./15-events.md) здесь получает вторую
работу: у брокера оно становится именем durable-потребителя. Долговечность
объявлена в операции, а не в корне, потому что о ней должны знать обе
стороны: издатель ждёт подтверждения записи, подписчик читает из потока.

```typescript
// src/context.ts
export const TenantId = contextVar<string>()('tenantId', { propagate: true });
```

Арендатор приходит от внешнего клиента и нужен в обоих процессах, но ни в
одной схеме `input` его нет. `propagate: true` включает передачу
переменной через границу порта: вызыватель берёт значение из контекста
текущего запроса и кладёт его в заголовок сообщения `Nl-Ctx`. Передаётся
только переменная с этой пометкой, остальной контекст через границу не
проходит.

```typescript
// src/features/users/register-user.endpoint.ts
@Handler([RegistrationService])
class RegisterUserHandler {
  constructor(private readonly registration: RegistrationService) {}

  async handle(payload: RegisterUserInput) {
    await this.registration.register(payload.email);
  }
}

export const RegisterUserImpl = implement(RegisterUser, {
  // Базовый слой возвращает в контекст трассу и арендатора: оба пришли в
  // конверте сообщения, и вызыватель `notifications.check-address`
  // передаст их дальше
  pipeline: traced,
  handler: RegisterUserHandler,
});
```

На принимающей стороне значение лежит в атрибутах сообщения. Шаг
`TenantId.propagated()` переносит его в асинхронный контекст запроса. Он
входит в базовый слой примера, который стоит в пайплайне каждой
реализации: и `notifications.check-address`, и `users.registered` приходят из другого
процесса.

```typescript
// src/base.ts
export const traced: Pipeline<EmptyInput, BaseContext> = makePipeline()
  .pre(withTracing())
  .pre(TenantId.propagated());
```

```typescript
// src/features/notifications/suppressions.ts (фрагмент)
@Component([Ctx(TenantId), Logger$.auto])
export class Suppressions {
  readonly #blocked = new Map<string, string>();

  constructor(
    private readonly tenant: CtxReader<string>,
    private readonly logger: Logger,
  ) {}

  reasonFor(email: string): string | undefined {
    this.logger.info('address checked');

    // Список свой у каждого арендатора: его имя пришло конвертом вызова
    return this.#blocked.get(`${this.tenant.get()}:${email}`);
  }
}
```

Сервис читает арендатора ридером `Ctx(TenantId)`, как репозиторий читал
`requestId` в главе [9](./09-logging.md). Ридер объявляется в
зависимостях провайдера. Значение прошло два перехода: внешний клиент
положил его в заголовок, процесс `users` прочитал и передал дальше при
вызове `notifications.check-address`, процесс `notifications` прочитал снова.

## Сквозная трасса между процессами

Базовый слой кладёт в контекст не только арендатора. Первым в нём стоит
`withTracing()` из [главы 9](./09-logging.md), и он же отвечает за то,
чтобы записи обоих процессов сошлись:

```text
INFO  RegistrationService register        traceId=feabb90b363acc5bff69c317824a65ae
INFO  Suppressions        address checked traceId=feabb90b363acc5bff69c317824a65ae
```

Первая запись сделана в процессе `users`, вторая — в процессе `notifications`.
Значение одно, и по нему запись из любого процесса находится вместе с
остальными.

Переносится трасса тем же механизмом, что арендатор: переменная `Trace`
объявлена ядром с `propagate: true`, поэтому вызыватель `notifications.check-address`
кладёт её в конверт сообщения. Отличается только приём: на принимающей
стороне трассу возвращает в контекст `withTracing()`, а не
`Trace.propagated()`. Один и тот же шаг продолжает трассу и с шины, и по
HTTP-заголовку `traceparent`, поэтому реализация операции и
HTTP-endpoint собираются от одного слоя.

`traceId` у двух процессов общий, а `spanId` у каждого свой: участок
вызывающего уходит в `parentSpanId` вызываемого. По этой паре трасса
собирается в дерево вызовов.

Что трасса объявлена на каждом маршруте, проверяет политика сборки:

```typescript
policies: [everyEndpoint().hasVar(Trace, 'trace')],
```

## Запустите и проверьте два процесса

```bash
docker run --rm -p 4222:4222 nats:2 -js
```

Флаг `-js` включает JetStream. Без него поток под `users.registered` не
создастся, и сборка остановится.

```bash
yarn start:dev --features notifications
yarn start:dev --features users
```

Владельца запроса запускайте первым. У брокера нет очереди ожидания для
запроса с ответом: вызов `notifications.check-address` при отсутствующем владельце
завершается отказом доставки. Адрес брокера при необходимости задаёт
`NATS_SERVERS=nats://127.0.0.1:4222`.

Команду регистрации кладёт на шину внешний клиент. Арендатор передаётся
заголовком контекста:

```bash
nats pub users.register '{"email":"alice@example.com"}' -H 'Nl-Ctx:{"tenantId":"acme"}'
```

Тот же корень с `--features all` поднимает обе фичи одним процессом. Ни
один файл фич при этом не меняется.

Политика диспатча `NESTLING_PORTS_DISPATCH=always-remote` отправляет
каждый вызов операции как сообщение, даже когда владелец работает в этом
же процессе. На шине внутри процесса это означает асинхронный барьер,
копию payload и проверку ответа по схеме `output`. Так вызовы проходят
путь, близкий к сетевому, до появления брокера. Тест на обе политики
пишется рядом с остальными тестами приложения.

Тест поднимает оба процесса в одном jest-процессе поверх двойника брокера
`NatsDouble`, и сеть не нужна:

```typescript
// src/split.spec.ts (фрагмент)
  it('два процесса общаются операциями через брокер', async () => {
    const broker = new NatsDouble();
    const topology = await run(broker, 'notifications', 'users');
    const outside = await outsideClient(broker);

    await outside.publish(
      'users.register',
      { email: 'alice@example.com' },
      { context: { tenantId: 'acme' } },
    );
    await untilPublished(broker, 'users.registered');

    // Вызов `notifications.check-address` ушёл на брокер: владельца в процессе `users` нет
    expect(broker.published.map(({ subject }) => subject)).toEqual(
      expect.arrayContaining([
        'users.register',
        'notifications.check-address',
        'users.registered',
      ]),
    );

    expect(tenantOf(broker, 'notifications.check-address')).toBe('acme');
    expect(tenantOf(broker, 'users.registered')).toBe('acme');
    // …
  });
```

`run` создаёт по приложению на каждый выбор фич: `declareApp` с
соединением к двойнику, затем `build(select)` на каждую роль.
`broker.published` хранит все отправленные сообщения с заголовками: по
нему тест проверяет subject'ы и арендатора в `Nl-Ctx`, а через
`broker.jetstreamManager()` находит поток `nestling_users_registered`.
Второй тест того же файла поднимает выбор `'all'` и проверяет, что
`notifications.check-address` на брокер не выходит. Третий читает записи логгера обоих
процессов и сверяет их `traceId`. Четвёртый собирает процесс `users` без
владельца `notifications.check-address` и убеждается, что сборка проходит.

```bash
yarn test
```

Операция стала границей между процессами, и её изменение теперь может
сломать соседний сервис: [21. Не сломать соседей при изменении
операции](./21-compatibility.md).
