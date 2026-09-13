## MODIFIED Requirements

### Requirement: `Ok` несёт значение и статус успеха, но не заголовки

`Ok` SHALL иметь два поля результата: `status` из перечня `SuccessStatus`
и `value`. Поля `headers` у `Ok` SHALL NOT существовать.

`Ok` SHALL быть параметризован статусом — `Ok<TValue, TStatus>`, где
`TStatus` выводится в точке создания значения: `new Ok(value)` даёт
`Ok<T, 'ok'>`, `new Ok('created', value)` — `Ok<T, 'created'>`,
`Ok.created(value)` — `Ok<T, 'created'>`, `Ok.accepted(value)` —
`Ok<T, 'accepted'>`, `Ok.noContent()` — `Ok<null, 'no_content'>`. Параметр
нужен декларации: она ограничивает результат хендлера объявленным
множеством статусов (capability `declared-success-status`).

Конструктор `Ok` SHALL принимать только `(status, value)` и `(value)`.
`Ok.created` и `Ok.accepted` SHALL принимать одно значение, `Ok.noContent`
SHALL вызываться без аргументов. Второй аргумент SHALL быть ошибкой
компиляции.

Заголовки, cookie и редирект SHALL задаваться формой ответа своего
транспорта (capability `http-handler-form`). Статусы успеха от транспорта
не зависят и SHALL оставаться у обеих форм хендлера.

#### Scenario: Заголовок на `Ok` не объявляется

- **WHEN** написано `Ok.created(user, { Location: '/users/1' })`
- **THEN** это ошибка компиляции

#### Scenario: Статус успеха остаётся

- **WHEN** HTTP-хендлер возвращает `HttpResponse.of(Ok.created(user), { headers: { Location: '/users/1' } })`
- **THEN** ответ имеет код 201 и заголовок `location`

#### Scenario: Статус виден в типе значения

- **WHEN** написано `const result = Ok.created(user)`
- **THEN** тип `result` — `Ok<User, 'created'>`, и присваивание его
  переменной типа `Ok<User, 'ok'>` — ошибка компиляции
