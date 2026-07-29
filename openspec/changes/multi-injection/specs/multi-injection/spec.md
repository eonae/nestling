# multi-injection

## ADDED Requirements

### Requirement: Family.all is a reserved aggregate sentinel token

`TokenFamily<T>` SHALL предоставлять свойство `all` — сентинел-токен,
типизированный как `TokenString<readonly T[]>`, с id `"<familyName>:{all}"`.
Параметр `{all}` SHALL быть зарезервирован: вызов `Family('{all}')` SHALL
бросать ошибку, называющую семейство и зарезервированность параметра.
Регистрация собственного провайдера с `provide: Family.all` — напрямую в
билдере, через `providers` модуля или как результат рецепта семейства — SHALL
завершаться ошибкой, сообщающей, что токен зарезервирован за синтетическим
узлом-агрегатом.

#### Scenario: all sentinel id and type

- **WHEN** создано семейство
  `IHealthCheck = makeTokenFamily<HealthCheck, [name: string]>('HealthCheck')`
- **THEN** `IHealthCheck.all` — токен с id `"HealthCheck:{all}"`,
  типизированный как `TokenString<readonly HealthCheck[]>`

#### Scenario: Reserved parameter is rejected

- **WHEN** вызван `IHealthCheck('{all}')`
- **THEN** вызов бросает ошибку, называющую семейство `HealthCheck` и
  зарезервированность параметра `{all}`

#### Scenario: Hand-registered provider for the all token is rejected

- **WHEN** зарегистрирован `valueProvider(IHealthCheck.all, [])`
- **THEN** регистрация завершается ошибкой о том, что токен
  `"HealthCheck:{all}"` зарезервирован за узлом-агрегатом семейства

### Requirement: Build creates a synthetic aggregate node for referenced Family.all

`build()` SHALL создавать синтетический узел-агрегат для каждого семейства,
чей `Family.all` упомянут в deps хотя бы одного зарегистрированного провайдера.
Агрегат SHALL создаваться после фикспоинта материализации членов семейств и до
инстанциации, регистрироваться обычным провайдером с deps = токены всех
зарегистрированных членов семейства и значением — массивом их инстансов.
Массив SHALL быть заморожен (`Object.freeze`) и типизирован как `readonly T[]`.
`Family.all`, не упомянутый в deps, SHALL NOT порождать узла: после `build()`
`container.get(Family.all)` для него возвращает `null`.

#### Scenario: Aggregate collects contributions registered by different modules

- **WHEN** модуль `db` регистрирует `classProvider(IHealthCheck('db'), DbCheck)`,
  модуль `redis` — `classProvider(IHealthCheck('redis'), RedisCheck)`, а класс
  объявлен как `@Injectable([IHealthCheck.all])`
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
- **THEN** после `build()` узла `"HealthCheck:{all}"` в графе нет и
  `container.get(IHealthCheck.all)` возвращает `null`

### Requirement: Aggregate composition covers every registered member and forces no materialization

Состав агрегата SHALL включать всех членов семейства, у которых на момент
создания агрегата есть провайдер: явно зарегистрированные вклады, члены,
материализованные рецептом из deps, и члены, полученные из `Family.auto`.
Наличие `familyProvider` для семейства SHALL NOT быть обязательным —
семейство с одними явными вкладами агрегируется штатно. `Family.all` SHALL NOT
форсировать материализацию: член, созданный вызовом `Family(param)`, но не
упомянутый в deps и не имеющий явного провайдера, в массив SHALL NOT попадать.
Каждый член SHALL присутствовать в массиве ровно один раз, независимо от числа
его потребителей, и все потребители `Family.all` одного семейства SHALL
получать один и тот же массив.

#### Scenario: Family without a recipe aggregates explicit contributions

- **WHEN** для семейства `IHealthCheck` не зарегистрирован `familyProvider`, но
  зарегистрированы два провайдера с членскими токенами, и потребитель объявляет
  `IHealthCheck.all`
- **THEN** `build()` завершается успешно и массив содержит два инстанса

#### Scenario: Recipe-materialized member joins the aggregate

- **WHEN** зарегистрирован `familyProvider(IHealthCheck, recipe)`, некоторый
  класс объявляет dep `IHealthCheck('db')`, а другой — `IHealthCheck.all`
- **THEN** член `"HealthCheck:db"` материализован рецептом один раз и входит в
  массив агрегата тем же инстансом, что инжектится первому классу

#### Scenario: Unreferenced member stays out of the aggregate

- **WHEN** вызван `IHealthCheck('orphan')` (токен создан), но этот член не
  упомянут в deps и не имеет явного провайдера, при этом потребитель объявляет
  `IHealthCheck.all`
- **THEN** массив агрегата не содержит члена `'orphan'`, а узла
  `"HealthCheck:orphan"` в графе нет

#### Scenario: Two consumers share one aggregate

