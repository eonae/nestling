# Порты: общение фич контрактами

> Гайд по **текущему API**; сверено с кодом `examples.app-with-http` (2026-07-31).

Соседняя фича зовётся не токеном её сервиса, а **контрактом**. Разница
видна в день, когда фичи разъедутся по процессам: общий токен переезд не
переживёт, контракт переживёт — потому что вызов уже async, уже Fail-able и
уже не транзакционен.

```typescript
import { makeContract } from '@nestling/ports';

export const ClaimQuota = makeContract({
  name: 'quotas.claim',                        // адрес: subject шины и ключ дискавери
  kind: 'request',                             // 'request' | 'command' | 'event'
  input: z.object({ email: z.string() }),
  output: z.object({ remaining: z.number() }),
  errors: [QuotaExceeded],                     // типизированный канал отказов
});
```

Контракт — значение: он ничего не регистрирует ни в модуле, ни в
приложении. На приложение он влияет только двумя способами — кто-то его
**реализует** и кто-то его **зовёт**.

## Три вида

| Вид | Семантика | Владельцев | Вызыватель |
|---|---|---|---|
| `request` | req-reply, Fail-able | ровно один | `.port` → `call(input, meta?)` |
| `command` | fire-and-forget | ровно один | `.emitter` → `emit(payload, meta?)` |
| `event` | broadcast-факт | 0..N подписчиков | `.emitter` → `emit(payload, meta?)` |

Здоровый дефолт кросс-фичевого общения — событийный: `request` вносит
временну́ю связанность (пока сосед не ответил, ты ждёшь), `event` — нет.

Версия — часть имени (`users.create.v2`); отдельного поля версии нет, потому
что имя и есть адрес.

Свойство `.port` есть только у `request`, `.emitter` — только у
`command`/`event`. Обращение к чужому — ошибка компиляции (свойства нет в
типе) и рантайм-ошибка с именем контракта для JS-потребителей.

## Реализация — обычная декларация

```typescript
// packages/examples.app-with-http/src/modules/quotas/quotas.module.ts
import { implement } from '@nestling/ports';

export const ClaimQuotaImpl = implement(ClaimQuota, {
  deps: [QuotaService, ILogger],
  handle: (quotas, logger) => async (payload) => {
    const claimed = quotas.claim();

    if (!claimed.ok) {
      return QuotaExceeded({ limit: quotas.limit });   // отказ — данные
    }

    return new Ok({ remaining: claimed.remaining });
  },
});

export const QuotasModule = makeAppModule({
  name: 'module:quotas',
  providers: [QuotaService],
  endpoints: [ClaimQuotaImpl, UserRegisteredInQuotas],   // рядом с HTTP-ручками
});
```

`implement` — такой же конструктор деклараций, как `httpEndpoint` и
`cliEndpoint`, и построен над тем же kernel-примитивом. Отсюда всё, что
достаётся бесплатно: дискавери из дерева выбранных модулей, `dispatch`,
pipeline и страж границы, `policies` и `detached`, отчёт `check()` и вызов
по значению в тестах (`app.call(ClaimQuotaImpl, payload)`).

`input`, `output` и `errors` из контракта **не переобъявляются** — попытка
задать их в словаре реализации это ошибка компиляции: интерфейс операции
принадлежит контракту.

### `subscriber` — адрес подписки события

У события подписчиков много, поэтому каждая реализация называет себя:

```typescript
export const UserRegisteredInQuotas = implement(UserRegistered, {
  subscriber: 'quotas',        // паттерн ручки: 'users.registered@quotas'
  deps: [ILogger],
  handle: (logger) => async (payload) => {
    logger.log(`quota bookkeeping: user ${payload.id}`);

    return undefined;          // у события ответа нет
  },
});
```

Правило простое: `subscriber` **обязателен** для `event` и **запрещён** для
`request`/`command` (у них владелец ровно один, и второй `implement` — ошибка
сборки с именами обоих модулей). Имя задаётся явно: с брокером оно станет
именем queue-group и durable-подписки, поэтому выводить его из имени модуля
нельзя — сетевой адрес не должен зависеть от структуры кода.

## Потребление — инжект вызывателя

```typescript
// packages/examples.app-with-http/src/modules/users/endpoints/create-user.endpoint.ts
export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/api/users',
  input: CreateUserInput,
  output: CreateUserOutput,
  errors: [EmailTaken, QuotaExceeded],       // отказ соседа — часть контракта ручки
  pipeline: basePipeline,
  deps: [UserService, ILogger, ClaimQuota.port, UserRegistered.emitter],
  handle: (users, logger, quotas, registered) => async (payload) => {
    const claimed = await quotas.call({ email: payload.email });
    if (claimed.isFail) {
      return claimed;                        // разобрать отказ обязан вызывающий
    }

    const user = await users.create(payload);
    await registered.emit({ id: user.id, email: user.email });

    return Ok.created(user);
  },
});
```

`.port` и `.emitter` — обычные токены (члены token-семейств), поэтому они
работают везде, где работает токен: `deps` провайдера, `deps` декларации,
`@Injectable`. Регистрировать в корне ничего не нужно: узел вызывателя
появляется ровно для тех контрактов, которые кто-то упомянул.

Форма вызова:

- `port.call(input, meta?)` → `Promise<Ok<Output> | Fail<E ∪ UnknownError>>`;
- `emitter.emit(payload, meta?)` → `Promise<void>` по факту **доставки**,
  не обработки; отказ подписчика вызывающему не всплывает.

