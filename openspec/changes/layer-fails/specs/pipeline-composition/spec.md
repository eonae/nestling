# pipeline-composition Specification (delta)

## ADDED Requirements

### Requirement: Пайплайн-значение несёт множество объявленных отказов

Пайплайн SHALL нести множество отказов, объявленных при подключении его
pre-юнитов (`.pre(unit, { errors })`), — рядом с множеством объявленных
ambient-переменных и по тем же правилам:

- `makePipeline()` SHALL иметь пустое множество;
- `.pre(unit, { errors })` SHALL добавлять определения из списка;
  `.pre(unit)` без второго аргумента SHALL NOT добавлять ничего;
- `.ok`, `.catch`, `.finally` SHALL сохранять множество;
- `compose(a, b, …)` SHALL давать объединение множеств своих аргументов;
- `bind(resolve)` SHALL сохранять множество несвязанного оригинала.

В типе множество SHALL быть тип-параметром `TFails` пайплайна с дефолтом
`never`; `compose` SHALL выводить объединение `TFails` слоёв тем же
приёмом, что `TAcc` и `TNeeds`, без разворачивания по глубине
композиции. Совпадение определений SHALL определяться по `code`.

Множество SHALL NOT влиять на порядок фаз, накопление `input` и ответную
фазу. Иммутабельность SHALL сохраняться: ни одна операция SHALL NOT
менять множество уже созданного значения.

#### Scenario: Композиция объединяет отказы

- **WHEN** `const authed = compose(observability, makePipeline().pre(Authenticate, { errors: [Unauthorized] }))`
- **THEN** `authed` объявляет `Unauthorized`, а его `TFails` включает
  `typeof Unauthorized`

#### Scenario: Деривация сохраняет отказы

- **WHEN** `const extended = authed.pre(withTenant())`
- **THEN** `extended` объявляет всё, что объявлял `authed`, а сам `authed`
  остаётся неизменным

#### Scenario: Связывание сохраняет отказы

- **WHEN** у пайплайна с классами-юнитами вызван `bind(resolve)`
- **THEN** результат объявляет то же множество отказов

#### Scenario: Бюджет типов

- **WHEN** прогоняется раннер `type-budget` на графе из 50 слоёв и 50
  деклараций с объявленными отказами на каждом слое
- **THEN** счётчики компилятора остаются в порогах `BUDGET.md`, и
  `TS2589` не возникает
