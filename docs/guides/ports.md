# Порты: общение фич через контракты

> Гайд по **текущему API**; сверено с кодом `examples.app-with-http` (2026-09-01);
> разделы про split-развёртывание и провоз контекста — с `examples.split-nats`.

Когда одной фиче нужна операция другой, она не инжектит чужой сервис по
токену, а вызывает его через контракт: описание операции с именем, схемами
входа и выхода и списком ошибок.

```typescript
// packages/examples.app-with-http/src/contracts.ts
import { defineFail, makeContract } from '@nestling/contracts';

export const QuotaExceeded = defineFail('QUOTA_EXCEEDED', {
  status: 'TOO_MANY_REQUESTS',
  details: z.object({ limit: z.number() }),
  message: (d) => `User quota of ${d.limit} is exhausted`,
});

export const ClaimQuota = makeContract({
  name: 'quotas.claim',                        // адрес: subject шины и ключ discovery
  kind: 'request',                             // 'request' | 'command' | 'event'
  input: z.object({ email: z.string() }),
  output: z.object({ remaining: z.number() }),
  errors: [QuotaExceeded],                     // отказы, которые может вернуть реализация
});
```

Пока обе фичи работают в одном процессе, разница между контрактом и прямым
вызовом сервиса невелика. Она становится важной, когда фичи разносят по
разным процессам. Прямой вызов сервиса тогда пришлось бы переписывать: он
синхронный, бросает исключения и выполняется в транзакции вызывающего.
Вызов через контракт с самого начала асинхронный, возвращает ошибки
значением `Fail` и в транзакцию вызывающего не входит. Поэтому при переезде
код фичи не меняется.

Контракт — значение. Он ничего не регистрирует ни в модуле, ни в
приложении. В приложение он попадает двумя путями: кто-то его реализует
(`implement`) и кто-то его вызывает (`Contract.port` или
`Contract.emitter` в `deps`).

## Три вида контрактов

| Вид | Семантика | Владельцев | Как вызывается |
|---|---|---|---|
| `request` | запрос-ответ, может вернуть `Fail` | ровно один | `.port` → `call(input, meta?)` |
| `command` | без ответа, отправил и забыл | ровно один | `.emitter` → `emit(payload, meta?)` |
| `event` | факт, который уже случился | 0..N подписчиков | `.emitter` → `emit(payload, meta?)` |

`request` заставляет вызывающего ждать, пока сосед ответит; `event` — нет.
Поэтому для связи между фичами по умолчанию выбирайте событие, а `request`
оставляйте для случаев, когда без ответа продолжить нельзя.

Версия контракта входит в его имя: `users.create.v2`. Отдельного поля
версии нет, потому что имя используется как адрес в шине, и второе поле
стало бы вторым адресом.

Свойство `.port` есть только у `request`, `.emitter` — только у `command`
и `event`. Обращение к чужому свойству не компилируется, а из JS даёт
ошибку с именем контракта.

## Реализация контракта

```typescript
// packages/examples.app-with-http/src/modules/quotas/quotas.module.ts
import { implement } from '@nestling/ports';

export const ClaimQuotaImpl = implement(ClaimQuota, {
  deps: [QuotaService, ILogger],
  handle: (quotas, logger) => async (payload) => {
    const claimed = quotas.claim();

    if (!claimed.ok) {
      logger.log(`quota exhausted, refusing ${payload.email}`);

      return QuotaExceeded({ limit: quotas.limit });   // отказ возвращается значением
    }

    return new Ok({ remaining: claimed.remaining });
  },
});

export const QuotasModule = makeAppModule({
  name: 'module:quotas',
  imports: [appLogging],
  providers: [QuotaService, SignupJournal],
  endpoints: [ClaimQuotaImpl, UserRegisteredInQuotas, SignupRecordedImpl],   // рядом с HTTP-endpoint'ами
});
```

