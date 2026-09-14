# 14. Выделить вторую область и не дать ей лезть в чужие сервисы

> Гайд по текущему API; сверено с кодом `f4a5c7e5`.
> Целевое описание: [design/composition.md](../design/composition.md),
> разделы «Граница фичи» и «Плагин», и
> [design/operations.md](../design/operations.md). Почему так: записи
> [ideas.md](../decisions/ideas.md) «[2026-09-02] Модель композиции: фича,
> плагин, операция», «[2026-07-08] Порты: межфичевое общение через
> контракты» и «[2026-07-08] Kernel/user space; конфиг как token-families;
> плагины».

Новому пользователю уходит письмо, и рассылку ведёт другая команда. Код
рассылки должен жить отдельно: у него свои сервисы, свои тесты и свой
владелец. Фича пользователей не должна инжектить сервис рассылки, потому
что однажды рассылка переедет в отдельный процесс, и код регистрации при
этом не должен измениться. Слой наблюдаемости и проверка Bearer-токена
остаются общими для обеих областей.

Сервис из части 1 растёт в приложение. Файлы перекладываются по областям:
фичи в `src/features/<имя>/`, общая инфраструктура в
`src/plugins/<имя>/`, декларация приложения в `src/app.ts`. Код
endpoint'ов, хранилища и конфига не меняется.

## Вторая фича

```typescript
// src/features/notifications/suppressions.ts
@Component([])
export class Suppressions {
  readonly #blocked = new Map<string, string>();

  /** Причина отказа или `undefined`, если адрес годен */
  reasonFor(email: string): string | undefined {
    return this.#blocked.get(email);
  }

  /** Убирает адрес из рассылок */
  suppress(email: string, reason: string): void {
    this.#blocked.set(email, reason);
  }
}
```

```typescript
// src/features/notifications/notifications.feature.ts
export const NotificationsFeature = makeFeature({
  name: 'notifications',
  providers: [Suppressions, Mailer],
  endpoints: [CheckAddressImpl, WelcomeEmail, ForgetAddressImpl],
});
```

Фича `notifications` объявлена так же, как `users`: имя, провайдеры и
endpoint'ы. `Suppressions` — список адресов, на которые письма не уходят;
знание принадлежит тому, кто эти письма шлёт. Наружу класс не
экспортируется и в `deps` других фич не попадает.

## Граница фич

Фича не может зависеть от провайдера другой фичи. Если в фиче `users`
объявить провайдер `UsersReport` с `@Component([Suppressions])`, сборка
остановится на фазе BUILD:

```
1 edge(s) cross a feature boundary:

  - Feature 'users' depends on feature 'notifications' by DI token: 'UsersReport'
    injects 'Suppressions'. Features are connected by operations only — a
    DI token does not survive a process boundary, so this edge breaks the
    moment the two features are deployed apart. Declare the call as an
    operation (makeRequest / makeCommand), inject its '.caller' and
    implement it in 'notifications'.
```

Проверка выполняется на собранном графе и различает три вида рёбер.

| Ребро | Вердикт |
|---|---|
| провайдер фичи зависит от провайдера другой фичи | ошибка сборки |
| провайдер фичи зависит от провайдера плагина | разрешено |
| провайдер плагина зависит от провайдера фичи | ошибка сборки |

К фиче обращаются операциями, к плагину DI-токенами. DI-токен работает
только внутри процесса, операция имеет адрес и схемы и работает через
любой транспорт.

## Операция вместо DI-токена

```typescript
// src/operations.ts
import {
  makeFail,
  makeCommand,
  makeEvent,
  makeRequest,
} from '@nestlingjs/operations';
import { z } from 'zod';

/** Отказ «адрес отвергнут». По сети приходит кодом и восстанавливается в `Fail` */
export const AddressRejected = makeFail('conflict:address_rejected', {
  details: z.object({ email: z.string(), reason: z.string() }),
  message: (d) => `Address ${d.email} is not deliverable: ${d.reason}`,
});

export const CheckAddressInput = z.object({ email: z.string() });

export type CheckAddressInput = z.infer<typeof CheckAddressInput>;

export const CheckAddress = makeRequest({
  name: 'notifications.check-address',
  input: CheckAddressInput,
  output: z.object({ deliverable: z.boolean() }),
  errors: [AddressRejected],
});
// …
```