- **WHEN** два класса объявляют dep `IHealthCheck.all`
- **THEN** в графе один узел `"HealthCheck:{all}"`, оба класса получают один и
  тот же массив, и вклад, который дополнительно инжектится напрямую по
  членскому токену, представлен в массиве тем же единственным инстансом

### Requirement: Empty family aggregates to an empty array

`Family.all` семейства без единого зарегистрированного члена SHALL давать узел
без зависимостей со значением — пустым массивом; ошибкой сборки пустое
семейство SHALL NOT быть.

#### Scenario: No contributions at all

- **WHEN** ни одного члена семейства `IHealthCheck` не зарегистрировано и не
  материализовано, а потребитель объявляет dep `IHealthCheck.all`
- **THEN** `build()` завершается успешно, потребитель получает пустой массив, и
  в графе присутствует узел `"HealthCheck:{all}"` без зависимостей

### Requirement: Aggregate member order is registration order

Порядок элементов массива SHALL соответствовать порядку регистрации
провайдеров-членов в билдере: явно зарегистрированные вклады — в порядке
регистрации модулей и провайдеров внутри модуля, затем члены, материализованные
фикспоинтом, — в порядке материализации. Порядок SHALL быть детерминированным
для одной и той же последовательности регистраций. Никаких иных гарантий
порядка (сортировка по параметру, приоритеты вкладов) SHALL NOT
подразумеваться.

#### Scenario: Contributions appear in registration order

- **WHEN** модули зарегистрированы в порядке `a`, `b`, `c`, и каждый
  регистрирует по одному вкладу семейства
- **THEN** массив агрегата содержит инстансы вкладов в порядке `a`, `b`, `c`

#### Scenario: Explicit contributions precede materialized members

- **WHEN** зарегистрированы явный вклад `IHealthCheck('db')` и рецепт
  семейства, а член `IHealthCheck('redis')` материализуется из deps
  потребителя
- **THEN** в массиве агрегата инстанс `'db'` предшествует инстансу `'redis'`

### Requirement: Aggregate is an ordinary graph node

Узел-агрегат SHALL участвовать во всех механизмах контейнера наравне с
обычными узлами: присутствие в графе (`toJSON()`/`traverse()`) и визуализации,
детекция циклов (включая цикл `агрегат → член → агрегат`), топологический
порядок `init()`/`destroy()` (вклады инициализируются до потребителей агрегата
и уничтожаются после них). `Family.all` SHALL быть допустим в deps любого вида
определения — классового `@Injectable`, `factoryProvider`, `classProvider` и
провайдера, порождённого рецептом семейства.

#### Scenario: Cycle through the aggregate is detected

- **WHEN** провайдер члена `IHealthCheck('db')` объявляет dep
  `IHealthCheck.all`
- **THEN** `build()` бросает ошибку о циклической зависимости, упоминающую
  токен агрегата `"HealthCheck:{all}"`

#### Scenario: Lifecycle order across the aggregate

- **WHEN** вклады имеют `@OnInit`/`@OnDestroy`, потребитель агрегата — тоже, и
  вызваны `container.init()`, затем `container.destroy()`
- **THEN** init-хуки вкладов вызваны до init-хука потребителя, а destroy-хуки
  вкладов — после destroy-хука потребителя, каждый ровно один раз

#### Scenario: all is allowed in factory provider deps

- **WHEN** зарегистрирован `factoryProvider(IReport, (checks) => …, [IHealthCheck.all])`
- **THEN** `build()` завершается успешно и фабрика получает массив вкладов

#### Scenario: Aggregate appears in the graph

- **WHEN** контейнер с агрегатом собран
- **THEN** `toJSON()`/`traverse()` содержат узел `"HealthCheck:{all}"` с
  рёбрами на узлы членов семейства

### Requirement: Aggregate belongs to no module and consumes contributions as an outside consumer

Узел-агрегат SHALL иметь `metadata.module === undefined`. При
`strictExports: true` его рёбра SHALL проверяться существующим правилом
кросс-модульных рёбер: вклад, принадлежащий модулю M, SHALL быть объявлен в
`exports` модуля M (собственным токеном или семейством целиком), иначе сборка
завершается ошибкой; ребро `потребитель → агрегат` SHALL допускаться свободно.

#### Scenario: Aggregate node has no module attribution

- **WHEN** контейнер с агрегатом собран
- **THEN** узел `"HealthCheck:{all}"` имеет `metadata.module === undefined`

#### Scenario: Non-exported contribution fails a strict build

- **WHEN** `strictExports: true`, модуль `db` регистрирует вклад
  `IHealthCheck('db')` и не объявляет его в `exports`, а потребитель объявляет
  `IHealthCheck.all`
- **THEN** `build()` бросает ошибку strictExports, называющую ребро
  `"HealthCheck:{all}" → "HealthCheck:db"` и модуль-владелец

#### Scenario: Family export makes contributions consumable by the aggregate

- **WHEN** `strictExports: true` и модуль-вкладчик объявляет
  `exports: [IHealthCheck]`
- **THEN** `build()` завершается успешно
