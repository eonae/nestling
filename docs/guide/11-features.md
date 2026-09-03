# 11. Выделить вторую область и не дать ей лезть в чужие сервисы

> Гайд по текущему API; сверено с кодом `examples.app-with-http` (2026-09-03).
> Целевое описание: [design/composition.md](../design/composition.md),
> разделы «Граница фичи» и «Плагин», и
> [design/operations.md](../design/operations.md). Почему так: записи
> [ideas.md](../decisions/ideas.md) «[2026-09-02] Модель композиции: фича,
> плагин, операция», «[2026-07-08] Порты: межфичевое общение через
> контракты» и «[2026-07-08] Kernel/user space; конфиг как token-families;
> плагины».

## Задача

Регистрацию пользователей ограничивает квота, и её ведёт другая команда.
Код квот должен жить отдельно: у него свои сервисы, свои тесты и свой
владелец. Фича пользователей не должна инжектить сервис квот, потому что
однажды квоты уедут в отдельный процесс, и код регистрации при этом не
должен измениться. Логирование и проверка токена при этом остаются
общими для обеих областей.

## Решение

Сервис из частей 1 и 2 продолжается в `examples.app-with-http`. Файлы
переложены по областям: фичи лежат в `src/features/<имя>/`, общая
инфраструктура в `src/plugins/<имя>/`, словарь сборки в `src/root.ts`.
Код endpoint'ов, хранилища и конфига тот же, что в
`examples.users-service`.

### Шаг 1. Вторая фича

```typescript
// packages/examples.app-with-http/src/features/quotas/quota.service.ts
@Injectable([])
export class QuotaService {
  /** Лимит пользователей; в примере намеренно маленький */
  readonly limit = 5;

  #used = 0;

  /** Занимает место или отвечает «мест нет» */
  claim(): { ok: true; remaining: number } | { ok: false } {
    if (this.#used >= this.limit) {
      return { ok: false };
    }

    this.#used += 1;

    return { ok: true, remaining: this.limit - this.#used };
  }
}
```

```typescript
// packages/examples.app-with-http/src/features/quotas/quotas.feature.ts
export const QuotasFeature = makeFeature({
  name: 'quotas',
  providers: [QuotaService, SignupJournal],
  endpoints: [ClaimQuotaImpl, UserRegisteredInQuotas, SignupRecordedImpl],
});
```

Фича `quotas` объявлена так же, как `users`: имя, провайдеры и
endpoint'ы. `QuotaService` не экспортируется наружу и в `deps` других фич
не попадает. Что лежит в `endpoints:`, объясняют шаги 4 и 5 и
[глава 12](./12-events.md).

### Шаг 2. Граница фич

Фича не может зависеть от провайдера другой фичи. Если в фиче `users`
объявить провайдер `UsersReport` с `@Injectable([QuotaService])`, сборка
остановится на фазе ASSEMBLE:

```
1 edge(s) cross a feature boundary:

  - Feature 'users' depends on feature 'quotas' by token: 'UsersReport'
    injects 'QuotaService'. Features are connected by operations only — a token does
    not survive a process boundary, so this edge breaks the moment the two
    features are deployed apart. Declare the call as an operation
    (makeRequest / makeCommand), inject its '.caller' and implement it in
    'quotas'.
```

Проверка выполняется на собранном графе и различает три вида рёбер.

| Ребро | Вердикт |
|---|---|
| провайдер фичи зависит от провайдера другой фичи | ошибка сборки |
| провайдер фичи зависит от провайдера плагина | разрешено |
| провайдер плагина зависит от провайдера фичи | ошибка сборки |

К фиче обращаются операциями, к плагину токенами. Токен работает только
внутри процесса, операция имеет адрес и схемы и работает через любой
транспорт.

### Шаг 3. Операция вместо токена

```typescript
// packages/examples.app-with-http/src/operations.ts
import {
  defineFail,
  makeCommand,
  makeEvent,
  makeRequest,
} from '@nestling/operations';
import { z } from 'zod';

/** Отказ «квота исчерпана». По сети приходит кодом и восстанавливается в `Fail` */
export const QuotaExceeded = defineFail('QUOTA_EXCEEDED', {
  status: 'TOO_MANY_REQUESTS',
  details: z.object({ limit: z.number() }),
  message: (d) => `User quota of ${d.limit} is exhausted`,
});

export const ClaimQuotaInput = z.object({ email: z.string() });

export type ClaimQuotaInput = z.infer<typeof ClaimQuotaInput>;

export const ClaimQuota = makeRequest({
  name: 'quotas.claim',
  input: ClaimQuotaInput,
  output: z.object({ remaining: z.number() }),
  errors: [QuotaExceeded],
});
// …
```