Операция — единица общения между фичами: имя, схемы `input` и `output`,
список `errors`. Она объявлена в файле вне обеих фич, потому что не
принадлежит ни вызывающему, ни реализующему. Файл импортирует только
`@nestlingjs/operations` и `zod`, поэтому операцию может импортировать и
фронтенд.

`makeRequest` объявляет операцию вида `request`: вызывающий ждёт ответ
`Ok` или `Fail`, владелец у операции ровно один.

## Реализация в фиче-владельце

```typescript
// src/features/notifications/check-address.endpoint.ts
@Handler([Suppressions, Logger$.auto])
class CheckAddressHandler {
  constructor(
    private readonly suppressions: Suppressions,
    private readonly logger: Logger,
  ) {}

  async handle(payload: CheckAddressInput) {
    const reason = this.suppressions.reasonFor(payload.email);

    if (reason !== undefined) {
      this.logger.info('address rejected', { email: payload.email });

      // Вызывающий получит `Fail` и узнает его через `AddressRejected.is()`
      return AddressRejected({ email: payload.email, reason });
    }

    return { deliverable: true };
  }
}

export const CheckAddressImpl = implement(CheckAddress, {
  handler: CheckAddressHandler,
});
```

`implement(Operation, { handler })` создаёт декларацию endpoint'а на
транспорте шины. От `httpEndpoint` её отличают конструктор и адрес:
паттерном служит имя операции. Схемы `input`, `output` и `errors`
берутся из операции и в реализации не повторяются — повторное
объявление любой из них ошибка компиляции. Остальное общее с
`httpEndpoint`: класс-хендлер, вход проверяется по схеме, отказ вне
списка `errors` заменяется на `InternalError`. Реализация перечисляется
в `endpoints:` фичи рядом с HTTP-endpoint'ами.

Операция вида `request`, чей вызыватель инжектирован, а реализация в
сборке отсутствует, останавливает сборку: вызову некуда идти. Два
владельца одной операции тоже останавливают сборку.

## Вызов через вызыватель

```typescript
// src/features/users/endpoints/create-user.endpoint.ts
const CHECK_BUDGET_MS = 500;

@Handler([
  UsersRepository$,
  CheckAddress.caller,
  // …
])
export class CreateUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly addresses: Port<typeof CheckAddress>,
    // …
  ) {}

  async handle(
    payload: CreateUserInput,
  ): Output<User, typeof EmailTaken | typeof AddressRejected> {
    if (await this.users.byEmail(payload.email)) {
      return EmailTaken({ email: payload.email });
    }
    // …
    const checked = await this.addresses.call(
      { email: payload.email },
      { deadline: deadlineIn(CHECK_BUDGET_MS) },
    );

    if (checked.isFail) {
      // Отказ соседа объявлен в `errors:` операции и уходит клиенту как
      // есть. Исчерпанный бюджет приходит кодом ядра `timeout`: отказы
      // ядра входят в `Output` без объявления, поэтому приведение типов
      // здесь не нужно
      return checked;
    }

    const user = await this.users.insert({
      name: payload.name,
      email: payload.email,
    });
    // …
    return Ok.created(user);
  }
}

export const CreateUser = httpEndpoint.implement(CreateUserOperation, {
  pipeline: authed,
  handler: CreateUserHandler,
});
```

`CheckAddress.caller` — DI-токен вызывателя. Он перечисляется в декораторе
роли как обычная зависимость, и хендлер получает объект типа
`Port<typeof CheckAddress>` с методом `call(input, meta?)`. Вызов всегда
асинхронный и всегда возвращает `Ok` или `Fail`, даже когда реализация
работает в этом же процессе. Отказ разбирает вызывающий: множество его
ответов закрыто — объявленные отказы плюс коды ядра, тип `checked` не
содержит ничего другого, и ветка `default` на месте вызова не нужна.