`implement` — такой же конструктор декларации, как `httpEndpoint` и
`cliEndpoint`. Реализация контракта — обычный endpoint, и с ней работает
всё, что работает с endpoint'ами: discovery по дереву выбранных модулей,
`dispatch`, пайплайн, проверка ответа по списку `errors`, `policies` и
`detached`, отчёт `check()` и вызов по значению в тестах
(`app.call(ClaimQuotaImpl, payload)`).

`input`, `output` и `errors` в реализации не объявляются повторно. Попытка
задать их в словаре `implement` не компилируется: интерфейс операции
принадлежит контракту.

### Подписчик события: `subscriber`

У события может быть несколько подписчиков, поэтому каждая реализация
события называет себя:

```typescript
export const UserRegisteredInQuotas = implement(UserRegistered, {
  subscriber: 'quotas',        // паттерн endpoint'а: 'users.registered@quotas'
  deps: [ILogger],
  handle: (logger) => async (payload) => {
    logger.log(`quota bookkeeping: user ${payload.id} (${payload.email})`);

    return undefined;          // у события ответа нет
  },
});
```

`subscriber` обязателен для `event` и запрещён для `request` и `command`:
у них владелец ровно один, и вторая реализация того же контракта — ошибка
сборки с именами обоих модулей.

Имя подписчика задаётся явно, а не выводится из имени модуля. С брокером
оно становится именем queue-group и durable-подписки, то есть сетевым
адресом, а сетевой адрес не должен зависеть от структуры кода.

## Вызов контракта

Вызывающая сторона инжектит `Contract.port` или `Contract.emitter` как
обычную зависимость:

```typescript
// packages/examples.app-with-http/src/modules/users/endpoints/create-user.endpoint.ts (сокращено)
import type { Emitter, Port } from '@nestling/ports';
import { deadlineIn } from '@nestling/ports';

export const createUserHandler =
  (
    users: UserService,
    logger: ILoggerService,
    quotas: Port<typeof ClaimQuota>,
    registered: Emitter<typeof UserRegistered>,
    signup: Emitter<typeof SignupRecorded>,
  ) =>
  async (payload: CreateUserPayload) => {
    const claimed = await quotas.call(
      { email: payload.email },
      { deadline: deadlineIn(QUOTA_CALL_BUDGET_MS) },
    );
    if (claimed.isFail) {
      return claimed;                        // отказ соседа возвращается как есть
    }

    const user = await users.create(payload);

    await registered.emit({ id: user.id, email: user.email });
    await signup.emit(
      { userId: user.id, email: user.email },
      { idempotencyKey: user.id },
    );

    return Ok.created(user);
  };

export const CreateUser = httpEndpoint({
  contract: CreateUserContract,              // адрес, схемы и errors живут в контракте
  pipeline: basePipeline,
  deps: [
    UserService,
    ILogger,
    ClaimQuota.port,
    UserRegistered.emitter,
    SignupRecorded.emitter,
  ],
  handle: createUserHandler,
});
```

`.port` и `.emitter` — обычные токены (члены семейств токенов). Они
работают везде, где работает токен: в `deps` провайдера, в `deps`
декларации, в `@Injectable`. В корне ничего регистрировать не нужно: узел
вызывателя создаётся при сборке для каждого контракта, который кто-то
упомянул в `deps`.

Форма вызова:

- `port.call(input, meta?)` возвращает
  `Promise<Ok<Output> | Fail<E ∪ UnknownError>>`;
- `emitter.emit(payload, meta?)` возвращает `Promise<void>`. Промис
  разрешается, когда сообщение доставлено, а не когда обработано. Отказ
  подписчика до вызывающего не доходит.

`meta` — параметры вызова: `signal`, `deadline` и, только у `command`,
`idempotencyKey`. Подробнее — в разделе «Параметры вызова».

### Ответ порта

Ответ порта обрабатывается одинаково для реализации в том же процессе и
для реализации за шиной. Код отказа сопоставляется со списком `errors`
контракта. При совпадении вызывающий получает настоящий `Fail` этого
определения — со `status`, `code` и проверенными схемой `details`:

