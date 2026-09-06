## MODIFIED Requirements

### Requirement: Build creates a synthetic aggregate node for referenced Family.all

`build()` SHALL создавать синтетический узел-агрегат для каждого семейства,
чей `Family.all` упомянут в deps хотя бы одного зарегистрированного провайдера.
Агрегат SHALL создаваться после фикспоинта создания членов семейств и до
построения графа, регистрироваться обычным провайдером с deps = токены всех
зарегистрированных членов семейства и значением — массивом их инстансов.
Массив SHALL быть заморожен (`Object.freeze`) и типизирован как `readonly T[]`.
`Family.all`, не упомянутый в deps, SHALL NOT порождать узла: после `build()`
`container.has(Family.all)` для него возвращает `false`.

#### Scenario: Aggregate collects contributions registered by different modules

- **WHEN** модуль `db` регистрирует `classProvider(IHealthCheck('db'), DbCheck)`,
  модуль `redis` — `classProvider(IHealthCheck('redis'), RedisCheck)`, а класс
  объявлен как `@Component([IHealthCheck.all])`
- **THEN** в конструктор инжектится массив из двух инстансов — тех же, что
  лежат в узлах `"HealthCheck:db"` и `"HealthCheck:redis"`, — а в графе
  присутствует узел `"HealthCheck:{all}"` с двумя зависимостями

#### Scenario: Aggregate array is frozen

- **WHEN** потребитель получил массив из `IHealthCheck.all` и пытается его
  мутировать (`push`)
- **THEN** массив заморожен и мутация не изменяет его состава

#### Scenario: Unreferenced all creates no node

- **WHEN** зарегистрированы вклады `IHealthCheck('db')` и `IHealthCheck('redis')`,
  но `IHealthCheck.all` не упомянут в deps ни одного провайдера
- **THEN** узла агрегата в графе нет

### Requirement: Aggregate is an ordinary graph node

Узел-агрегат SHALL участвовать во всех механизмах контейнера наравне с
обычными узлами: присутствие в графе (`toJSON()`/`traverse()`) и визуализации,
детекция циклов (включая цикл `агрегат → член → агрегат`), топологический
порядок `init()`/`destroy()` (вклады создаются до потребителей агрегата и
освобождаются после них). `Family.all` SHALL быть допустим в deps любого вида
определения — класса с декоратором роли, `factoryProvider`, `classProvider`,
`resourceProvider` и провайдера, порождённого рецептом семейства.

#### Scenario: Cycle through the aggregate is detected

- **WHEN** провайдер члена `IHealthCheck('db')` объявляет dep
  `IHealthCheck.all`
- **THEN** `build()` бросает ошибку о циклической зависимости, упоминающую
  токен агрегата `"HealthCheck:{all}"`

#### Scenario: Порядок захвата и освобождения вокруг агрегата

- **WHEN** вклады объявлены ресурсами, потребитель агрегата — тоже, и
  вызваны `container.init()`, затем `container.destroy()`
- **THEN** `acquire` вкладов вызваны до `acquire` потребителя, а `release`
  вкладов — после `release` потребителя, каждый ровно один раз

#### Scenario: all is allowed in factory provider deps

- **WHEN** зарегистрирован `factoryProvider(IReport, (checks) => …, [IHealthCheck.all])`
- **THEN** `build()` завершается успешно и фабрика получает массив вкладов
