## ADDED Requirements

### Requirement: Интерфейс `Metrics` — два пишущих метода

`@nestlingjs/app` SHALL экспортировать интерфейс `Metrics` с методами
`counter(name, value?, attributes?)` и
`histogram(name, value, attributes?)`, а также тип
`MetricAttributes = Record<string, string | number | boolean>`.

`counter` без значения SHALL увеличивать счётчик на единицу. Оба метода
SHALL возвращать `void` и SHALL NOT быть асинхронными: запись метрики не
имеет права задерживать запрос.

Объектов-инструментов SHALL NOT существовать: ядро пишет значение по имени,
а кэширование инструментов SHALL оставаться делом реализации. Метода
`gauge` в V1 SHALL NOT быть.

#### Scenario: Счётчик без значения

- **WHEN** вызвано `metrics.counter('orders.created')`
- **THEN** реализация получает имя и значение `1`

#### Scenario: Гистограмма с атрибутами

- **WHEN** вызвано `metrics.histogram('db.query', 12, { table: 'users' })`
- **THEN** реализация получает имя, значение `12` и атрибут `table`

### Requirement: `RootMetrics$` и семейство `Metrics$`

`@nestlingjs/app` SHALL экспортировать DI-токен `RootMetrics$` типа
`Metrics` и семейство DI-токенов `Metrics$` с параметром `scope`.

Корневая реализация SHALL задаваться опцией `makeApp({ metrics })`. Без
опции SHALL действовать пустая реализация: методы ничего не делают и
ничего не создают.

Провайдер приложения под `RootMetrics$` SHALL быть ошибкой дубля, текст
которой называет опцию `metrics` как единственный способ задать корень.
Подмена `[RootMetrics$, …]` в `overrides` тестового корня SHALL работать.

Kernel-модуль метрик SHALL регистрировать рецепт семейства: член
`Metrics$(scope)` SHALL добавлять к каждой записи атрибут `scope`.
`Metrics$.auto` SHALL давать члена по имени класса-потребителя. Члены
семейства SHALL оставаться узлами графа.

Узел `RootMetrics$` SHALL присутствовать в графе всегда: фича, которая
пишет метрику, SHALL собираться без установленного сателлита.

#### Scenario: Член семейства добавляет область

- **WHEN** класс объявляет `@Component([Metrics$('users')])` и пишет
  `counter('created')`
- **THEN** реализация получает запись с атрибутом `scope: 'users'`

#### Scenario: `.auto` даёт члена по имени класса

- **WHEN** класс `OrdersService` объявляет `@Component([Metrics$.auto])`
- **THEN** он получает члена `Metrics$('OrdersService')`

#### Scenario: Без опции запись пропадает

- **WHEN** приложение собрано без `metrics`, а сервис пишет счётчик
- **THEN** вызов проходит, приложение работает, и записи никуда не уходят

#### Scenario: Провайдер под корнем не принимается

- **WHEN** модуль объявляет
  `providers: [factoryProvider(RootMetrics$, () => custom, [])]`
- **THEN** сборка падает ошибкой дубля, называющей опцию `metrics`

### Requirement: Ядро считает счётчик и длительность на endpoint

Рантайм пайплайна SHALL писать метрики обработки запроса в ответной фазе —
там же, где вычислен `outcome` и вызываются `.finally`-юниты.

| Метрика | Вид | Атрибуты |
| --- | --- | --- |
| `nestling.requests` | счётчик | `transport`, `pattern`, `outcome` |
| `nestling.request.duration` | гистограмма, мс | `transport`, `pattern`, `outcome` |

`outcome` SHALL принимать те же четыре значения, что видит `.finally`-юнит:
`completed`, `disconnected`, `aborted`, `failed`. `pattern` SHALL быть
шаблоном маршрута из декларации endpoint'а, а не адресом запроса:
атрибуты SHALL браться из деклараций, и значения из запроса в метрики
SHALL NOT попадать.

У потокового ответа ответная фаза откладывается до закрытия итератора,
поэтому длительность SHALL измерять доставку целиком, а не работу
хендлера.