Второй аргумент `call` — параметры вызова. `deadline` задаёт бюджет
времени моментом, а не длительностью: `deadlineIn(500)` вычисляет момент
из миллисекунд. Бюджета по умолчанию нет. Исчерпанный бюджет приходит
отказом с кодом ядра `timeout`; в `errors:` он не объявляется, как и
`internal_error`.

Отказ соседа `AddressRejected` доходит до клиента, потому что операция
`users.create` подключает список отказов `CheckAddress` через `errorsOf`
наравне со своими; отказ, не перечисленный в `errors:` вызывающего
endpoint'а, заменяется на `InternalError` на выходе из пайплайна.
`Unauthorized` в списке операции остаётся, хотя endpoint его больше не
объявляет: этот отказ объявил слой `authed`, а операция — контракт для
клиента, и клиент пайплайна реализации не видит:

```typescript
// src/api/operations.ts
export const CreateUser = makeRequest({
  name: 'users.create',
  http: { method: 'POST', path: '/users', bind: { dryRun: query() } },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken, ...errorsOf(CheckAddress), Unauthorized],
  // …
});
```

`errorsOf(CheckAddress)` отдаёт `errors:` операции `CheckAddress` тем же
значением: спред `...errorsOf(CheckAddress)` заменяет ручной импорт и
перечисление `AddressRejected`, а тип хендлера остаётся тем же, что при
прямом перечислении отказа.

`httpEndpoint.implement` сверяет два множества: каждый отказ, объявленный
слоями её пайплайна, обязан входить в `errors:` операции. Слой `authed`
объявляет `Unauthorized`, поэтому операция перечисляет его. Если бы не
перечисляла, слот `pipeline` не скомпилировался бы, а конструктор бросил
бы ошибку при создании декларации с недостающими кодами.

Регистрация на отвергнутый адрес получает `409`:

```bash
curl -X POST localhost:3000/users \
  -H 'authorization: Bearer secret' -H 'content-type: application/json' \
  -d '{"name":"Eve","email":"eve@example.invalid"}'
# {"type":"urn:error:conflict:address_rejected","title":"Conflict","status":409,
#  "detail":"Address eve@example.invalid is not deliverable: domain does not accept mail",
#  "details":{"email":"eve@example.invalid","reason":"domain does not accept mail"}}
```

## Общее уходит в плагины

Слой `traced` нужен обеим фичам. Провайдер, от которого зависят
две фичи, объявляется плагином:

```typescript
// src/plugins/observability/observability.plugin.ts
export const observability: Plugin = makePlugin({
  name: 'app-observability',
  // Класс-шаг слоя `traced`: без регистрации слой не соберётся
  providers: [AuditOutcome],
});
```

Плагин — сквозная инфраструктура. `makePlugin` принимает то же, что
`makeFeature`: имя, провайдеры, при необходимости endpoint'ы. Разница в
роли: плагин перечисляется в `plugins:` корня, есть в каждом процессе, и
фичи обращаются к нему DI-токенами. У `observability` параметров нет:
логгер шагу даёт ядро, а уровень записи задаёт `NESTLING_LOG_LEVEL`
логгера ядра ([глава 9](./09-logging.md)), поэтому значение плагина одно
и объявлено прямо здесь.

Параметризованный плагин — функция, которая возвращает значение:

```typescript
// src/ops/ops.plugin.ts (фрагмент)
export const subscriptions = makeSubscriptions({
  identity: RequestId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: false,
});
```

`makeSubscriptions(options)` из пакета `@nestlingjs/subscriptions` собирает
реестр подписок. `identity` называет контекстную переменную: реестр берёт
её значение по ключу, а формы накопленного входа не знает. `labels` —
функция от контекста; накопленный вход ей тоже недоступен, и значения
переменных она получает аргументами из
`computed([TenantId, UserId], (_ctx, tenant, user) => …)`. Флаг
`publish: true` включил бы публикацию событий открытия и закрытия
подписки: их слушает тот, кто собирает картину по всем процессам.

Проверка DI-токена устроена так же:

