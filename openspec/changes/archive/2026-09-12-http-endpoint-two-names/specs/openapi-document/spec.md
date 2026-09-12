## MODIFIED Requirements

### Requirement: Адрес операции и её параметры выводятся из bind-карты

Ключ операции SHALL строиться из bind-карты: шаблон пути с заменой
`:param` → `{param}` и метод в нижнем регистре. Две декларации с
одинаковой парой `(метод, путь)` SHALL быть ошибкой, называющей обе ручки
и объявившие их модули.

Схема `input` SHALL конвертироваться в JSON Schema **один раз**, после чего
раскладываться по bind-карте:

- поле с размещением `path` SHALL становиться `parameters[in: 'path']` с
  `required: true`;
- поле с размещением `query` SHALL становиться `parameters[in: 'query']`
  со `style: 'form'`, `explode: true`; пометка `multiple` SHALL давать
  схему-массив;
- поля без явного размещения SHALL следовать правилу `rest` карты: при
  `rest: 'query'` — становиться query-параметрами, при `rest: 'body'` —
  оставаться в схеме `requestBody`;
- схема каждого параметра SHALL браться из `properties[имя]`
  конвертированной схемы, а его обязательность — из её `required`;
- схема `requestBody` SHALL быть конвертированной схемой за вычетом
  вынесенных полей — они SHALL удаляться и из `properties`, и из
  `required`.

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

- **WHEN** документируется `httpEndpoint.implement(CreateUser, { handler })`
  с операцией имени `users.create`
- **THEN** `operationId` операции равен `users.create`
