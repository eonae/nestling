## MODIFIED Requirements

### Requirement: `dispatch` — фазовый ресурс, разделяющий провод и исполнение

`@nestling/transport` SHALL экспортировать тип `Dispatch` и конструктор
`makeDispatch(endpoints)`, где `endpoints` — **исполнимые** декларации
(`TNeeds = never`). `Dispatch` SHALL нести:

- `routes` — проекции деклараций, содержащие всё нужное транспорту для
  роутинга и парсинга (паттерн, io-декларация, bind-карта, транспортный
  словарь, объявленные отказы) и SHALL NOT содержащие исполнимых полей
  (`handle`, `pipeline`, `deps`, `resolve`);
- `call(pattern, ctx, options?)` — исполнение endpoint'а рантаймом
  пайплайна, возвращающее `ResponseContext`. Декларация без `pipeline`
  SHALL исполняться тем же рантаймом с пустым пайплайном; отдельной ветки
  прямого вызова хендлера SHALL NOT быть.

`makeDispatch` SHALL вызываться в фазе WIRE — после того, как зависимости
деклараций получены из контейнера. Один `dispatch` SHALL строиться на один
транспорт и SHALL содержать только его endpoint'ы.

#### Scenario: Проекция не содержит хендлера

- **WHEN** транспорт читает элемент `dispatch.routes`
- **THEN** в нём есть паттерн, формы io и bind-карта, но нет `handle` и
  `pipeline` — исполнить endpoint из проекции невозможно

#### Scenario: Исполнение идёт через `call`

- **WHEN** транспорт распарсил запрос, построил контекст и вызвал
  `dispatch.call(pattern, ctx)`
- **THEN** выполняется pipeline endpoint'а с его хендлером, и возвращается
  `ResponseContext`

#### Scenario: Декларация без pipeline

- **WHEN** endpoint объявлен без `pipeline`, и транспорт вызвал
  `dispatch.call(pattern, ctx)`
- **THEN** `dispatch` исполняет его тем же рантаймом с пустым пайплайном:
  вход проверяется по схеме `input`, ответ проверяется по `errors:`,
  область контекста запроса открыта; дублирования этой логики в
  транспортах SHALL NOT быть

#### Scenario: Незадекларированный отказ без pipeline

- **WHEN** endpoint объявлен без `pipeline` и без `errors:`, а его хендлер
  бросает `Fail.notFound('nope')`
- **THEN** `dispatch.call` возвращает `ResponseContext` с `UNKNOWN`/500, а
  оригинал отказа передан хуку `onUnknownFail`

#### Scenario: Транспорт получает только свои endpoint'ы

- **WHEN** приложение обслуживает и HTTP-, и CLI-endpoint'ы
- **THEN** `dispatch`, переданный HTTP-транспорту, содержит только
  HTTP-маршруты

#### Scenario: Опции границы передаются аргументом

- **WHEN** транспорт вызывает `call` с `{ exposeErrorDetails, onUnknownFail }`
- **THEN** исполнение учитывает их; сам `dispatch` этих политик SHALL NOT
  хранить
