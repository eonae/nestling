## MODIFIED Requirements

### Requirement: `contextVar<T>('key')` — ambient-переменная объявляется значением

`@nestling/app` SHALL экспортировать `contextVar<T>()`, возвращающий
объявитель `(key: string, options?: ContextVarOptions)` — значение-декларацию
ambient-переменной. Вызов SHALL быть двойным: первый фиксирует тип значения,
второй — ключ литералом, потому что частичного вывода тип-аргументов в
TypeScript нет, а ключ обязан остаться литералом для типизации добавки.
Значение SHALL нести ключ, рантайм-идентичность и compile-time тип `T` — тот
же паттерн, что `makeToken<T>()`.

Ключ SHALL быть **именем поля в накопленном `input` пайплайна**: ambient-
переменная SHALL NOT заводить второго хранилища состояния. Пустой ключ и
не-строка SHALL отвергаться в момент объявления.

Идентичность SHALL быть по значению: две переменные с одним ключом,
объявленные разными вызовами, SHALL быть разными значениями, но SHALL
адресовать одно и то же поле `input` и один и тот же токен ридера.

Словарь опций SHALL нести флаг `propagate`, объявляющий переменную
**провозимой через границу порта** (capability `context-propagation`).
Флаг SHALL быть свойством объявления, а не точки подключения: провозится
именно переменная, и решение об этом SHALL быть видно там же, где она
объявлена. Переменная без флага SHALL NOT провозиться ни при каких
обстоятельствах; read-only переменные (`Signal`) провозимыми SHALL NOT быть.

#### Scenario: Объявление переменной

- **WHEN** написано `const RequestId = contextVar<string>()('requestId')`
- **THEN** значение несёт ключ `'requestId'`, а `Ctx(RequestId)` типизирован
  как `CtxReader<string>`

#### Scenario: Ключ — поле накопленного input

- **WHEN** pre-юнит положил в input поле `requestId`
- **THEN** ридер `Ctx(RequestId)` читает **то же** значение, что видит
  следующий pre-юнит в `ctx.input.requestId`

#### Scenario: Пустой ключ отвергается

- **WHEN** написано `contextVar<string>()('')` или `contextVar<string>()('  ')`
- **THEN** вызов бросает ошибку в момент объявления, называя требование
  непустого ключа

#### Scenario: Провозимая переменная объявляется опцией

- **WHEN** написано `const TenantId = contextVar<string>()('tenantId', { propagate: true })`
- **THEN** значение несёт флаг, и вызыватель порта провозит именно эту
  переменную

#### Scenario: Провозимость — свойство объявления

- **WHEN** читается объявление переменной
- **THEN** видно, провозится она или нет; в точке подключения писателя этого
  решения нет

### Requirement: `Signal` — well-known переменная; ключ `'signal'` зарезервирован

`@nestling/app` SHALL экспортировать well-known переменную
`Signal: ReadonlyContextVar<AbortSignal>`, дающую `Ctx(Signal)` — сигнал
отмены запроса для кода любой глубины.

`Signal` SHALL быть read-only: метод `provide` SHALL отсутствовать в её типе
и SHALL бросать в рантайме — значение сигнала берётся из контекста запроса, а
не из `input`.

Ключ `'signal'` SHALL быть зарезервирован: `contextVar()('signal')` из
пользовательского кода SHALL бросать ошибку, называющую `Signal` как
готовую переменную.

`@nestling/app` SHALL также экспортировать well-known переменную
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

- **WHEN** написано `contextVar<AbortSignal>()('signal')`
- **THEN** вызов бросает ошибку, отсылающую к готовой переменной `Signal`

#### Scenario: Штатный `withRequestId` объявляет переменную

- **WHEN** пайплайн композирован от слоя с `withRequestId()`
- **THEN** `Ctx(RequestId)` читается из глубины, а политика
  `hasVar(RequestId)` на этой ручке соблюдена
