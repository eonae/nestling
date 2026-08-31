# standard-schema-validation

## Purpose

Ядро не привязано к конкретному валидатору: схемные границы типизированы
через `StandardSchemaV1` и валидируют значения вызовом
`schema['~standard'].validate(value)`. Отказ валидации несёт стандартные
JSON-сериализуемые `issues` вместо вендорской ошибки, валидация гарантированно
синхронна, а вся логика живёт в единственной функции `validateSync`. Любой
валидатор, реализующий Standard Schema v1, работает без ветвлений ядра
по вендору; сам валидатор в зависимостях ядра не значится.

## Requirements

### Requirement: Core accepts any Standard Schema

Схемные границы ядра (`parsePayload`, `parseMetadata`, `DomainType`,
`Schema`/`Infer` из `@common/misc`, `EndpointMeta.input`/`output`,
`input`/`output` в декларации endpoint'а) SHALL быть типизированы через
`StandardSchemaV1` и SHALL валидировать значения вызовом
`schema['~standard'].validate(value)`. Вендорские типы (`z.ZodType`,
`z.infer`, `ZodError`) SHALL NOT присутствовать в публичных сигнатурах ядра.
Вывод доменного типа SHALL происходить через `StandardSchemaV1.InferOutput`.

#### Scenario: Валидация zod-схемой

- **WHEN** endpoint объявлен с `input: z.object({ name: z.string() })`
  (zod ≥ 4) и приходит payload `{ name: 'Alice' }`
- **THEN** handler получает `{ name: 'Alice' }`, тип payload'а выведен как
  `{ name: string }`

#### Scenario: Валидация не-zod схемой

- **WHEN** endpoint объявлен со схемой другого валидатора, реализующего
  Standard Schema v1 (валидная схема, соответствующая данным)
- **THEN** валидация проходит и handler получает разобранное значение —
  без каких-либо ветвлений ядра по вендору

#### Scenario: Схема применяет трансформацию

- **WHEN** схема преобразует вход (например, строку в число) и валидация
  проходит
- **THEN** handler получает значение из `result.value`, то есть **выход**
  схемы, а не исходный вход

### Requirement: Validation failures carry standard issues

При отказе валидации ядро SHALL бросать `SchemaValidationError` с полем
`issues: readonly SchemaIssue[]`, где `SchemaIssue` — `{ message: string;
path?: readonly (string | number)[] }`. Путь SHALL быть нормализован при
конструировании ошибки: сегмент-объект `{ key }` разворачивается в `key`,
символ приводится к строке, числовой индекс остаётся числом — так что
`issues` JSON-сериализуемы. Поле `zodError` SHALL NOT существовать.

#### Scenario: Невалидное поле

- **WHEN** схема требует `name: string`, а приходит `{ name: 42 }`
- **THEN** бросается `SchemaValidationError`, у которого `issues[0].message`
  непустая строка, а `issues[0].path` равен `['name']`

#### Scenario: Issues сериализуются в JSON

- **WHEN** валидация вложенного поля массива не прошла
- **THEN** `JSON.stringify(error.issues)` выполняется без потерь, а путь
  представлен массивом строк и чисел (например, `['items', 0, 'id']`)

#### Scenario: Вендорское поле недоступно

- **WHEN** код потребителя читает `error.zodError`
- **THEN** компиляция падает: свойства нет в типе `SchemaValidationError`

### Requirement: Validation is synchronous by guarantee

Валидация в пайплайне SHALL быть синхронной. Если `~standard.validate`
вернул thenable, ядро SHALL бросить `AsyncSchemaNotSupportedError` — вместо
того чтобы отдать handler'у Promise вместо значения. Класс
`AsyncSchemaNotSupportedError` SHALL NOT наследоваться от
`SchemaValidationError`, поскольку это ошибка конфигурации приложения,
а не невалидный вход.

#### Scenario: Схема с async-refinement

- **WHEN** endpoint объявлен со схемой, чей `~standard.validate` возвращает
  Promise, и приходит запрос
- **THEN** бросается `AsyncSchemaNotSupportedError` с сообщением, называющим
  причину; handler не вызывается; Promise наружу не уезжает

#### Scenario: Async-ошибка не выдаёт себя за ошибку валидации

- **WHEN** async-схема сработала на валидном по форме входе
- **THEN** брошенная ошибка не проходит проверку
  `instanceof SchemaValidationError`

### Requirement: Non-conforming schema fails with a clear diagnostic

При попытке провалидировать значение объектом, не реализующим Standard
Schema v1 (нет `~standard` либо `~standard.version !== 1`), ядро SHALL
бросить `NotAStandardSchemaError` с сообщением, называющим вероятную
причину (валидатор старой версии). Диагностика SHALL NOT вырождаться в
`TypeError` о чтении свойства у `undefined`.

#### Scenario: Схема валидатора без поддержки спеки

- **WHEN** в `input` передан объект без свойства `~standard`
- **THEN** бросается `NotAStandardSchemaError`, сообщение упоминает Standard
  Schema и требование к версии валидатора

### Requirement: Validation logic has a single implementation

Валидация SHALL выполняться единственной функцией `validateSync`
(`@common/misc`; `@nestling/pipeline` SHALL реэкспортировать её и
сопутствующие `SchemaValidationError`, `SchemaIssue`, `normalizeIssues`,
`assertStandardSchema`, `AsyncSchemaNotSupportedError`,
`NotAStandardSchemaError` из прежнего места, чтобы публичный API не менялся).
Через неё проходят `parsePayload`, `parseMetadata`, проверка входа
endpoint'а рантаймом пайплайна (capability `endpoint-input-validation`),
поэлементная валидация элементов потока и валидация полей секций конфига.
Прямые вызовы `schema.parse(...)` и дак-тайп-интерфейсы вида
`{ parse(data: unknown): T }` SHALL быть удалены из ядра и транспортов.
Транспорты SHALL NOT содержать собственных веток валидации payload: они
собирают значение, а проверяет его рантайм.

Дом функции — `@common/misc`, а не `@nestling/pipeline`, потому что
конфигурация читается и валидируется до существования запроса: зависимость
`@nestling/config → @nestling/pipeline` инвертировала бы порядок фаз
жизненного цикла.

#### Scenario: Одинаковая ошибка на разных путях

- **WHEN** одна и та же невалидная запись приходит endpoint'у с
  пайплайном и endpoint'у без пайплайна
- **THEN** в обоих случаях ответ несёт `VALIDATION_FAILED` с одинаковой
  формой `issues`

#### Scenario: Поэлементная валидация потока

- **WHEN** в NDJSON-поток приходит элемент, не проходящий схему элемента
- **THEN** бросается `SchemaValidationError` с теми же нормализованными
  `issues`, что и при валидации обычного payload'а

#### Scenario: Прежние импорты продолжают работать

- **WHEN** код импортирует `validateSync` или `SchemaValidationError` из
  `@nestling/pipeline`
- **THEN** импорт разрешается реэкспортом, поведение идентично прямому импорту
  из `@common/misc`

#### Scenario: Конфиг валидирует той же функцией

- **WHEN** поле секции конфига не проходит свою схему
- **THEN** issues имеют ту же нормализованную форму, что и у отказа валидации
  запроса

### Requirement: Core does not depend on a validator

Пакеты ядра (`@common/misc`, `@nestling/container`, `@nestling/config`,
`@nestling/pipeline`, `@nestling/app`, `@nestling/transport`,
`@nestling/transport.http`, `@nestling/transport.cli`) SHALL NOT объявлять
валидатор схем в `dependencies` или `peerDependencies` и SHALL NOT
импортировать его в рантайме. Единственной схемной зависимостью SHALL быть
types-only `@standard-schema/spec`, а тип `StandardSchemaV1` SHALL
реэкспортироваться из `@common/misc` — чтобы потребителю не требовалось ставить
пакет спеки.

#### Scenario: Установка без валидатора

- **WHEN** приложение ставит пакеты ядра и не ставит ни один валидатор
- **THEN** установка проходит без предупреждений о неудовлетворённых peer
  dependencies, а код без схем работает

#### Scenario: Нет рантайм-импортов валидатора

- **WHEN** исходники пакетов ядра (кроме `*.spec.ts`) просматриваются на
  импорты `zod`
- **THEN** ни одного импорта не находится — ни type-only, ни рантайм-

#### Scenario: Тип доступен без установки спеки

- **WHEN** потребитель объявляет собственную функцию с параметром типа
  `Schema`, импортированного из `@common/misc`
- **THEN** код компилируется без прямой зависимости на
  `@standard-schema/spec`

#### Scenario: Конфиг принимает схему любого вендора

- **WHEN** секция объявлена со схемами разных валидаторов в разных полях
- **THEN** `@nestling/config` работает с ними одинаково и не объявляет ни один
  валидатор в зависимостях

### Requirement: Явная JSON Schema объявляется аннотацией рядом со схемой

Схемный слой SHALL экспортировать `jsonSchema(schema, json)` — аннотацию,
возвращающую значение, которое (а) валидирует ровно так же, как исходная
схема (`~standard` тот же), и (б) несёт объявленную JSON Schema.

Аннотация SHALL быть применима в **любой** схемной позиции: `input`,
`output`, лист потоковой формы, схема `fields` формы `multipart`, схема
`details` определения отказа. Поля-override в словаре декларации SHALL NOT
заводиться: путь внутрь дерева форм в декларации выражать нечем.

Аннотированное значение SHALL оставаться значением — глобального реестра
аннотаций и мутации переданной схемы SHALL NOT существовать.

#### Scenario: Аннотированная схема валидирует как исходная

- **WHEN** `jsonSchema(UserSchema, { type: 'object' })` подставлена вместо
  `UserSchema` в `input` декларации
- **THEN** валидация запроса даёт тот же результат и те же `issues`, что и
  без аннотации

#### Scenario: Аннотация в глубине дерева форм

- **WHEN** объявлено `input: multipart({ fields: jsonSchema(Fields, { … }) })`
- **THEN** объявленная JSON Schema используется для полей формы

### Requirement: Вендор-конвертеры схем — нейтральный публичный контракт

Ядро SHALL экспортировать тип `SchemaDocConverter` с полями
`vendor: string` и
`toJsonSchema(schema: StandardSchemaV1, options?: SchemaDocOptions): unknown`,
а также диспетчер, выбирающий конвертер по `schema['~standard'].vendor`.

`SchemaDocOptions` SHALL нести одну необязательную подсказку —
`io: 'input' | 'output'`, — потому что схема с преобразованием описывает
**две** формы: приходящую по проводу и получаемую хендлером. Подсказка
SHALL быть необязательной с обеих сторон: конвертер одного аргумента SHALL
оставаться валидным конвертером, а потребитель, которому направление
безразлично, SHALL иметь право её не передавать.
Контракт SHALL быть нейтральным к потребителю: и снапшот контрактов
(capability `contract-compatibility`), и генератор документации
(capability `openapi-document`) SHALL использовать один и тот же тип, а не
заводить каждый свой.

Диспетчер SHALL предпочитать **явную аннотацию** конвертеру: лист,
аннотированный `jsonSchema(...)`, SHALL отдавать объявленную JSON Schema и
SHALL считаться конвертируемым независимо от того, передан ли конвертер
для его вендора.

Диспетчер SHALL возвращать «конвертера нет» отдельным наблюдаемым исходом,
а не бросать: строгость выбирает потребитель. Ядро SHALL NOT ветвиться по
вендору и SHALL NOT интроспектировать вендорские схемы — конвертер остаётся
единственным местом, знающим устройство конкретного валидатора.

Список конвертеров SHALL быть данными вызывающего (передаётся аргументом);
глобального реестра конвертеров SHALL NOT существовать. Два конвертера с
одним `vendor` в одном списке SHALL быть ошибкой в точке передачи.

#### Scenario: Конвертер выбирается по вендору схемы

- **WHEN** в дифф передан список с конвертером `{ vendor: 'zod' }`, и лист
  формы — zod-схема
- **THEN** для листа вызван `toJsonSchema` этого конвертера, и его результат
  попал в дескриптор

#### Scenario: Конвертера для вендора нет

- **WHEN** список конвертеров пуст, а лист формы — схема вендора `valibot`
- **THEN** диспетчер сообщает «конвертера нет» и ничего не бросает; решение
  о строгости принимает вызывающий

#### Scenario: Аннотация перекрывает конвертацию

- **WHEN** лист аннотирован `jsonSchema(schema, json)`, а список
  конвертеров пуст
- **THEN** диспетчер отдаёт объявленную `json` и не сообщает «конвертера
  нет»

#### Scenario: Аннотация приоритетнее подходящего конвертера

- **WHEN** лист аннотирован и в списке есть конвертер его вендора
- **THEN** отдана объявленная JSON Schema; `toJsonSchema` не вызывался

#### Scenario: Направление конвертации передаётся конвертеру

- **WHEN** документируется ручка со схемой входа, содержащей преобразование
  (`z.string().transform(Number)`)
- **THEN** параметр запроса описан формой **на проводе** (строкой), а не
  формой после преобразования

#### Scenario: Два конвертера одного вендора

- **WHEN** передан список `[zodConverter(), zodConverter()]`
- **THEN** вызов бросает ошибку, называя вендор-дубликат

#### Scenario: Валидация не зависит от конвертеров

- **WHEN** приложение собрано без единого конвертера
- **THEN** `validateSync` и все схемные границы работают ровно как прежде:
  конвертеры к валидации отношения не имеют
