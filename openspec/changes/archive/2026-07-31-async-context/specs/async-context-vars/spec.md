## ADDED Requirements

### Requirement: `contextVar<T>('key')` — ambient-переменная объявляется значением

`@nestling/pipeline` SHALL экспортировать `contextVar<T>(key: string)`,
возвращающий значение-декларацию ambient-переменной. Значение SHALL нести
ключ, рантайм-идентичность и compile-time тип `T` — тот же паттерн, что
`makeToken<T>()`.

Ключ SHALL быть **именем поля в накопленном `input` пайплайна**: ambient-
переменная SHALL NOT заводить второго хранилища состояния. Пустой ключ и
не-строка SHALL отвергаться в момент объявления.

Идентичность SHALL быть по значению: две переменные с одним ключом,
объявленные разными вызовами, SHALL быть разными значениями, но SHALL
адресовать одно и то же поле `input` и один и тот же токен ридера.

#### Scenario: Объявление переменной

- **WHEN** написано `const RequestId = contextVar<string>('requestId')`
- **THEN** значение несёт ключ `'requestId'`, а `Ctx(RequestId)` типизирован
  как `CtxReader<string>`

#### Scenario: Ключ — поле накопленного input

- **WHEN** pre-юнит положил в input поле `requestId`
- **THEN** ридер `Ctx(RequestId)` читает **то же** значение, что видит
  следующий pre-юнит в `ctx.input.requestId`

#### Scenario: Пустой ключ отвергается

- **WHEN** написано `contextVar<string>('')` или `contextVar<string>('  ')`
- **THEN** вызов бросает ошибку в момент объявления, называя требование
  непустого ключа

### Requirement: `Var.provide(compute)` — единственный канонический писатель

Значение переменной SHALL нести метод `provide(compute)`, возвращающий
**pre-юнит** обычной формы `PreUnitFn<TReq, { [key]: T }>`: накопительная
типизация, проверка требований к внешнему контексту и проверка конфликтов
полей SHALL остаться прежней машинерией пайплайна.

`compute` SHALL получать контекст pre-юнита (то есть иметь доступ к
`ctx.raw`, `ctx.signal` и уже накопленному `ctx.input`) и SHALL возвращать
значение типа `T` либо промис такого значения. Добавку SHALL строить сама
переменная — из её ключа и результата `compute`.

Юнит, созданный `provide`, SHALL нести рантайм-пометку с переменной, по
которой пайплайн узнаёт объявленную переменную на сборке (capability
`pipeline-composition`). Пометка SHALL быть неперечислимой: значение юнита
SHALL оставаться обычной функцией.

Пользовательского API записи в ALS-проекцию SHALL NOT существовать: `set`,
`enrich` и любой другой второй канал записи отсутствуют.

#### Scenario: Писатель — обычный pre-юнит

- **WHEN** написано `makePipeline().pre(RequestId.provide(() => uuid()))`
- **THEN** тип пайплайна пополняется полем `{ requestId: string }`, как у
  любого pre-юнита

#### Scenario: Декларация не может разойтись с фактом

- **WHEN** юнит создан через `RequestId.provide(compute)`
- **THEN** в input попадает поле именно с ключом переменной, а пайплайн
  считает переменную объявленной — оба следствия одного действия

#### Scenario: Писатель читает накопленный контекст

- **WHEN** написано `TenantId.provide((ctx) => ctx.input.identity.tenant)` и
  юнит композирован после слоя, кладущего `identity`
- **THEN** композиция проходит проверку типов, а без слоя-писателя
  `identity` — не компилируется

#### Scenario: Второго канала записи нет

- **WHEN** пользовательский код ищет способ записать переменную вне
  pre-юнита
- **THEN** такого API в экспорте нет: ридер несёт только `get`/`peek`

### Requirement: `Signal` — well-known переменная; ключ `'signal'` зарезервирован

`@nestling/pipeline` SHALL экспортировать well-known переменную
`Signal: ReadonlyContextVar<AbortSignal>`, дающую `Ctx(Signal)` — сигнал
отмены запроса для кода любой глубины.

`Signal` SHALL быть read-only: метод `provide` SHALL отсутствовать в её типе
и SHALL бросать в рантайме — значение сигнала берётся из контекста запроса, а
не из `input`.

Ключ `'signal'` SHALL быть зарезервирован: `contextVar('signal')` из
пользовательского кода SHALL бросать ошибку, называющую `Signal` как
готовую переменную.

`@nestling/pipeline` SHALL также экспортировать well-known переменную
`RequestId: ContextVar<string>`, а штатный `withRequestId()` SHALL быть
реализован через `RequestId.provide(…)` и SHALL сохранить прежнюю сигнатуру
`PreUnitFn<EmptyInput, { requestId: string }>`.

#### Scenario: Отмена доступна из глубины

- **WHEN** сервис объявил `Ctx(Signal)` в `deps` и запрос отменён клиентом
- **THEN** `get()` возвращает взведённый `AbortSignal` того же запроса

#### Scenario: Сигнал не пишется

- **WHEN** пользовательский код пытается `Signal.provide(…)`
- **THEN** это ошибка компиляции, а в рантайме (для JS-потребителей) —
  брошенная ошибка с указанием причины

#### Scenario: Зарезервированный ключ

- **WHEN** написано `contextVar<AbortSignal>('signal')`
- **THEN** вызов бросает ошибку, отсылающую к готовой переменной `Signal`

#### Scenario: Штатный `withRequestId` объявляет переменную

- **WHEN** пайплайн композирован от слоя с `withRequestId()`
- **THEN** `Ctx(RequestId)` читается из глубины, а политика
  `hasVar(RequestId)` на этой ручке соблюдена