```typescript
const claimed = await quotas.call({ email });

if (QuotaExceeded.is(claimed)) {
  // claimed.details.limit типизирован схемой определения
}
```

Отказ с кодом, которого нет в `errors`, и любое необработанное исключение
превращаются в `UnknownError`. Оригинал уходит в диагностический хук;
стек и внутренние сообщения границу порта не пересекают, как не пересекли
бы они сетевую границу. Невалидный вход отвергается отказом
`ValidationFailed` до вызова реализации.

Коды `UNKNOWN`, `VALIDATION_FAILED` и `DEADLINE_EXCEEDED` — коды ядра.
Они не объявляются в `errors`, но входят в множество ответов любого порта.
Поэтому множество ответов остаётся закрытым: `errors` контракта плюс три
кода ядра.

## Параметры вызова: `meta`

Вызов реализации в том же процессе и вызов через брокер отличаются не
типом, а тем, сколько они могут длиться и что считать повтором. Оба
параметра передаются в `meta`.

### Бюджет вызова: `deadline`

```typescript
import { deadlineIn } from '@nestling/ports';

await quotas.call({ email }, { deadline: deadlineIn(500) });
await quotas.call({ email }, { deadline: order.expiresAt });  // момент уже есть
```

`deadline` — абсолютный момент времени (`Date`), а не длительность.
Длительность устаревает на каждом `await` между её вычислением и вызовом;
момент — нет. `deadline: 500` не компилируется: число одинаково читается и
как epoch-миллисекунды, и как «через 500 мс», а это разница между
мгновенным отказом и полусекундным бюджетом.

**Бюджета по умолчанию нет.** Вызов без `deadline` не ограничен по времени
и не заводит ни одного таймера.

Бюджет проверяется в трёх точках, и отказ везде один — `DeadlineExceeded`
(код `DEADLINE_EXCEEDED`, статус `TIMEOUT`, в HTTP — 504):

| Точка | Когда | Что происходит |
|---|---|---|
| до вызова | `call` / `emit` | остаток ≤ 0: отказ, ни `dispatch`, ни шина не вызываются |
| до обработки | приём сообщения | остаток ≤ 0: отказ, `dispatch.call` не вызывается |
| во время вызова | всё время вызова | срабатывает `ctx.signal` обработчика, вызов завершается отказом |

Сигнал, который видит обработчик, объединяет бюджет и `meta.signal`.
Реализация, которая проверяет свой `ctx.signal`, замечает исчерпание
бюджета сама. Отмена самим вызывающим по-прежнему даёт `UnknownError`:
два случая различаются по тому, кто владеет таймером, а не по
`signal.reason`, потому что `reason` приходит из чужого кода.

По сети передаётся относительный остаток бюджета (`timeoutMs`),
посчитанный отправителем по своим часам. Получатель превращает его обратно
в момент по своим часам. Рассинхрон часов между процессами на результат не
влияет: бюджет уменьшается только на время передачи. Под `local-first` и
`always-remote` поведение одинаково.

Код `DEADLINE_EXCEEDED` — код ядра. В `errors` он не объявляется, но
входит в множество ответов любого endpoint'а и любого порта, поэтому
`default`-ветка на месте вызова не нужна.

### Ключ идемпотентности: `idempotencyKey`

```typescript
await signup.emit({ userId, email }, { idempotencyKey: userId });
```

Поле `idempotencyKey` есть в `meta` только у вида `command`. У `request` и
`event` обращение к нему не компилируется, а не игнорируется молча.

`emit` команды всегда уходит с ключом: либо переданным вызывающим, либо
сгенерированным вызывателем. Ключ создаёт вызыватель, а не транспорт,
потому что ключ должен быть одним и тем же для всех попыток доставки одного
`emit` и разным для двух разных `emit`. Транспорт не знает, где кончается
один `emit`. Свой ключ передавайте там, где одно намерение шире одного
вызова: например, тот же `orderId` при повторной отправке после падения
процесса.