Операция — единица общения между фичами: имя, схемы `input` и `output`,
список `errors`. Она объявлена в файле вне обеих фич, потому что не
принадлежит ни вызывающему, ни реализующему. Файл импортирует только
`@nestling/operations` и `zod`, поэтому операцию может импортировать и
фронтенд.

`makeRequest` объявляет операцию вида `request`: вызывающий ждёт ответ
`Ok` или `Fail`, владелец у операции ровно один. Два других вида
появятся в [главе 12](./12-events.md).

### Шаг 4. Реализация в фиче-владельце

```typescript
// packages/examples.app-with-http/src/features/quotas/quotas.feature.ts
export const ClaimQuotaImpl = implement(ClaimQuota, {
  deps: [QuotaService, Logger$],
  handle:
    (quotas: QuotaService, logger: Logger) =>
    async (payload: ClaimQuotaInput) => {
      const claimed = quotas.claim();

      if (!claimed.ok) {
        logger.log(`quota exhausted, refusing ${payload.email}`);

        // Вызывающий получит `Fail` и узнает его через `QuotaExceeded.is()`
        return QuotaExceeded({ limit: quotas.limit });
      }

      return { remaining: claimed.remaining };
    },
});
```

`implement(Operation, { deps, handle })` создаёт декларацию endpoint'а на
транспорте шины. От `httpEndpoint` она отличается конструктором и
адресом: паттерном служит имя операции. Схемы `input`, `output` и
`errors` берутся из операции и в реализации не повторяются. Всё
остальное общее: `deps`, каррированный хендлер, вход проверяется по
схеме, отказ вне списка `errors` заменяется на `UnknownError`.
Реализация перечисляется в `endpoints:` фичи рядом с HTTP-endpoint'ами.

### Шаг 5. Вызов через вызыватель

```typescript
// packages/examples.app-with-http/src/features/users/endpoints/create-user.endpoint.ts
const QUOTA_CALL_BUDGET_MS = 500;

export const createUserHandler =
  (
    users: UsersRepository,
    quotas: Port<typeof ClaimQuota>,
    // …
  ) =>
  async (
    payload: CreateUserInput,
  ): Output<User, FailOf<typeof EmailTaken> | FailOf<typeof QuotaExceeded>> => {
    if (await users.byEmail(payload.email)) {
      return EmailTaken({ email: payload.email });
    }
    // …
    const claimed = await quotas.call(
      { email: payload.email },
      { deadline: deadlineIn(QUOTA_CALL_BUDGET_MS) },
    );

    if (claimed.isFail) {
      // Отказ соседа объявлен в `errors:` операции и уходит клиенту как
      // есть. Исчерпанный бюджет приходит кодом ядра `DEADLINE_EXCEEDED`,
      // объявлять его не нужно
      return claimed as FailOf<typeof QuotaExceeded>;
    }

    const user = await users.insert({
      name: payload.name,
      email: payload.email,
    });
    // …
    return Ok.created(user, { Location: `/users/${user.id}` });
  };

export const CreateUser = httpEndpoint({
  operation: CreateUserOperation,
  pipeline: authed,
  deps: [
    UsersRepository$,
    ClaimQuota.caller,
    // …
  ],
  handle: createUserHandler,
});
```

`ClaimQuota.caller` — токен вызывателя. Он перечисляется в `deps` как
обычная зависимость, и хендлер получает объект типа `Port<typeof
ClaimQuota>` с методом `call(input, meta?)`. Вызов всегда асинхронный и
всегда возвращает `Ok` или `Fail`, даже когда реализация работает в
этом же процессе. Отказ разбирает вызывающий.

Второй аргумент `call` — параметры вызова. `deadline` задаёт бюджет
времени моментом, а не длительностью: `deadlineIn(500)` вычисляет момент
из миллисекунд. Бюджета по умолчанию нет. Исчерпанный бюджет приходит
отказом с кодом ядра `DEADLINE_EXCEEDED` и статусом `TIMEOUT`; в
`errors:` он не объявляется, как и `UNKNOWN`.

