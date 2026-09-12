## MODIFIED Requirements

### Requirement: Адрес операции и её параметры выводятся из bind-карты

Ключ операции SHALL строиться из bind-карты: шаблон пути с заменой
`:param` → `{param}` и метод в нижнем регистре. Две декларации с
одинаковой парой `(метод, путь)` SHALL быть ошибкой, называющей обе ручки
и объявившие их модули.

Схема `input` SHALL конвертироваться в JSON Schema прогоном с
`io: 'input'`, после чего раскладываться по bind-карте:

- поле с размещением `path` SHALL становиться `parameters[in: 'path']` с
  `required: true`;
- поле с размещением `query` SHALL становиться `parameters[in: 'query']`
  со `style: 'form'`, `explode: true`; пометка `multiple` SHALL давать
  схему-массив;
- поля без явного размещения SHALL следовать правилу `rest` карты: при
  `rest: 'query'` — становиться query-параметрами, при `rest: 'body'` —
  оставаться в схеме `requestBody`;
- обязательность параметра SHALL браться из `required` формы
  `io: 'input'`;
- схема `requestBody` SHALL быть схемой формы `io: 'input'` за вычетом
  вынесенных полей — они SHALL удаляться и из `properties`, и из
  `required`.

Схема параметра SHALL браться из `properties[имя]` формы `io: 'input'`,
кроме одного случая. Если свойство формы `io: 'input'` несёт
`type: 'string'`, а свойство формы `io: 'output'` несёт `type` из набора
`boolean`, `number`, `integer`, схема параметра SHALL браться из формы
`io: 'output'` целиком, вместе с её `description`, `default` и
ограничениями. Схема-массив пометки `multiple` SHALL получать выбранное
свойство в `items`.

Форма `io: 'output'` SHALL получаться вторым прогоном того же конвертера.
Второй прогон SHALL идти только тогда, когда разбор входа удался и
bind-карта выносит хотя бы одно поле в путь или в query. Отказ второго
прогона SHALL NOT давать диагностику и SHALL NOT ронять построение: все
параметры такого endpoint'а описываются формой `io: 'input'`.

`operationId` SHALL выводиться детерминированно: имя операции, если
декларация служит операции, иначе слаг от метода и шаблона пути.
Объявлять `operationId` вручную SHALL NOT быть возможно.

Имя операции SHALL быть доступно интроспекции декларации: bind-карта,
построенная конструктором операции, SHALL нести имя своего владельца. Второго
поля
на декларации под это SHALL NOT заводиться — карта это то же значение на
операции и на её реализации.

#### Scenario: Path-параметр становится параметром пути

- **WHEN** документируется `httpEndpoint({ method: 'GET', path: '/users/:id', input: z.object({ id: z.string() }) })`
- **THEN** операция `get` пути `/users/{id}` несёт параметр `id` в `path`
  с `required: true` и схемой строки, а `requestBody` отсутствует

#### Scenario: Помеченное поле уходит из тела в query

- **WHEN** документируется `POST /users` с `input: z.object({ name: z.string(), dryRun: z.boolean().optional() })`
  и `bind: { dryRun: query() }`
- **THEN** `dryRun` присутствует параметром `query` (необязательным), а
  схема `requestBody` содержит `name` и не содержит `dryRun`

#### Scenario: Метод без тела раскладывает весь вход в query

- **WHEN** документируется `GET /users/search` с объектной схемой входа
- **THEN** каждое поле схемы стало query-параметром, `requestBody`
  отсутствует

#### Scenario: Дубль адреса — ошибка

- **WHEN** две декларации объявляют `POST /users`
- **THEN** построение документа бросает ошибку, называющую обе ручки и их
  модули

#### Scenario: Имя операции берётся с операции

- **WHEN** документируется `httpEndpoint({ operation: CreateUser })` с
  операцией имени `users.create`
- **THEN** `operationId` операции равен `users.create`

#### Scenario: Строковый вход со скалярным выходом описан скаляром

- **WHEN** документируется `POST /users` с
  `input: z.object({ name: z.string(), dryRun: z.stringbool().optional() })`
  и `bind: { dryRun: query() }`
- **THEN** параметр `dryRun` несёт схему `{ type: 'boolean' }`, а схема
  `requestBody` описывает `name` строкой

#### Scenario: Path-параметр с разбором в число

- **WHEN** документируется
  `GET /pages/:page` с `input: z.object({ page: z.string().pipe(z.coerce.number().int()) })`
- **THEN** параметр `page` в `path` несёт `type: 'integer'` и остаётся
  `required: true`

#### Scenario: Совпадающие формы параметр не меняют

- **WHEN** документируется `GET /users/search` с
  `input: z.object({ limit: z.coerce.number().optional(), q: z.string() })`
- **THEN** `limit` несёт `type: 'number'`, `q` несёт `type: 'string'`

#### Scenario: Преобразование в схеме оставляет параметры входной формой

- **WHEN** документируется `GET /users` с
  `input: z.object({ dryRun: z.stringbool().optional(), tags: z.string().transform((v) => v.split(',')) })`
- **THEN** построение документа проходит без диагностик, а параметр
  `dryRun` несёт `type: 'string'`

#### Scenario: Тело запроса описано входной формой

- **WHEN** документируется `POST /users` с
  `input: z.object({ dryRun: z.stringbool() })` и `bind: { dryRun: body() }`
- **THEN** схема `requestBody` описывает `dryRun` как `type: 'string'`, а
  параметров у операции нет
