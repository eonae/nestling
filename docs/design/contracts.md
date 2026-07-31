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
  Standard Schema) ⇒ контракт импортируем во фронт и скрипты. Рантаймовая
  часть — вызыватели, шина и биндинг — в `@nestling/ports`, который
  реэкспортирует объявление контракта, чтобы приложению хватало одного
  импорта.
- **Версия — явно в имени** (`user.create.v2`): имя и так адресация,
  версия — часть адреса. Схемный дифф против снапшота опубликованных схем
  в `.check()`-матрице CI **подсвечивает** breaking changes, но не
  блокирует: breaking должен быть видимым, а не невозможным.

## 2. Порты: location transparency на сборке

Реализация — `implement(Contract, { deps?, pipeline?, handle, subscriber?, detached? })`
([endpoints.md](./endpoints.md)): это конструктор деклараций поверх того же
kernel-примитива, что `httpEndpoint`/`cliEndpoint`, поэтому реализация
кладётся в `endpoints:` модуля и наследует всю машинерию ручки — дискавери,
`dispatch`, pipeline, страж границы, `policies`/`detached`, отчёт `check()`
и вызов по значению в тестах. `input`/`output`/`errors` приходят из
контракта и переобъявлению не подлежат (ошибка компиляции).

Адрес в процессе и адрес на шине разведены: `pattern` — `<name>` у
`request`/`command` и `<name>@<subscriber>` у `event`, subject всегда
`<name>`. Поле `subscriber:` обязательно для `event` (подписчиков 0..N) и
запрещено для `request`/`command` (владелец ровно один); имя задаётся
автором явно — с брокером оно становится именем queue-group и
durable-подписки.

Потребление — инжект `Contract.port` / `Contract.emitter`:

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
  Вызыватель — член token-семейства, поэтому узел графа появляется только у
  тех контрактов, которые кто-то инжектит.
- **Тип call-site идентичен** в co-located и split: всегда async, всегда
  `Ok | Fail` — даже локально (завтра — сеть). Remote-отказ ре-гидрируется
  в настоящий `Fail` по `code` ([errors.md](./errors.md)); множество
  ответов закрыто объявленными отказами плюс kernel-коды (`UNKNOWN`,
  `VALIDATION_FAILED`) — то же закрытие, что у ручки.
- **`emit` возвращает `Promise<void>`** по факту доставки, а не обработки:
  у fire-and-forget нет результата, который потребитель обязан разбирать.
  Отказ подписчика уходит в диагностический хук, а не вызывающему.
- **Единственное позднее связывание — фаза WIRE**: `dispatch` рождается
  там, поэтому вызыватели получают исполнитель явным шагом WIRE (и там же
  шина подписывается на subject'ы своих маршрутов — `@OnStart` уже вправе
  звать порт). Вызов раньше WIRE — внятная ошибка, а не молчаливое
  ожидание.
- **Дисциплина (жёсткая)**: порты никогда не транзакционны, даже co-located
  (вызов идёт в собственном request-scope, ambient-контекст вызывающего не
  протекает); локальный порт обязан уметь падать; вход валидируется на
  обоих путях. Кросс-фичевая согласованность — события + outbox/saga (точка
  интеграции — [deferred](../decisions/deferred.md)), не общая транзакция.
- **Fail-fast'ы сборки**: `request`/`command` без co-located реализации при
  отсутствии remote-биндинга, второй владелец, два подписчика с одним
  именем, формы `stream`/`events` в контракте порта. Событие без
  подписчиков — легально.

## 3. Шина и dispatch-политики

Ядро зависит только от `IMessageBus` (`request`/`publish`/`subscribe` — LCD).
Реализации: `InProcessBus` (zero-dep) и `@nestling/transport.nats`
(queue-groups для реплик; JetStream — для durable). NATS-специфика не
протекает в контрактный API.

`InProcessBus` — одно значение с двумя способностями: `IMessageBus`
(исходящая сторона) и `ITransport` (входящая, `serve(dispatch, signal)`).
Broadcast построен на `Topic` ([streaming.md](./streaming.md)), поэтому
публикация не ждёт медленного подписчика; способности по формам io —
только `value`. В корне шина не упоминается: kernel-модуль портов
регистрирует её сам, а в эфир она выходит только когда её требует
обнаруженная декларация.

Диспатч — **политика на сборке**: `local-first` (co-located → in-proc,
иначе шина) | `always-remote` («всё — сообщение»; в dev — in-proc-simulated
шина с async-барьером, структурной копией payload и ответа и валидацией
ответа по `output`-схеме) | `balanced` (client-side spill; единственная
политика с рантайм-решением — приезжает вместе с настоящей remote-шиной).
Политика — поле `dispatch` kernel-секции `nestlingPorts`
(`NESTLING_PORTS_DISPATCH`, по умолчанию `local-first`), читаемое обычным
механизмом конфигурации: поля `dispatch:` в словаре `assemble` нет —
перечень полей корня закрыт. Смена политики — смена конфига, call-site не
меняется.

## 4. Эксплуатационный профиль вызова

Co-located и split различаются профилем — профиль встроен в контрактный API:

- **Deadline** — `meta.deadline` рядом с `meta.signal`, **абсолютный
  момент** типа `Date` (сахар `deadlineIn(ms)`; число не принимается — `500`
  неразличимо читается как epoch и как «через 500 мс»). Модель gRPC: внутри
  процесса — момент, по проводу — **относительный timeout** (clock skew не
  влияет), на приёме он снова становится моментом по часам получателя.
  Дефолтного бюджета нет: вызов без `deadline` не ограничен по времени.
  Точек контроля три — fail-fast **до** вызова (ни dispatch, ни шина не
  тронуты), fail-fast **до** обработки на приёме и отмена **в полёте**:
  сигнал обработчика есть композиция бюджета и `meta.signal`, поэтому
  кооперативная реализация видит исчерпание своим `ctx.signal`. Отказ —
  `DeadlineExceeded`; отмена вызывающим по-прежнему `UnknownError`, и
  различаются они по владению таймером, а не по `signal.reason`. Код
  встроенный (как `UnknownError`): в `errors:` не декларируется, но входит
  в закрытое множество ответов любого порта.
- **Идемпотентность** — `idempotencyKey` в meta **только** для
  `command`-контрактов: словарь meta выбирается по виду
  (`MetaOf<C>`), и на `request`/`event` обращение к полю — ошибка
  компиляции, а не молчаливо проигнорированное поле. `emit` команды всегда
  едет с ключом: переданным вызывающим либо отчеканенным вызывателем —
  ключ обязан быть стабилен относительно **ретраев доставки**, а транспорт
  не знает, где кончается один `emit`. Провоз — через конверт шины (в NATS
  — headers). Дедупликация — satellite-концерн на стороне обработчика;
  ядро гарантирует только доставку ключа хендлеру и юнитам.
- **Два канала доставки профиля** — безусловный `ctx.raw.attributes`
  (провод, рядом с `subject`) и ambient-переменные `Deadline` /
  `IdempotencyKey` с их штатными писателями `withDeadline()` /
  `withIdempotencyKey()`. Переменные экспортируются **значениями**, поэтому
  присутствие профиля проверяемо на сборке:
  `everyEndpoint(…).hasVar(IdempotencyKey)`. Бюджет вложенным вызовом
  **не наследуется** — ровно как не наследуется `meta.signal`: обработчик,
  отдающий остаток дальше, передаёт его явно.
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