Отказ соседа `QuotaExceeded` доходит до клиента, потому что операция
`users.create` перечисляет его в `errors:` наравне со своими:

```typescript
// packages/examples.app-with-http/src/api/operations.ts
export const CreateUser = makeRequest({
  name: 'users.create',
  http: { method: 'POST', path: '/users', bind: { dryRun: query() } },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken, QuotaExceeded, Unauthorized],
  // …
});
```

Шестая регистрация подряд получает `429`:

```bash
curl -X POST localhost:3000/users \
  -H 'authorization: Bearer secret' -H 'content-type: application/json' \
  -d '{"name":"User 6","email":"user6@example.com"}'
# {"error":"User quota of 5 is exhausted","code":"QUOTA_EXCEEDED","details":{"limit":5}}
```

### Шаг 6. Общее уходит в плагины

Логгер и слой `observability` нужны обеим фичам. Провайдер, от которого
зависят две фичи, объявляется плагином:

```typescript
// packages/examples.app-with-http/src/plugins/logging/logging.plugin.ts
export interface LoggingOptions {
  /** Имя сервиса в префиксе каждой записи */
  service: string;
}

export const logging = (options: LoggingOptions): Plugin =>
  makePlugin({
    name: 'app-logging',
    providers: [
      // Фабрика соединяет параметр плагина и значение из секции
      factoryProvider(
        Logger$,
        (config: Config<typeof LoggerConfig>) =>
          new ConsoleLogger(options.service, config.level),
        [LoggerConfig],
      ),
      // Класс-юнит слоя `observability`: без регистрации слой не соберётся
      AuditOutcome,
    ],
  });
```

Плагин — сквозная инфраструктура. `makePlugin` принимает то же, что
`makeFeature`: имя, провайдеры, при необходимости endpoint'ы. Разница в
роли: плагин перечисляется в `plugins:` корня, есть в каждом процессе, и
фичи обращаются к нему токенами.

Параметризованный плагин — функция, которая возвращает значение. Имя
сервиса задаёт параметр, потому что оно решается при сборке. Уровень
логирования приходит из конфиг-секции, потому что он меняется без
пересборки:

```typescript
// packages/examples.app-with-http/src/plugins/logging/logger.config.ts
export const LoggerConfig = makeConfig('log', {
  level: z.enum(['debug', 'info', 'error']).default('info'),
});

/** Право привязать источник к ключам секции. Токен секции наружу не выходит */
export const loggerConfigKeys = LoggerConfig.keys;
```

Из плагина экспортируются фабрика, токен `Logger$`, слой `observability`
и `loggerConfigKeys`. Токен секции остаётся внутри: инжектировать её
из фичи нельзя, а привязать источник к её ключам через `config:` в корне
можно.

Проверка токена устроена так же:

```typescript
// packages/examples.app-with-http/src/plugins/auth/index.ts
export const appAuth = makePlugin({
  name: 'app-auth',
  providers: [Authenticate],
});

export const authed = compose(observability, makePipeline().pre(Authenticate));
```

Класс-юнит `Authenticate` нужен endpoint'ам фич `users` и `ops`, поэтому
регистрирует его плагин. Модуль, достижимый из двух фич, обязан быть
плагином: пока у него два владельца, ребро в него нельзя отнести ни к
одной фиче, и сборка останавливается с предложением перенести модуль в
`plugins:`.

### Шаг 7. Модули внутри фичи