**Дедупликации в ядре нет.** Ядро гарантирует две вещи: ключ пройдёт через
транспорт и будет доступен обработчику. Отсев повторов по ключу пишется
поверх ядра отдельным модулем.

### Как реализация читает параметры вызова

Реализация получает `deadline` и `idempotencyKey` двумя способами:

| Канал | Что это | Когда доступен |
|---|---|---|
| `ctx.raw.attributes` | атрибуты транспорта, рядом с `subject` | всегда |
| `Ctx(Deadline)`, `Ctx(IdempotencyKey)` | ambient-переменные | когда в пайплайн реализации включён `withDeadline()` или `withIdempotencyKey()` |

Атрибуты хранят то, что пришло по сети. Ambient-переменная проецирует
атрибут в контекст: её может читать код любой глубины, а её наличие
проверяется на сборке. Переменные экспортируются значениями, чтобы
политика могла на них ссылаться:

```typescript
everyEndpoint({ transport: BusTransport$ }).hasVar(IdempotencyKey)
```

```typescript
// packages/examples.app-with-http/src/modules/quotas/signup.journal.ts
@Injectable([ILogger, Ctx(IdempotencyKey)])
export class SignupJournal {
  constructor(
    private readonly logger: ILoggerService,
    private readonly intent: CtxReader<string>,
  ) {}

  record(userId: string): void {
    this.logger.debug(`signup ${userId} recorded, intent ${this.intent.get()}`);
  }
}
```

Писатель переменной — `withIdempotencyKey()` в пайплайне реализации
`SignupRecordedImpl` (см. `quotas.module.ts`).

### Бюджет не наследуется вложенными вызовами

Вложенный вызов порта не подхватывает бюджет внешнего вызова, как не
подхватывает и `meta.signal`. Обработчик, который хочет передать остаток
бюджета дальше, читает его и передаёт явно:

```typescript
// иллюстрация, не из примера
@Injectable([Ctx(Deadline), ChargeCard.port])
class PlaceOrder {
  constructor(
    private readonly deadline: CtxReader<Date | undefined>,
    private readonly charge: Port<typeof ChargeCard>,
  ) {}

  run(input: Input) {
    return this.charge.call(input, { deadline: this.deadline.peek() });
  }
}
```

Так у `deadline` и `signal` одно правило, и вызов не может оборваться по
бюджету, которого вызывающий не задавал.

## Политика диспатча

Куда пойдёт вызов, решает сборка, а не запрос. Политика задаётся
конфигом:

| Политика | Что делает |
|---|---|
| `local-first` (по умолчанию) | реализация в том же процессе вызывается через `dispatch` шины: полный пайплайн, без копирования payload |
| `always-remote` | тот же вызов идёт через шину: асинхронный барьер, структурная копия payload и ответа, проверка ответа по схеме `output` |

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

`always-remote` без брокера ведёт себя как сетевой вызов: всё, что не
переживает `structuredClone`, ломается в dev и в тестах, а не в проде после
разнесения фич по процессам. Несериализуемое поле называется в отказе по
имени. С подключённым брокером та же политика отправляет каждый вызов
сообщением через брокер.

Код вызова при смене политики не меняется.

## Что проверяется на сборке

Фаза ASSEMBLE отвергает всё, что можно проверить без сети:

- `request` или `command`, у которого нет реализации среди выбранных фич,
  а шина не доставляет за пределы процесса. Ошибка называет контракт, его
  вид и обе починки: объявить реализацию или подключить шину с брокером. С
  брокером в `transports:` тот же вызов собирается и уходит через брокер
  (см. «Split-развёртывание» ниже);
- вторая реализация того же `request` или `command`. Ошибка называет оба
  модуля;
- два подписчика `event` с одинаковым `subscriber`;
- `event` без `subscriber` и `subscriber` у `request` или `command`;
- контракт с формами `stream` или `events`: шина поддерживает только
  `value`.

