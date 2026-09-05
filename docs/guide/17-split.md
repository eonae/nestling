# 17. Разнести фичи по процессам, не меняя их код

> Гайд по текущему API; сверено с кодом `split-nats` (2026-09-05).
> Целевое описание: [design/composition.md](../design/composition.md) «L4»,
> [design/operations.md](../design/operations.md) §3 и §4.4,
> [design/transports.md](../design/transports.md) §7. Почему так: записи
> [ideas.md](../decisions/ideas.md) «NATS: шина приложения, а не сосед;
> `durable` в контракте; `propagate` двумя каналами» и «Модель композиции:
> фича, плагин, операция».

Фичи `users` и `quotas` работают в одном процессе и общаются операциями.
Нагрузка на квоты другая, и их хочется развернуть отдельным сервисом.
Вызовы `quotas.claim` и подписку на `users.registered` переписывать не
хочется: пусть те же фичи работают в двух процессах, а сообщения между ними
переносит брокер.

Обратное направление даёт локальный запуск. Та же декларация с
`assemble('all')` поднимает все фичи в одном процессе, и операции между
ними доставляет шина внутри процесса: вызов `quotas.claim` на брокер не
выходит. Брокер и несколько процессов нужны стенду, а не разработчику —
локально приложение запускается одной командой и тогда, когда на стенде
его фичи разнесены по сервисам.

## Объявите шину и назначьте ей роль

```typescript
// examples/split-nats/src/app.ts
export function declareApp(transport: NatsTransportOptions = {}): App {
  return makeApp({
    features: [UsersFeature, QuotasFeature],
    // Шина приложения — обычный транспорт. `intercom:` назначает ему роль
    // переносчика операций между процессами: вызов операции, владелец
    // которой не выбран в этой сборке, уходит через этот транспорт
    transports: [nats({ ...transport, name: 'events' })],
    intercom: 'events',
  });
}

/** Приложение: то же значение для `main.ts`, тестов и проверки топологий */
export const app = declareApp();
```

Декларация одна на все процессы развёртывания: между ними меняется
только аргумент `app.assemble(select)`. Функция `declareApp` нужна тесту:
он передаёт в транспорт соединение с двойником брокера.

`nats({ name })` объявляет транспорт так же, как `http()`. Адрес брокера
транспорт читает из своей секции конфига: ключ `NATS_SERVERS`, по
умолчанию `nats://127.0.0.1:4222`. `intercom: 'events'` назначает этому
транспорту роль переносчика операций. Пока роль не назначена, операции
между фичами доставляет шина внутри процесса. После назначения её место
занимает брокер: шина в приложении одна. Объявленная шина без назначенной
роли останавливает сборку, а в роль интеркома встают только транспорты,
переносящие операции: `http()` в `intercom:` не компилируется. Без роли
переносчика вызов операции, чей владелец не выбран, останавливает сборку,
как в главе [16](./16-select.md).

Роль процесса задаёт выбор фич, который `main.ts` читает из
`APP_FEATURES` до сборки, как в главе [16](./16-select.md).

## Оставьте код фич как есть

```typescript
// examples/split-nats/src/users.ts
@Injectable([ClaimQuota.caller, UserRegistered.emitter])
export class RegistrationService {
  constructor(
    private readonly quotas: Port<typeof ClaimQuota>,
    private readonly registered: Emitter<typeof UserRegistered>,
  ) {}

  /** Регистрирует пользователя; возвращает `false`, если квота исчерпана */
  async register(email: string): Promise<boolean> {
    const claim = await this.quotas.call({ email });

    if (claim.isFail) {
      // Отказ владельца приходит `Fail` того же определения `QuotaExceeded`
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

При выборе `'users'` владельца `quotas.claim` в процессе нет. Сборка
привязывает `ClaimQuota.caller` к удалённому вызывателю: вызов уходит на
брокер как запрос с ожиданием ответа, а объявленный отказ `QuotaExceeded`
возвращается тем же `Fail`, что и при вызове внутри процесса. Реплики
владельца образуют queue-group, и каждое сообщение получает одна из них.
При выборе `'all'` обе фичи работают в одном процессе, запрос
выполняется напрямую, а событие всё равно уходит через брокер: его
подписчики могут быть в других процессах.

## Долговечность события и контекст через границу процесса

```typescript
// examples/split-nats/src/operations.ts
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
// examples/split-nats/src/quotas.ts
@Injectable([QuotaLedger])
class UserRegisteredInArchiveHandler {
  constructor(private readonly ledger: QuotaLedger) {}

  async handle(payload: UserRegisteredInput) {
    this.ledger.archive(payload.id);
  }
}

    implement(UserRegistered, {
      // Имя подписчика — адрес подписки: в одном процессе различает
      // подписки на одно событие, у брокера становится именем queue-группы
      // и durable-потребителя
      subscriber: 'archive',
      pipeline: makePipeline().pre(TenantId.propagated()),
      handler: UserRegisteredInArchiveHandler,
    }),