`meta` пока несёт только `signal: AbortSignal`; словарь открыт под
`deadline` и `idempotencyKey`, которые приедут отдельным change'ем и
call-site не изменят.

### Отказ — значение, закрытое множество

Ответ порта нормализуется одной процедурой на обоих путях биндинга: код
отказа сопоставляется с `errors:` контракта, и при совпадении вызывающий
получает **настоящий** `Fail` — со `status`, `code` и валидными `details`:

```typescript
const claimed = await quotas.call({ email });

if (QuotaExceeded.is(claimed)) {
  // claimed.details.limit типизирован схемой определения
}
```

Незадекларированный код и необработанное исключение становятся
`UnknownError`, а оригинал уходит в диагностический хук — `stack` и
внутренние сообщения границу порта не пересекают, ровно как не пересекли бы
провод. Невалидный вход отвергается `ValidationFailed` до вызова
реализации. Оба кода kernel-ные, поэтому множество ответов остаётся
закрытым: `errors: ∪ { UNKNOWN, VALIDATION_FAILED }`.

## Политика диспатча — конфиг, а не код

Куда пойдёт вызов, решает **сборка**, а не запрос:

| Политика | Что делает |
|---|---|
| `local-first` (по умолчанию) | co-located реализация зовётся через `dispatch` шины: полный pipeline, без копирования payload |
| `always-remote` | тот же вызов уходит через шину: async-барьер, структурная копия payload и ответа, валидация ответа по `output`-схеме |

```bash
NESTLING_PORTS_DISPATCH=always-remote yarn start
```

```typescript
// в тесте — тем же механизмом конфигурации, без process.env
await using app = await assembleTest({
  ...spec,
  config: vars({ NESTLING_PORTS_DISPATCH: 'always-remote' }),
});
```

`always-remote` в V1 — не поднятый брокер, а **репетиция провода**: то, что
не переживает `structuredClone`, ломается здесь, в dev и в тестах, а не в
проде после разъезда фич. Несериализуемое поле называется в отказе поимённо.

Call-site при смене политики не меняется ни на строчку — это и есть
проверка того, что политика действительно конфиг.

## Что проверяется на сборке

Фаза ASSEMBLE отвергает всё, что проверяемо без сети:

- `request`/`command`, у которого **нет co-located реализации** среди
  выбранных фич (в V1 remote-биндинга не существует): текст называет
  контракт, его вид и способ починки;
- второй `implement` того же `request`/`command` — с именами обоих модулей;
- два подписчика `event` с одинаковым `subscriber`;
- `event` без `subscriber` и `subscriber` у `request`/`command`;
- контракт с формами `stream`/`events`: способности шины — только `value`.

Событие без подписчиков легально: broadcast с нулём слушателей — нормальное
состояние, и `emit` просто доставляет ноль раз.

Отсюда и `dependsOn` в примере: фича `users` зовёт `quotas`, поэтому
топология «users без quotas» не поднимается — и это видно на ASSEMBLE, а не
на первом запросе.

## Фазы: когда порт готов

`dispatch` рождается в фазе WIRE, и там же происходит единственное позднее
связывание — вызыватели получают исполнитель, а шина подписывается на
subject'ы своих маршрутов:

| Фаза | Порт |
|---|---|
| 2 INIT (`@OnInit`) | вызов — ошибка «порт вызван до фазы WIRE» |
| 3 WIRE | связывание вызывателей и подписка шины |
| 4 START (`@OnStart`) | вызов исполняется |

Ошибка вместо молчаливого ожидания — намеренно: код, зовущий порт в
`@OnInit`, падает детерминированно, а не иногда.

## Дисциплина, выраженная кодом

- **Вызов не транзакционен.** Порт исполняется через `dispatch.call`, то
  есть в **собственном** request-scope: ambient-контекст вызывающего внутрь
  реализации не протекает (`propagate` по проводу приедет с NATS), и общей
  транзакции между фичами не существует — её негде завести.
- **Локальный порт умеет падать.** Синхронной формы вызова и формы,
  бросающей отказ вместо возврата, нет: иначе потребители не обрабатывали бы
  `Fail`, и разъезд по процессам их сломал бы.
- **Вход валидируется на обоих путях** — как валидировался бы на границе,
  если бы запрос пришёл по проводу.

## Шина

`IMessageBus` — наименьший общий знаменатель глаголов брокера
(`request` / `publish` / `subscribe` с группой доставки). Специфика
конкретного брокера за эту границу не протекает; ядро зависит только от
интерфейса.

`InProcessBus` — одно значение с двумя способностями: `IMessageBus`
(исходящая сторона) и `ITransport` (входящая). Broadcast построен на `Topic`
из `@nestling/streams`, поэтому публикация никогда не ждёт медленного
подписчика; команда доставляется ровно одному члену группы, событие — всем
подписчикам. `durable`, ретраев и персистентности в V1 нет: без внешнего
брокера им негде жить.

В корне про шину не пишется ничего: kernel-модуль портов регистрируется
всегда, а транспорт шины появляется в графе только тогда, когда в
приложении есть хоть одна реализация контракта.

## Что дальше

- Порты по-настоящему удалённые, queue-groups и JetStream — change
  `transport.nats`.
- `meta.deadline` и `idempotencyKey` — change `port-deadline-idempotency`.
- `stub(Contract, impl)` для тестов без соседней фичи — остаток
  `testing-package`.
- Внешний клиент из контракта (`makeClient`) — change `contract-clients`.

Целевое состояние подсистемы целиком — [`design/contracts.md`](../design/contracts.md).