Событие без подписчиков допустимо: `emit` доставляет сообщение нулю
получателей.

По этой же причине в `examples.app-with-http` фича `users` объявляет
`dependsOn: [OpsFeature, QuotasFeature]`: пример собран без брокера, `users`
вызывает `quotas` контрактом, и топология «users без quotas» падает на
ASSEMBLE, а не на первом запросе.

## Версии и совместимость контрактов

Отдельного поля версии у контракта нет: версия входит в имя
(`user.create.v2`). `makeContract` суффикс не требует и не разбирает, так
что контракт без версии тоже допустим.

Какими контракты были вчера, помнит снапшот — обычное значение, которое вы
храните где хотите. В примере это файл рядом с пакетом:

```typescript
// packages/examples.app-with-http/src/contracts.compat.spec.ts (сокращено)
import {
  checkTopologies,
  diffContracts,
  formatCompatibility,
  serializeSnapshot,
  snapshotContracts,
} from '@nestling/testing';

/** Конвертер схем поверх штатного конвертера валидатора */
const zodConverter = () => ({
  vendor: 'zod',
  toJsonSchema: (schema) => z.toJSONSchema(schema as z.ZodType),
});

const reports = await checkTopologies(spec, ['all', 'users', 'ops'], {
  converters: [zodConverter()],
});

const report = diffContracts(readBaseline(), snapshotContracts(reports));

console.log(formatCompatibility(report));
expect(report.breaking).toEqual([]);   // ваш expect, а не проверка фреймворка
```

Что здесь происходит по шагам:

- `check()` кладёт в отчёт дескрипторы контрактов, которые приложение
  реализует. Контракт, который импортирован, но не реализован, в отчёт не
  попадает: состав приложения определяет дерево модулей, а не список
  импортов.
- `snapshotContracts` объединяет отчёты всех топологий. Контракт, который
  публикует только топология `all`, в снапшоте есть, и его дескриптор
  называет эту топологию. Так «фича не выбрана» и «контракт удалён» не
  путаются.
- `diffContracts` выносит вердикт каждому изменению: `breaking`,
  `additive` или `unknown`. Направление зависит от слота. `input` приходит
  в реализацию, поэтому новое обязательное поле, удалённое поле и сужение
  типа — `breaking`. `output` уходит из неё, поэтому удалённое поле и
  превращение обязательного в необязательное — `breaking`. Удалённый код
  из `errors` считается `breaking`, добавленный — `additive`.
- Всё, что `diffContracts` не понял, получает вердикт `unknown`, а не
  «совместимо»: незнакомые ключевые слова JSON Schema, `oneOf`, `allOf`,
  `$ref`, смена вендора схем, лист без конвертера. К вердикту прилагается
  путь до узла. Без конвертера листья схем непрозрачны, и отчёт сообщает об
  этом отдельной секцией; структурная часть (вид, формы, коды отказов) при
  этом остаётся точной.
- Если есть `breaking`, отчёт подсказывает новое имя: для `quotas.claim`
  это `quotas.claim.v2`. Это только подсказка; ничего не переименовывается.

Ничто из этого не может уронить сборку. `diffContracts` — чистая функция
двух значений: она не участвует в `run()`, не вызывается из `check()` и не
бросает по результату сравнения. Единственный способ уронить CI — ваш
`expect`. Флага «падать на breaking» нет: осознанный breaking делается
сменой имени, а не отключением проверки.

`diffContracts` бросает исключение в одном случае: baseline нечитаем
(чужая `snapshotVersion`). Это ошибка автора проверки, а не breaking
change.

Baseline обновляется явно — перезаписью файла:

```typescript
writeFileSync(BASELINE_PATH, serializeSnapshot(snapshotContracts(reports)));
```

Сериализация детерминирована: контракты отсортированы по имени, отказы по
коду, ключи JSON Schema по алфавиту. Поэтому файл попадает в git-дифф
осмысленным патчем. Пересобирайте baseline тем же конвертером, которым
запускаете проверку: смена мажорной версии валидатора меняет форму JSON
Schema, и отчёт покажет `unknown` без единого изменения в контрактах.