```typescript
// packages/examples.app-with-http/src/features/users/users.feature.ts
export const UsersModule = makeModule({
  name: 'module:users',
  providers: [
    Database,
    DbUsersRepository,
    ActivityHub,
    ExportUsersHandler,
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
модуль для другого приложения. Фича `quotas` обходится `providers:`:
у неё два сервиса. Endpoint'ы в обоих случаях перечисляет фича, а не
модуль.

### Шаг 8. Словарь сборки

```typescript
// packages/examples.app-with-http/src/root.ts
export const appLogging = logging({ service: 'app-with-http' });
// …
export const rootSpec = {
  features: [UsersFeature, QuotasFeature, OpsFeature],
  plugins: [
    appLogging,
    appAuth,
    appSubscriptions,
    openapi({
      info: { title: 'Users API', version: '1.0.0' },
      converters: [zodConverter()],
      pipeline: observability,
    }),
  ],
  transports: [http()],
  policies: [
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
      observability,
      'observability',
    ),
    everyEndpoint({
      transport: HttpTransport$('default'),
      pattern: /^(POST|PATCH|DELETE) /,
    }).hasLayer(authed, 'authed'),
    // …
  ],
};
```

Значение параметризованного плагина создаётся один раз и импортируется:
второй вызов `logging({ … })` дал бы второй плагин с тем же именем, и
сборка остановилась бы. Фича `ops` описана в [главе 22](./22-ops.md).

## Что гарантирует фреймворк

- Ребро между провайдерами двух фич и ребро из плагина в фичу
  останавливают сборку на фазе ASSEMBLE с текстом, который называет обе
  фичи и токен.
- Операция вида `request`, чей вызыватель инжектирован, а реализация в
  сборке отсутствует, останавливает сборку: вызову некуда идти. Два
  владельца одной операции тоже останавливают сборку.
- Переобъявить `input`, `output` или `errors` в `implement` нельзя: это
  ошибка компиляции.
- Множество ответов вызывателя закрыто: объявленные отказы плюс коды
  ядра. Тип `claimed` не содержит ничего другого, и ветка `default` на
  месте вызова не нужна.
- Отказ соседа, которого нет в `errors:` вызывающего endpoint'а,
  заменяется на `UnknownError` на выходе из пайплайна.

## Как проверить

```typescript
// packages/examples.app-with-http/src/app.spec.ts
it('возвращает отказ соседней фичи при исчерпанной квоте', async () => {
  await using app = await assembleTest({
    ...spec,
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });

  for (const index of [1, 2, 3, 4, 5]) {
    unwrap(await createUser(app, String(index)));
  }

  // Отказ прошёл границу вызывающего endpoint'а без замены на
  // `UnknownError`: его `errors:` объявляет отказ соседа наравне со своими
  expect(await createUser(app, 'sixth')).toMatchObject({
    isSuccess: false,
    status: 'TOO_MANY_REQUESTS',
    value: { code: QuotaExceeded.code, details: { limit: 5 } },
  });
});
```

Реализация операции вызывается в тесте так же, как HTTP-endpoint:
`app.call(ClaimQuotaImpl, { email })`. Отдельный тест достаёт вызыватель
через `app.get(ClaimQuota.caller)` и вызывает его с истёкшим `deadline`:
ответ приходит с кодом `DEADLINE_EXCEEDED`, а реализация не вызывается.

Ещё один тест запускает регистрацию при двух политиках диспатча.
Политика задаётся конфигом `NESTLING_PORTS_DISPATCH`: `local-first`
вызывает реализацию из этого же процесса напрямую, `always-remote`
отправляет каждый вызов через шину как сообщение. Код вызова при этом не
меняется.

## Пока не нужно

- Событие и команда, два других вида операций: [глава 12](./12-events.md).
- Запуск части фич через `select`, который уже стоит в `main.ts`:
  [глава 15](./15-select.md).
- Брокер вместо шины внутри процесса: [глава 16](./16-split.md).
- Версия операции и проверка совместимости:
  [глава 17](./17-compatibility.md).

## Запускаемый код

- `packages/examples.app-with-http/src/operations.ts` — операции между
  фичами.
- `packages/examples.app-with-http/src/features/quotas/` — фича-владелец.
- `packages/examples.app-with-http/src/features/users/endpoints/create-user.endpoint.ts`
  — вызов через вызыватель.
- `packages/examples.app-with-http/src/plugins/logging/`,
  `packages/examples.app-with-http/src/plugins/auth/` — плагины.
- `packages/examples.app-with-http/src/root.ts` — словарь сборки.
- `packages/examples.app-with-http/src/app.spec.ts` — тесты отказа
  соседа, `deadline` и политики диспатча.

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook yarn workspace examples.app-with-http start:dev
for i in 1 2 3 4 5 6; do
  curl -s -X POST localhost:3000/users \
    -H 'authorization: Bearer secret' -H 'content-type: application/json' \
    -d "{\"name\":\"User $i\",\"email\":\"user$i@example.com\"}"; echo
done
```

Тот же запуск с `NESTLING_PORTS_DISPATCH=always-remote` отправляет
вызов `quotas.claim` через шину внутри процесса.

## Дальше

Квоты узнают о новом пользователе не по запросу, а по событию:
[12. Оповещать соседей о случившемся](./12-events.md).
