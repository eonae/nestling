## MODIFIED Requirements

### Requirement: `Signal` — well-known переменная; ключ `'signal'` зарезервирован

`@nestlingjs/app` SHALL экспортировать well-known переменную
`Signal: ReadonlyContextVar<AbortSignal>`, дающую `Ctx(Signal)` — сигнал
отмены запроса для кода любой глубины.

`Signal` SHALL быть read-only: метод `provide` SHALL отсутствовать в её типе
и SHALL бросать в рантайме — значение сигнала берётся из контекста запроса, а
не из `input`.

Ключ `'signal'` SHALL быть зарезервирован: `contextVar()('signal')` из
пользовательского кода SHALL бросать ошибку, называющую `Signal` как
готовую переменную.

`@nestlingjs/app` SHALL также экспортировать well-known переменную
`RequestId: ContextVar<string>`, а штатный `withRequestId()` SHALL быть
реализован через `RequestId.provide(…)` и SHALL сохранить прежнюю сигнатуру
`PreUnitFn<EmptyInput, { requestId: string }>`.

Третья well-known переменная — `Trace: ContextVar<TraceContext, 'trace'>`
со штатным писателем `withTracing()` (capability `trace-context`). Ключ
`'trace'` SHALL быть зарезервирован тем же способом, что `'signal'`:
`contextVar()('trace')` из прикладного кода SHALL бросать ошибку,
называющую `Trace` как готовую переменную.

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
  `hasVar(RequestId)` на этом endpoint'е соблюдена

#### Scenario: Ключ трассы зарезервирован

- **WHEN** написано `contextVar<TraceContext>()('trace')`
- **THEN** вызов бросает ошибку, отсылающую к готовой переменной `Trace`
