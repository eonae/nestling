## MODIFIED Requirements

### Requirement: Ответ формы `value` уходит одной записью заголовков

Для формы `output` вида `value` транспорт SHALL отправлять заголовки одним
`writeHead(status, headers)` и SHALL ставить `content-type:
application/json` и `content-length` по длине сериализованного тела.
Заголовки `HttpResponse` SHALL входить в тот же объект; имя заголовка
SHALL приводиться к нижнему регистру до слияния, поэтому заголовок
хендлера перекрывает заголовок формы независимо от регистра имени.
Каждая cookie из `HttpResponse` SHALL добавляться отдельным заголовком
`Set-Cookie` и SHALL NOT перекрывать предыдущую. Пустой ответ
(`value === null`) SHALL уходить без тела и без `content-type`.

При потоковой форме `output` заголовки `HttpResponse` SHALL записываться
до первого кадра ответа.

#### Scenario: JSON-ответ несёт content-length

- **WHEN** хендлер вернул объект для формы `value`
- **THEN** ответ содержит `content-type: application/json`,
  `content-length`, равный длине тела в байтах, и тело в один `end`

#### Scenario: Заголовок хендлера перекрывает заголовок формы в любом регистре

- **WHEN** хендлер вернул `HttpResponse.of(value, { headers: { 'Content-Type': 'text/plain' } })`
- **THEN** ответ содержит один заголовок `content-type` со значением
  `text/plain`

#### Scenario: Заголовки потока уходят до первого кадра

- **WHEN** хендлер формы `events` вернул `HttpResponse.of(stream, { headers: { 'x-feed': 'live' } })`
- **THEN** заголовок `x-feed` присутствует в ответе до первого
  SSE-кадра
