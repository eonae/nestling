# strict-exports

## Purpose

Opt-in build-time lint рёбер собранного графа против `exports` модулей:
кросс-модульная зависимость на неэкспортированный токен валит сборку со
списком всех нарушений. Это проверка на сборке, а не рантайм-инкапсуляция —
`get()` и инжект после `build()` никаких проверок не выполняют. По умолчанию
выключен, поведение существующих контейнеров не меняется.

## Requirements

### Requirement: strictExports is an opt-in build-time check, off by default

`ContainerBuilder` SHALL принимать необязательные опции конструктора
`{ strictExports?: boolean }`. При отсутствии опции или `strictExports: false`
поведение `build()` SHALL оставаться прежним: никакие проверки exports не
выполняются, кросс-модульные зависимости на неэкспортированные токены
допускаются (обратная совместимость). Проверка SHALL быть build-time lint'ом
по готовому графу; рантайм-инкапсуляции (проверок при `get()` или инжекции
после сборки) SHALL NOT существовать.

#### Scenario: Default build ignores exports declarations

- **WHEN** контейнер создан как `new ContainerBuilder()` и провайдер модуля A
  зависит от неэкспортированного токена модуля B
- **THEN** `build()` завершается успешно

### Requirement: strictExports validates cross-module graph edges against exports

При `strictExports: true` метод `build()` SHALL после построения графа
проверять каждое ребро `consumer → dependency`: если узел-зависимость
принадлежит модулю M, а потребитель — не из M (другой модуль или без модуля),
токен зависимости обязан присутствовать в `exports` модуля M, иначе сборка
завершается ошибкой. Рёбра внутри одного модуля SHALL допускаться без
ограничений; узлы-зависимости без модуля SHALL потребляться свободно.
Отсутствующий или пустой `exports` модуля SHALL трактоваться как «ничего не
экспортировано».

#### Scenario: Non-exported cross-module dependency fails the build

- **WHEN** `strictExports: true`, провайдер модуля A зависит от токена
  модуля B, отсутствующего в `exports` модуля B
- **THEN** `build()` бросает ошибку, называющую потребителя, токен
  зависимости и модуль B

#### Scenario: Exported dependency passes

- **WHEN** `strictExports: true` и токен зависимости объявлен в `exports`
  модуля-владельца
- **THEN** `build()` завершается успешно

#### Scenario: Intra-module dependency is always allowed

- **WHEN** `strictExports: true` и оба узла ребра принадлежат одному модулю,
  токен зависимости не в `exports`
- **THEN** `build()` завершается успешно

#### Scenario: Module without exports exports nothing

- **WHEN** `strictExports: true`, модуль B не объявил поле `exports`, а
  провайдер модуля A зависит от токена модуля B
- **THEN** `build()` бросает ошибку о неэкспортированном токене

### Requirement: All strictExports violations are reported in a single error

`build()` при `strictExports: true` SHALL собирать все нарушения по всем
рёбрам графа и сообщать их одной ошибкой со списком пар
«потребитель → зависимость (модуль)», а не останавливаться на первом
нарушении.

#### Scenario: Multiple violations aggregated

- **WHEN** два разных провайдера нарушают exports двух разных модулей
- **THEN** `build()` бросает одну ошибку, в тексте которой перечислены оба
  нарушения

### Requirement: Module exports accept a token family

`Module.exports` SHALL принимать семейство токенов наряду с обычными
токенами: семейство в `exports` означает, что все материализованные члены
этого семейства экспортированы модулем. Члены семейства из модуля, не
экспортировавшего ни семейство, ни конкретный членский токен, SHALL считаться
неэкспортированными. `metadata.exported` узла-члена SHALL отражать это
членство (`true` при экспортированном семействе).

#### Scenario: Exported family allows cross-module member consumption

- **WHEN** `strictExports: true`, модуль logging объявляет
  `providers: [familyProvider(ILogger, recipe)], exports: [ILogger]`, а класс
  из другого модуля deps'ит `ILogger('users')`
- **THEN** `build()` завершается успешно и узел `"Logger:users"` имеет
  `metadata.exported === true`

#### Scenario: Non-exported family blocks cross-module member consumption

- **WHEN** `strictExports: true`, модуль logging регистрирует
  `familyProvider(ILogger, recipe)` без `exports`, а класс из другого модуля
  deps'ит `ILogger('users')`
- **THEN** `build()` бросает ошибку о неэкспортированном токене
  `"Logger:users"` модуля logging