`ExecuteOptions` рантайма и `MakeDispatchOptions` SHALL принимать
`metrics?: Metrics` рядом с `logger`.

#### Scenario: Успешный запрос

- **WHEN** `GET /users` обработан успешно в приложении с настроенными
  метриками
- **THEN** счётчик `nestling.requests` получает запись с
  `transport: 'http'`, `pattern: 'GET /users'` и `outcome: 'completed'`, а
  гистограмма `nestling.request.duration` — длительность в миллисекундах

#### Scenario: Отказ учитывается отдельно

- **WHEN** хендлер возвращает `Fail.notFound('nope')`
- **THEN** записи несут `outcome: 'failed'`

#### Scenario: Разрыв соединения учитывается отдельно

- **WHEN** клиент отключился до ответа
- **THEN** записи несут `outcome: 'disconnected'`

#### Scenario: Адрес запроса в атрибуты не попадает

- **WHEN** обработан `GET /users/42` по декларации `GET /users/:id`
- **THEN** атрибут `pattern` равен `GET /users/:id`

#### Scenario: Поток учитывается после закрытия итератора

- **WHEN** endpoint с потоковым выходом доставил все элементы
- **THEN** запись появляется после закрытия итератора, и длительность
  покрывает доставку

### Requirement: Ядро считает счётчик и длительность на вызов порта

Узел порта SHALL писать метрики вызова независимо от пути биндинга.

| Метрика | Вид | Атрибуты |
| --- | --- | --- |
| `nestling.port.calls` | счётчик | `operation`, `kind`, `binding`, `outcome` |
| `nestling.port.duration` | гистограмма, мс | `operation`, `kind`, `binding`, `outcome` |

`operation` SHALL быть именем операции, `kind` — её видом (`request`,
`command`, `event`), `binding` SHALL принимать `local` и `remote`.

Вызов порта с co-located реализацией идёт через `dispatch` и поэтому SHALL
давать обе группы метрик: свою и метрику endpoint'а реализации. Атрибут
`binding` SHALL разделять их при подсчёте.

#### Scenario: Удалённый вызов

- **WHEN** порт с биндингом `always-remote` вернул результат
- **THEN** записи несут `binding: 'remote'` и `outcome: 'completed'`

#### Scenario: Отказ порта

- **WHEN** реализация вернула объявленный отказ
- **THEN** записи несут `outcome: 'failed'`

#### Scenario: Локальный вызов даёт две группы записей

- **WHEN** порт с co-located реализацией вызван из обработчика
- **THEN** есть запись `nestling.port.calls` с `binding: 'local'` и запись
  `nestling.requests` endpoint'а реализации

### Requirement: Приложение без метрик не платит за них

Инструментовка ядра SHALL включаться вместе с опцией
`makeApp({ metrics })`. Без неё рантайм SHALL NOT снимать время и SHALL NOT
вызывать методы записи: поле `metrics` в `ExecuteOptions` SHALL оставаться
незаполненным.

Флага включения в интерфейсе `Metrics` SHALL NOT существовать.

#### Scenario: Пустая реализация не вызывается

- **WHEN** приложение собрано без `metrics` и обрабатывает запрос
- **THEN** ни один метод `Metrics` не вызван

### Requirement: `spyMetrics()` — записи значениями

`@nestlingjs/testing` SHALL экспортировать `spyMetrics()`, возвращающий
`{ metrics, records }`, где запись — `{ kind, name, value, attributes }`, а
`kind` принимает `counter` и `histogram`.

Подмена `[RootMetrics$, spy.metrics]` в `overrides` SHALL перехватывать
записи всех членов `Metrics$` и записи ядра.

#### Scenario: Записи сервиса через подмену корня

- **WHEN** `assembleTest(app, { overrides: [[RootMetrics$, spy.metrics]] })`,
  и сервис с `Metrics$.auto` пишет `counter('created')`
- **THEN** `spy.records` содержит запись с `kind: 'counter'`,
  `name: 'created'`, `value: 1` и атрибутом `scope`

#### Scenario: Метрики ядра видны тесту

- **WHEN** тестовое приложение с подменённым корнем обработало запрос
- **THEN** `spy.records` содержит запись `nestling.requests`