## Когда порт готов: фазы

`dispatch` создаётся на фазе WIRE. На той же фазе вызыватели получают
исполнитель, а шина подписывается на subject'ы своих маршрутов:

| Фаза | Порт |
|---|---|
| 2 INIT (`@OnInit`) | вызов даёт ошибку «порт вызван до фазы WIRE» |
| 3 WIRE | связывание вызывателей и подписка шины |
| 4 START (`@OnStart`) | вызов выполняется |

Вызов в `@OnInit` падает ошибкой, а не ждёт молча: так код, который зовёт
порт слишком рано, падает всегда, а не иногда.

## Правила, которые держит код

- **Вызов не транзакционен.** Порт выполняется через `dispatch.call`, то
  есть в собственном request-scope. Ambient-контекст вызывающего внутрь
  реализации не попадает, и общей транзакции между фичами нет. Единственное
  исключение — переменные, объявленные с `{ propagate: true }` (см. «Провоз
  контекста»).
- **Порт в том же процессе тоже может вернуть `Fail`.** Синхронной формы
  вызова и формы, которая бросает отказ вместо возврата, нет. Иначе
  потребители не обрабатывали бы `Fail`, и разнесение фич по процессам их
  сломало бы.
- **Вход проверяется схемой на обоих путях** — так же, как он проверялся
  бы на границе, если бы запрос пришёл по сети.

## Шина

`IMessageBus` — минимальный интерфейс брокера: `request`, `publish` и
`subscribe` с группой доставки. Специфика конкретного брокера в интерфейс
не входит; ядро зависит только от него.

`InProcessBus` — реализация шины внутри одного процесса. Она же является
транспортом (`ITransport`): через `IMessageBus` отправляет вызовы, через
`ITransport` принимает их. Broadcast построен на `Topic` из
`@nestling/streams`, поэтому публикация не ждёт медленного подписчика.
Команда доставляется ровно одному члену группы, событие — всем
подписчикам. Долговечной доставки, повторов и персистентности у
`InProcessBus` нет: без внешнего брокера их не на чем построить. Обе
возможности она объявляет ложными: `remote: false`, `durable: false`.

Если корень не задал шину, её регистрирует модуль ядра портов — и только
если в приложении есть хотя бы одна реализация контракта.

## Split-развёртывание: `nats()` в корне

Брокер подключается одной строкой в корне:

```typescript
// packages/examples.split-nats/src/root.ts
import { assemble } from '@nestling/app';
import { nats } from '@nestling/transport.nats';

export function makeRoot(
  select: FeatureSelection,
  transport: NatsTransportOptions = {},
): App {
  return assemble({
    features: [OrdersFeature, QuotasFeature],
    select,                        // 'orders' в одном процессе, 'quotas' в другом
    transports: [nats(transport)], // адреса берутся из секции `nats`, не из литералов
  });
}
```

```typescript
// packages/examples.split-nats/src/main.ts
const RootConfig = makeConfig('app', {
  features: z.string().default('all'),
});

const cfg = load(RootConfig);      // фаза 0: выбор фич до сборки контейнера

await makeRoot(cfg.features).run();
```

`nats()` — обычный транспорт-провайдер под тем же токеном, что и
in-process шина. Когда его зарегистрировал корень, модуль ядра портов свою
шину не регистрирует. Шина в приложении ровно одна: брокер не добавляется к
in-process шине, а заменяет её. Ни одна декларация `implement(...)` и ни
одно место вызова при этом не меняются.

Что меняется в поведении:

| Ситуация | Без брокера | С брокером |
|---|---|---|
| `request` или `command` без реализации в процессе | ошибка ASSEMBLE | уходит на шину |
| `event` | `dispatch` каждому подписчику в процессе | всегда через шину |
| `durable`-контракт | строка о деградации при старте | поток JetStream |

