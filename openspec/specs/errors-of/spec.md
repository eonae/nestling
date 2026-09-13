# errors-of

## Purpose

Вызывающая операция обязана перечислить в своём `errors:` отказы каждой
вызываемой операции, чей `Fail` она пробрасывает наружу. `errorsOf(operation)`
читает `errors:` объявленной операции типизированным геттером — тем же
значением, без копирования — так что список отказов вызываемой операции
можно включить в `errors:` вызывающей через spread, вместо ручного
перечисления.

## Requirements

### Requirement: `errorsOf` отдаёт список отказов операции значением

`@nestlingjs/operations` SHALL экспортировать `errorsOf(operation)`,
принимающую значение, объявленное `makeRequest` или `makeCommand`, и
возвращающую его `errors:` тем же значением — тот же массив определений
`makeFail`, без копирования и без потери идентичности элементов. Вызов
SHALL NOT иметь побочных эффектов и SHALL NOT изменять переданную операцию.

Тип результата SHALL сохранять union конкретных определений отказов
операции, а не расширяться до `readonly AnyFailDefinition[]`: если
`Operation` объявлена с `errors: [A, B]`, `errorsOf(Operation)` SHALL иметь
тип `readonly [typeof A, typeof B]` (или эквивалентный union-тип),
достаточный, чтобы `[...errorsOf(Operation)]` типизировал `errors:`
вызывающей декларации так же, как если бы `A` и `B` были перечислены в ней
напрямую.

#### Scenario: Список отказов читается без копирования

- **WHEN** операция `ClaimQuota` объявлена с `errors: [QuotaExceeded]`
- **THEN** `errorsOf(ClaimQuota)` возвращает массив, содержащий
  `QuotaExceeded`, и `QuotaExceeded === errorsOf(ClaimQuota)[0]`

#### Scenario: Результат используется в `errors:` вызывающей операции

- **WHEN** объявлено `makeRequest({ …, errors: [...errorsOf(ClaimQuota), EmailTaken] })`
- **THEN** тип хендлера допускает возврат и `QuotaExceeded`, и `EmailTaken`,
  как если бы оба были перечислены в `errors:` напрямую

#### Scenario: Операция без объявленных отказов

- **WHEN** операция объявлена без поля `errors:`
- **THEN** `errorsOf(operation)` возвращает пустой массив

### Requirement: `errorsOf` не принимает операции вида `event`

Компилятор SHALL отвергать вызов `errorsOf` с операцией, объявленной
`makeEvent`: `makeEvent` не принимает `errors:` (capability
`contract-declarations`), поэтому у события нет списка отказов, который
можно было бы прочитать.

#### Scenario: Событие не имеет отказов для чтения

- **WHEN** в `errorsOf` передана операция, объявленная `makeEvent(...)`
- **THEN** компилятор отвергает вызов
