# Контракты, порты и клиенты

> **Целевое состояние V1.** Логика решений: [ideas.md](../decisions/ideas.md) —
> «Порты: межфичевое общение через контракты» [2026-07-08], «Типизированные
> клиенты из контрактов» [2026-07-13], «Порты: deadline, идемпотентность,
> версионирование контрактов» [2026-07-13], «Контракт первичен» [2026-07-13].
> Отложенное (outbox/saga) — [deferred](../decisions/deferred.md).
> Статус реализации — [roadmap](../decisions/roadmap.md).

## 1. Контракт — центральное значение

```typescript
export const ChargeCard = makeContract({
  name: 'billing.charge',            // адресация: NATS subject, ключ дискавери
  kind: 'request',                   // 'request' | 'command' | 'event'
  http: 'POST /billing/charges',     // HTTP-адресация (опционально); bind-карта
  input:  z.object({ orderId: z.string(), amount: z.number() }),
  output: z.object({ chargeId: z.string() }),
  errors: [CardDeclined],            // типизированный канал E (errors.md)
});
```

- **Нейтральность контракта — про направление** (реализуешь или зовёшь),
  не про транспорт: `name` — адрес шины, `http:` — та же адресация для
  другого провода. Bind-карта HTTP-биндинга разворачивается при
  `makeContract` (fail-fast у владельца) — все потребители (транспорт,
  OpenAPI, клиент) едят готовую карту из одного импорта.
- **Три вида** (различие нужно горизонтальному масштабированию):
  `request` — req-reply, Fail-able, один владелец; `command` —
  fire-and-forget, один обработчик (queue-group); `event` — broadcast,
  0..N подписчиков. Здоровый дефолт кросс-фичевого общения — событийный;
  `request` — для честных запросов.
- **Пакетирование**: `makeContract`/`defineFail` живут в
  `@nestling/contracts` — zero runtime deps (только types-only
  Standard Schema) ⇒ контракт импортируем во фронт и скрипты.
- **Версия — явно в имени** (`user.create.v2`): имя и так адресация,
  версия — часть адреса. Схемный дифф против снапшота опубликованных схем
  в `.check()`-матрице CI **подсвечивает** breaking changes, но не
  блокирует: breaking должен быть видимым, а не невозможным.

## 2. Порты: location transparency на сборке

Реализация — `implement(Contract, { deps?, pipeline?, handle })`
([endpoints.md](./endpoints.md)). Потребление — инжект `Contract.port` /
`Contract.emitter`:

```typescript
deps: [ChargeCard.port],
handle: (billing) => async (input, meta) => {
  const charge = await billing.call({ orderId: input.id, amount: input.total }, meta);
  if (charge.isFail) return charge;          // отказ — данные, не исключение
  /* ... */
}
```

- **Индиректность резолвится на сборке, не на запросе**: порт биндится на
  local-клиент (co-located) или remote-клиент (поверх шины) в composition
  root по выбору фич и топологии; на запросе зовётся конкретная константа.
- **Тип call-site идентичен** в co-located и split: всегда async, всегда
  `Ok | Fail` — даже локально (завтра — сеть). Remote-отказ ре-гидрируется
  в настоящий `Fail` по `code` ([errors.md](./errors.md)).
- **Дисциплина (жёсткая)**: порты никогда не транзакционны, даже co-located;
  локальный порт обязан уметь падать. Кросс-фичевая согласованность —
  события + outbox/saga (точка интеграции —
  [deferred](../decisions/deferred.md)), не общая транзакция.

## 3. Шина и dispatch-политики

Ядро зависит только от `IMessageBus` (`request`/`publish`/`subscribe` — LCD).
Реализации: `InProcessBus` (zero-dep) и `@nestling/transport.nats`
(queue-groups для реплик; JetStream — для durable). NATS-специфика не
протекает в контрактный API.

Диспатч — **политика на сборке**: `local-first` (co-located → in-proc,
иначе шина) | `always-remote` («всё — сообщение»; в dev — in-proc-simulated
шина с async + сериализацией) | `balanced` (client-side spill; единственная
политика с рантайм-решением). Смена политики — смена конфига, call-site
не меняется.

## 4. Эксплуатационный профиль вызова

Co-located и split различаются профилем — профиль встроен в контрактный API:

- **Deadline** — `meta.deadline` рядом с `meta.signal`. Модель gRPC: внутри
  процесса — абсолютный момент, по проводу — **относительный timeout**
  (clock skew не влияет). На каждом hop dispatch пересчитывает остаток;
  бюджет исчерпан → fail-fast `DeadlineExceededError` **до** вызова.
  Код встроенный (как `UnknownError`): в `errors:` не декларируется, но
  входит в закрытое множество ответов любого порта.
- **Идемпотентность** — `idempotencyKey` в meta для `command`-контрактов:
  dispatch генерирует/принимает ключ и провозит через транспорт (NATS
  headers). Дедупликация — satellite-концерн на стороне обработчика; ядро
  гарантирует только доставку ключа хендлеру и юнитам.
- **Пропагация контекста** — vars с `propagate: true` едут в заголовках
  ([container.md](./container.md), «Асинхронный контекст»).

## 5. Внешний клиент: `makeClient`

Потребителю вне nestling-процесса (фронт, другой стек, скрипт) DI недоступен —
клиент строится из контракта:

```typescript
import { CreateUser, GetUser } from '@acme/billing-contracts'; // zero-deps пакет
import { makeClient } from '@nestling/client';

const api = makeClient(
  { createUser: CreateUser, getUser: GetUser },  // методы именует потребитель
  { baseUrl, fetch?, headers? },                 // ambient: auth, tracing — здесь
);

const result = await api.createUser({ ... });
// Promise<Ok<Output> | Fail<EmailTaken | UnknownError>>
```

- **Тип call-site идентичен порту** — дисциплина портов распространяется
  на внешних потребителей: `Ok | Fail`, закрытое множество
  `E ∪ UnknownError`.
- Запрос собирается по bind-карте контракта (path/query/body); ответ
  валидируется по `output`-схеме через `~standard.validate` —
  вендор-нейтрально, валидатор приносит потребитель.
- Ошибки рематериализуются по `code` из `errors:`; незадекларированный
  код → `UnknownError`.
- Ambient-заголовки — конфиг создания клиента (симметрия с границей
  meta vs input); методы именуются record'ом — никакого парсинга
  `'users.create'` в nested-объекты.
- `makeClient` живёт в `@nestling/client`: fetch-based, без Node-специфики.
- Для не-TS потребителей путь остаётся через OpenAPI-генерацию
  ([transports.md](./transports.md) / запись «Standard Schema…OpenAPI»).
