# http-transport-boundary Specification (delta)

## ADDED Requirements

### Requirement: Ответ формы `value` уходит одной записью заголовков

Для формы `output` вида `value` транспорт SHALL отправлять заголовки одним
`writeHead(status, headers)` и SHALL ставить `content-type:
application/json` и `content-length` по длине сериализованного тела.
Заголовки `Ok` SHALL входить в тот же объект; имя заголовка `Ok` SHALL
приводиться к нижнему регистру до слияния, поэтому заголовок хендлера
перекрывает заголовок формы независимо от регистра имени. Пустой ответ
(`value === null`) SHALL уходить без тела и без `content-type`.

#### Scenario: JSON-ответ несёт content-length

- **WHEN** хендлер вернул объект для формы `value`
- **THEN** ответ содержит `content-type: application/json`,
  `content-length`, равный длине тела в байтах, и тело в один `end`

#### Scenario: Заголовок хендлера перекрывает заголовок формы в любом регистре

- **WHEN** хендлер вернул `Ok.created(value, { 'Content-Type': 'text/plain' })`
- **THEN** ответ содержит один заголовок `content-type` со значением
  `text/plain`

### Requirement: `raw.pattern` несёт путь запроса как прислан клиентом

`raw.pattern` контекста запроса SHALL быть строкой `<метод> <путь>`, где
путь — часть `req.url` до `?` без нормализации и декодирования. Транспорт
SHALL NOT строить `URL` на запрос; query-строка SHALL разбираться только
когда bind-карта маршрута читает query и в запросе есть `?`.

#### Scenario: Путь с кодированными символами

- **WHEN** клиент запрашивает `GET /users/a%20b?limit=1`
- **THEN** `raw.pattern` равен `GET /users/a%20b`, а поле `limit`
  bind-карты читается из query

#### Scenario: Запрос без query у маршрута, читающего query

- **WHEN** клиент запрашивает `GET /users` без `?`
- **THEN** payload собирается без разбора query-строки, а поля со
  значениями по умолчанию в схеме получают их из схемы