`event` при брокере уходит через шину всегда, даже когда подписчик в том же
процессе. Множество подписчиков события открыто, часть их живёт в других
процессах, и локальный `dispatch` молча потерял бы их. Подписчик в том же
процессе получает ровно одну копию — ту, что пришла по его собственной
подписке.

Долговечность объявляется в контракте, а не в подписке:

```typescript
// packages/examples.split-nats/src/contracts.ts
export const OrderPlaced = makeContract({
  name: 'orders.placed',
  kind: 'event',
  durable: true,             // факт не должен потеряться, пока подписчик лежит
  input: z.object({ orderId: z.string(), tenantId: z.string() }),
});
```

О долговечности обязаны знать обе стороны: издатель ждёт подтверждения
записи, подписчик читает долговечно, а живут они в разных процессах.
Контракт — единственное значение, доступное обоим. У `request` флаг
`durable` отвергается при объявлении: ответа ждёт живой вызывающий, и
переживать перезапуск нечему. На шине без долговечной доставки приложение
стартует, но при старте печатает строку с перечнем контрактов, которые
обслуживаются без персистентности.

Тесты приложения работают без сети: клиент брокера подменяется двойником.

```typescript
// packages/examples.split-nats/src/split.spec.ts (сокращено)
import { NatsDouble, natsDouble } from '@nestling/transport.nats/testing';

const broker = new NatsDouble();
// один двойник, отданный двум корням, — кластер из двух процессов
const orders = makeRoot('orders', { connect: natsDouble(broker) });
const quotas = makeRoot('quotas', { connect: natsDouble(broker) });
```

## Провоз контекста

Ambient-переменная, объявленная провозимой, передаётся в реализацию в
другом процессе вместе с вызовом:

```typescript
// packages/examples.split-nats/src/context.ts
export const TenantId = contextVar<string>()('tenantId', { propagate: true });
```

Флаг `propagate` — свойство объявления, а не точки подключения: провозится
именно эта переменная, и решение об этом видно там же, где она объявлена.
Механизм тот же, что у параметров вызова:

1. **Сбор.** Вызыватель читает значения провозимых переменных из контекста
   текущего запроса и кладёт их в конверт сообщения. Вне запроса
   (`@OnStart`, фоновая задача) провозить нечего, и это допустимо.
2. **Приём.** Значения всегда лежат в `ctx.raw.attributes`.
3. **Проекция.** В контекст значение кладёт штатный писатель:

```typescript
// packages/examples.split-nats/src/orders.ts
const scoped = makePipeline().pre(TenantId.propagated());
```

`propagated()` несёт ту же пометку, что и `provide`, поэтому политика
`everyEndpoint(…).hasVar(TenantId)` его засчитывает: наличие провезённого
контекста проверяется на сборке. Под `local-first` и `always-remote`
провозится одно и то же.

Провезённое значение не проверяется схемой: схемы у ambient-переменной
нет. Провоз пересекает границу доверия, и что делать на основании
провезённого — решает приложение.

Пример обеих топологий — `packages/examples.split-nats`: один корень, одни
декларации, разный `select`.

## Что дальше

- Тест фичи без соседней: `stub(Contract, impl)` из `@nestling/testing`
  даёт заглушку вызывателя, ответы которой проверяются схемами контракта, а
  `app.emit` вызывает приложение снаружи, как издатель. Рецепт —
  [`testing.md` §4](./testing.md); пример —
  `packages/examples.split-nats/src/isolated.spec.ts`, где `orders`
  собирается без `quotas` и без брокера.
- Внешний клиент из контракта (`makeClient`) —
  [`typed-client.md`](./typed-client.md). Контракт с секцией `http:`
  адресуется и по шине, и по HTTP. `makeContract` живёт в
  `@nestling/contracts` — пакете без серверных зависимостей, поэтому
  контракт можно импортировать во фронтенд.

Целевое состояние подсистемы — [`design/contracts.md`](../design/contracts.md).
