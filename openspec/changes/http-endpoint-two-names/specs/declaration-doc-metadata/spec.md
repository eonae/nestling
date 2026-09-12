## RENAMED Requirements

- FROM: `### Requirement: В форме с `operation:` `doc` принадлежит операции`
- TO: `### Requirement: В реализации операции `doc` принадлежит операции`

## MODIFIED Requirements

### Requirement: В реализации операции `doc` принадлежит операции

`doc` SHALL входить в перечень полей, которыми владеет операция, наравне с
`input`/`output`/`errors`/`bind`. Словарь `httpEndpoint.implement` SHALL
NOT иметь поля `doc`, поэтому его объявление SHALL быть ошибкой
компиляции; для JS-потребителя оно SHALL оставаться ошибкой рантайма при
создании декларации. Декларация, построенная из операции, SHALL получать
`doc` операции.

Документация операции — часть её интерфейса, а не её реализации: две
реализации одной операции SHALL NOT описывать её по-разному.

#### Scenario: Переобъявление отвергается

- **WHEN** из JavaScript вызвано
  `httpEndpoint.implement(CreateUser, { doc: { summary: 'x' }, handler })`
- **THEN** создание бросает ошибку: `doc` принадлежит операции и не может
  быть переобъявлен реализацией

#### Scenario: Документация берётся с операции

- **WHEN** операция `CreateUser` объявлена с `doc: { summary: 'Create user' }`,
  а декларация создана `httpEndpoint.implement`
- **THEN** значение декларации несёт тот же `doc`
