## Why

HTTP-метод объявляется полем словаря: `httpEndpoint({ method: 'GET', path:
'/users/:id', … })`. Форма `httpEndpoint.get('/users/:id', { … })` короче
на строку и ставит адрес первым, а метод перестаёт быть строкой среди
других строк. Решение записано в
[deferred [2026-09-03]](../../../docs/decisions/deferred.md) «Конструктор
HTTP-декларации с методом в имени»; change
[68 `http-endpoint-two-names`](../../../docs/decisions/ideas.md) сделал
`httpEndpoint` пространством имён со статиком `.implement` и вынес статики
по методу отдельной строкой, потому что множества мест не пересекаются.

Тот же вопрос стоит у CLI: `cliEndpoint({ command: 'users:list', … })`
называет адрес полем там, где HTTP после этого change'а называет его
аргументом.

## What Changes

- **BREAKING** `httpEndpoint` перестаёт быть функцией и становится
  значением-пространством имён. Декларацию создают шесть статиков по
  HTTP-методу: `httpEndpoint.get`, `.head`, `.post`, `.put`, `.patch`,
  `.delete`. Каждый принимает путь первым аргументом и словарь вторым.
- **BREAKING** Словарь `HttpEndpointDictionary` теряет поля `method` и
  `path`. Литеральный тип пути берётся из первого аргумента, поэтому
  вывод path-параметров и проверка `bind` работают как раньше.
- **BREAKING** `cliEndpoint` принимает имя команды первым аргументом:
  `cliEndpoint('users:list', { … })`. Поле `command` из словаря удаляется.
- `httpEndpoint.implement(Operation, { … })` не меняется: адрес несёт
  операция.
- Правило ESLint `endpoint-has-layer` распознаёт вызов-член
  (`httpEndpoint.get(…)`) и берёт словарь из последнего аргумента, а не из
  первого.
- Тексты ошибок создания называют новую форму:
  `httpEndpoint.get('/users', { … })` вместо
  `httpEndpoint({ method: 'GET', … })`.
- Мигрируют все места вызова: около 337 для HTTP и 29 для CLI, из них 50
  в генерируемом файле бенча типов. Пакеты, примеры, главы гайда,
  рецепты, README пакетов и скилл агента.

## Capabilities

### New Capabilities

Новых способностей нет: change меняет запись существующих.

### Modified Capabilities

- `endpoint-declarations`: конструктор HTTP-декларации — статик по методу,
  принимающий путь аргументом; конструктор CLI-декларации принимает имя
  команды аргументом.
- `endpoint-type-diagnostics`: набор снапшотов диагностик пересобирается
  под новую форму, удалённый словарь с `method` фиксируется фикстурой.
- `policy-eslint-feedback`: правило распознаёт конструктор в форме
  вызова-члена и находит словарь в последнем аргументе.
- `agent-skill-content`: скилл называет форму, которую агент пишет в чужом
  проекте.

## Non-goals

- Секция `http:` операции не меняется. `http: 'GET /users/:id'` и
  объектная форма — данные операции, а не конструктор.
- Статиков по методу у `httpEndpoint.implement` не появляется.
- Формы слота `handler` и их диагностика остаются те, что задал change 68.
- Конструктор `implement(Operation, { … })` для шины не меняется: у него
  нет адреса в аргументе.
- Позиционная форма `httpEndpoint('GET', '/health', … )` не
  рассматривается: метод остался бы строкой.

## Impact

- `@nestlingjs/transport.http`: `src/helpers.ts` — конструктор, словарь,
  тексты ошибок; `src/probes.ts` — декларации проб; снапшоты и фикстуры
  `type-tests/`.
- `@nestlingjs/transport.cli`: `src/index.ts` — конструктор и словарь.
- `@nestlingjs/eslint-plugin`: `src/endpoint-has-layer.ts` и его спеки.
- `@nestlingjs/app`: генератор `type-tests/bench/generate.ts` и
  сгенерированный граф; бюджет типов пересверяется.
- `@nestlingjs/openapi`, `@nestlingjs/testing`, `@nestlingjs/subscriptions`:
  спеки и README с декларациями.
- `examples/*`, `docs/guide/`, `docs/recipes/`, `docs/design/endpoints.md`,
  `docs/design/transports.md`, скилл `@nestlingjs/agent-skill`.
