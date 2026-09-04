# endpoint-declarations Specification (delta)

## MODIFIED Requirements

### Requirement: Форма с `operation:` HTTP-декларации

`httpEndpoint` SHALL принимать форму с `operation:` словаря —
`httpEndpoint({ operation, pipeline?, handler, detached? })`, — в
которой интерфейс операции и её HTTP-адрес берутся с операции.

В этой форме поля `method`, `path`, `bind`, `rawBody`, `sse`, `input`,
`output` и `errors` SHALL быть объявлены как `never`: переобъявление того,
что принадлежит операции, SHALL быть ошибкой компиляции в точке
декларации — той же дисциплиной, что в `ImplementDictionary`.

Bind-карта SHALL браться с операции как есть и SHALL NOT вычисляться
повторно. Операция без секции `http:` SHALL отвергаться в момент создания
декларации; текст ошибки SHALL называть операцию и предлагать объявить
`http:` либо реализовать операцию через `implement` (шина).

Обе формы `handler`, `pipeline`, `detached` и участие в discovery,
политиках и визуализации SHALL работать как у любой HTTP-декларации:
форма с `operation:` — форма записи, а не новый примитив.

#### Scenario: Реализация операции по HTTP

- **WHEN** объявлено `httpEndpoint({ operation: CreateUser, handler: CreateUserHandler })`,
  где операция несёт `http: 'POST /users'`, а `CreateUserHandler` — класс
  под `@Injectable([UserService])` с методом `handle`
- **THEN** создаётся обычная HTTP-декларация на `POST /users` со схемами и
  `errors:` операции

#### Scenario: Переобъявление интерфейса не компилируется

- **WHEN** в форме с `operation:` указаны `input`, `path` или `errors`
- **THEN** это ошибка компиляции

#### Scenario: Операция без `http:`

- **WHEN** в форму с `operation:` передана операция без секции `http`
- **THEN** вызов бросает ошибку в момент создания декларации, называя
  операцию

#### Scenario: Карта не пересчитывается

- **WHEN** форма с `operation:` создала декларацию
- **THEN** её bind-карта — то же значение, что несёт операция

#### Scenario: Декларация ведёт себя как обычная

- **WHEN** такая декларация объявлена в `endpoints:` модуля
- **THEN** discovery, `policies`, визуализация и pipeline работают так же,
  как для анонимной HTTP-декларации