```typescript
// src/plugins/auth/index.ts
export const auth = makePlugin({
  name: 'app-auth',
  providers: [Authenticate],
});

export const authed = compose(
  traced,
  makePipeline().pre(Authenticate, { errors: [Unauthorized] }),
);
```

Класс-шаг `Authenticate` нужен endpoint'ам обеих фич, поэтому
регистрирует его плагин. Модуль, достижимый из двух фич, обязан быть
плагином: пока у него два владельца, ребро в него нельзя отнести ни к
одной фиче, и сборка останавливается с предложением перенести модуль в
`plugins:`.

## Модули внутри фичи

```typescript
// src/features/users/users.feature.ts
export const UsersModule = makeModule({
  name: 'module:users',
  providers: [
    Database,
    classProvider(UsersRepository$, DbUsersRepository),
    ActivityHub,
    AuditDeletion,
    VerifySignature,
  ],
});

export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  endpoints: [
    ListUsers,
    GetUser,
    CreateUser,
    // …
  ],
});
```

Фича принимает провайдеры двумя способами: списком `providers:` или
списком модулей `modules:`. Модуль группирует провайдеры под именем и
полем `dependsOn` перечисляет модули, без которых не работает. Модуль
подходит фиче, у которой провайдеров много или которые уже собраны в
модуль для другого приложения. Фича `notifications` обходится
`providers:`: у неё два сервиса. Endpoint'ы в обоих случаях перечисляет фича, а не
модуль.

## Декларация приложения

```typescript
// src/app.ts
export const app = makeApp({
  features: [UsersFeature, NotificationsFeature],
  plugins: [
    observability,
    auth,
    subscriptions,
    // Плагин документации стоит под переключателем состава — его вводит
    // [глава 19](./19-select.md)
    DocsEnabled.when(openapi),
  ],
  switches: [DocsEnabled],
  // Два протокола на одном сокете: рецепт
  // [«Отдать операции агенту по MCP»](../recipes/mcp.md)
  transports: [http({ server: api }), mcp({ … })],
  policies: [
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
      traced,
      'traced',
    ),
    everyEndpoint({
      transport: HttpTransport$('default'),
      pattern: /^(POST|PATCH|DELETE) /,
    }).hasLayer(authed, 'authed'),
    // …
  ],
});
```

Значение параметризованного плагина создаётся один раз и импортируется:
второй вызов `makeSubscriptions({ … })` дал бы второй плагин с тем же
именем, и сборка остановилась бы.

## Проверка

```typescript
// src/app.spec.ts
it('возвращает отказ соседней фичи на отвергнутый адрес', async () => {
  await using testApp = await buildTest(app, {
    ...testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });

  // Отказ прошёл границу вызывающего endpoint'а без замены на
  // `InternalError`: его `errors:` объявляет отказ соседа наравне со своими
  expect(await createUser(testApp, 'eve@example.invalid')).toMatchObject({
    isSuccess: false,
    status: 'conflict',
    value: { code: AddressRejected.code },
  });
});
```

Реализация операции вызывается в тесте так же, как HTTP-endpoint:
`testApp.call(CheckAddressImpl, { email })`. Отдельный тест достаёт вызыватель
через `testApp.get(CheckAddress.caller)` и вызывает его с истёкшим `deadline`:
ответ приходит с кодом `timeout`, а реализация не вызывается.

Ещё один тест запускает регистрацию при двух политиках диспатча.
Политика задаётся конфигом `NESTLING_PORTS_DISPATCH`: `local-first`
вызывает реализацию из этого же процесса напрямую, `always-remote`
отправляет каждый вызов через шину как сообщение. Код вызова при этом не
меняется.

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook yarn start:dev
curl -s -X POST localhost:3000/users \
  -H 'authorization: Bearer secret' -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"carol@example.com"}'
```

Тот же запуск с `NESTLING_PORTS_DISPATCH=always-remote` отправляет
вызов `notifications.check-address` через шину внутри процесса.

Рассылка узнаёт о новом пользователе не по запросу, а по событию:
[15. Оповещать соседей о случившемся](./15-events.md).