```

Имя подписчика из главы [13](./13-events.md) здесь получает вторую
работу: у брокера оно становится именем durable-потребителя. Долговечность
объявлена в операции, а не в корне, потому что о ней должны знать обе
стороны: издатель ждёт подтверждения записи, подписчик читает из потока.

```typescript
// examples/split-nats/src/context.ts
export const TenantId = contextVar<string>()('tenantId', { propagate: true });
```

Арендатор приходит от внешнего клиента и нужен в обоих процессах, но ни в
одной схеме `input` его нет. `propagate: true` включает передачу
переменной через границу порта: вызыватель берёт значение из контекста
текущего запроса и кладёт его в заголовок сообщения `Nl-Ctx`. Передаётся
только переменная с этой пометкой, остальной контекст через границу не
проходит.

```typescript
// examples/split-nats/src/users.ts
@Injectable([RegistrationService])
class RegisterUserHandler {
  constructor(private readonly registration: RegistrationService) {}

  async handle(payload: RegisterUserInput) {
    await this.registration.register(payload.email);
  }
}

    implement(RegisterUser, {
      // Арендатор приходит в конверте сообщения. Юнит кладёт его в контекст
      // запроса, откуда вызыватель `quotas.claim` передаст его дальше
      pipeline: makePipeline().pre(TenantId.propagated()),
      handler: RegisterUserHandler,
    }),
```

На принимающей стороне значение лежит в атрибутах сообщения. Юнит
`TenantId.propagated()` переносит его в асинхронный контекст запроса. Тот
же юнит стоит в пайплайне обеих реализаций фичи `quotas`, потому что и
`quotas.claim`, и `users.registered` приходят из другого процесса.

```typescript
// examples/split-nats/src/quotas.ts (фрагмент)
@Injectable([Ctx(TenantId)])
export class QuotaLedger {
  readonly limit = 100;
  readonly used = new Map<string, number>();

  constructor(private readonly tenant: CtxReader<string>) {}

  claim(): number | undefined {
    const tenantId = this.tenant.get();
    // …
  }
}
```

Сервис читает арендатора ридером `Ctx(TenantId)`, как репозиторий читал
`requestId` в главе [8](./08-logging.md). Ридер объявляется в
зависимостях провайдера. Значение прошло два перехода: внешний клиент
положил его в заголовок, процесс `users` прочитал и передал дальше при
вызове `quotas.claim`, процесс `quotas` прочитал снова.

## Запустите и проверьте два процесса

```bash
docker run --rm -p 4222:4222 nats:2 -js
```

Флаг `-js` включает JetStream. Без него поток под `users.registered` не
создастся, и сборка остановится.

```bash
APP_FEATURES=quotas yarn workspace @examples/split-nats start:dev
APP_FEATURES=users yarn workspace @examples/split-nats start:dev
```

Владельца запроса запускайте первым. У брокера нет очереди ожидания для
запроса с ответом: вызов `quotas.claim` при отсутствующем владельце
завершается отказом доставки. Адрес брокера при необходимости задаёт
`NATS_SERVERS=nats://127.0.0.1:4222`.

Команду регистрации кладёт на шину внешний клиент. Арендатор передаётся
заголовком контекста:

```bash
nats pub users.register '{"email":"alice@example.com"}' -H 'Nl-Ctx:{"tenantId":"acme"}'
```

Тот же корень с `APP_FEATURES=all` поднимает обе фичи одним процессом. Ни
один файл фич при этом не меняется.

Политика диспатча `NESTLING_PORTS_DISPATCH=always-remote` отправляет
каждый вызов операции как сообщение, даже когда владелец работает в этом
же процессе. На шине внутри процесса это означает асинхронный барьер,
копию payload и проверку ответа по схеме `output`. Так вызовы проходят
путь, близкий к сетевому, до появления брокера. Тест на обе политики лежит
в `examples/app-with-http/src/app.spec.ts`.

Тест поднимает оба процесса в одном jest-процессе поверх двойника брокера
`NatsDouble`, и сеть не нужна:

```typescript
// examples/split-nats/src/split.spec.ts (фрагмент)
  it('два процесса общаются операциями через брокер', async () => {
    const broker = new NatsDouble();
    const topology = await run(broker, 'quotas', 'users');
    const outside = await outsideClient(broker);

    await outside.publish(
      'users.register',
      { email: 'alice@example.com' },
      { context: { tenantId: 'acme' } },
    );
    await untilPublished(broker, 'users.registered');

    // Вызов `quotas.claim` ушёл на брокер: владельца в процессе `users` нет
    expect(broker.published.map(({ subject }) => subject)).toEqual(
      expect.arrayContaining([
        'users.register',
        'quotas.claim',
        'users.registered',
      ]),
    );

    expect(tenantOf(broker, 'quotas.claim')).toBe('acme');
    expect(tenantOf(broker, 'users.registered')).toBe('acme');
    // …
  });
```

`run` создаёт по приложению на каждый выбор фич: `declareApp` с
соединением к двойнику, затем `assemble(select)` на каждую роль.
`broker.published` хранит все отправленные сообщения с заголовками: по
нему тест проверяет subject'ы и арендатора в `Nl-Ctx`, а через
`broker.jetstreamManager()` находит поток `nestling_users_registered`.
Второй тест того же файла поднимает выбор `'all'` и проверяет, что
`quotas.claim` на брокер не выходит. Третий собирает процесс `users` без
владельца `quotas.claim` и убеждается, что сборка проходит.

```bash
yarn workspace @examples/split-nats test
```

Операция стала границей между процессами, и её изменение теперь может
сломать соседний сервис: [18. Не сломать соседей при изменении
операции](./18-compatibility.md).
