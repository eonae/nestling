## RENAMED Requirements

- FROM: `### Requirement: HTTP-форма хендлера допустима только в анонимной декларации`
- TO: `### Requirement: HTTP-форма хендлера допустима только в декларации со своим адресом`

## MODIFIED Requirements

### Requirement: HTTP-форма хендлера допустима только в декларации со своим адресом

`implement` и `httpEndpoint.implement` SHALL принимать только
хендлер без `http` в `meta` и без `HttpResponse` в результате. Слот
`pipeline` у `implement` SHALL отвергать пайплайн, требующий полей
стартового контекста: при несовпадении слот SHALL принимать литерал
ошибки с полями `__error`, `missing` и `hint`.

`@nestlingjs/transport.http` SHALL экспортировать `HttpHandlerMeta`
(расширяет `HandlerMeta` полем `http: HttpRequest`) и `HttpHandler<C>` —
интерфейс HTTP-хендлера операции с результатом `HttpOutput`.

#### Scenario: HTTP-класс не проходит в реализацию операции

- **WHEN** класс, объявленный `implements HttpHandler<typeof CreateUser>`,
  передан в `implement(CreateUser, { handler })`
- **THEN** это ошибка компиляции

#### Scenario: HTTP-класс не проходит в реализацию операции по HTTP

- **WHEN** тот же класс передан в `httpEndpoint.implement(CreateUser, { handler })`
- **THEN** это ошибка компиляции

#### Scenario: HTTP-пайплайн не проходит в `implement`

- **WHEN** в слот `pipeline` у `implement` передан
  `makePipeline<HttpStartContext>().pre(withClientIp())`
- **THEN** это ошибка компиляции с литералом, называющим недостающие поля
