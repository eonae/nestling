## ADDED Requirements

### Requirement: Конверт транспортного ответа — расширение ядра

`@nestling/operations` SHALL объявлять `TransportResponse<TValue>` —
ответ, оформленный транспортом. Конверт SHALL нести четыре поля: метку
`Symbol.for('nestling:transport-response')`, имя транспорта `transport`,
метаданные протокола `meta` и результат `result` (`Ok<TValue>` либо
значение). Ядро SHALL NOT читать `meta`.

Рантайм пайплайна SHALL распознавать конверт по метке, разбирать `result`
тем же кодом, что и обычный ответ, и класть имя транспорта вместе с
метаданными в поле `transport` контекста успешного ответа. Поле `headers`
SHALL быть убрано из обоих контекстов ответа.

Транспорт SHALL читать метаданные, только если имя в них совпадает с его
собственным. Иначе транспорт SHALL отвечать `internal_error`, и текст
ошибки SHALL называть endpoint, ожидаемое и полученное имя транспорта.

`OutputSync` и `Output` SHALL оставаться без конверта: хендлер, не
знающий транспорта, SHALL NOT иметь возможности его вернуть.

#### Scenario: Метаданные доходят до своего транспорта

- **WHEN** хендлер HTTP-декларации возвращает `HttpResponse.of(Ok.created(user), { headers: { Location: '/users/1' } })`
- **THEN** контекст ответа несёт статус `created`, значение `user` и
  метаданные HTTP-протокола, а ответ содержит заголовок `location`

#### Scenario: Чужие метаданные не читаются

- **WHEN** декларация на шине получает конверт с именем транспорта `http`
- **THEN** ответ — `internal_error`, и текст называет endpoint и оба имени

#### Scenario: Нейтральный хендлер конверт вернуть не может

- **WHEN** хендлер, объявленный через `implement`, возвращает
  `HttpResponse.of(...)`
- **THEN** это ошибка компиляции

### Requirement: Анонимная HTTP-декларация даёт хендлеру `meta.http`

`@nestling/transport.http` SHALL экспортировать `HttpRequest` с полями
`method`, `url` (путь с query-строкой, как прислан клиентом), `headers` и
`ip` (адрес сокета, необязательный). Транспорт SHALL класть значение в
стартовый контекст запроса под ключом `http`.

Адрес сокета SHALL читаться по требованию: `remoteAddress` идёт в libuv, а
нужен он только юниту `withClientIp`. Часов на запросе SHALL NOT быть:
`Date.now()` на каждый запрос стоит около 2% пропускной способности.

`httpEndpoint` в анонимной форме SHALL типизировать `meta` хендлера как
результат пайплайна, пересечённый с `{ http: HttpRequest }`. Пересечение
SHALL добавляться независимо от слота `pipeline`: декларация без пайплайна
SHALL тоже давать хендлеру `meta.http`.

Хендлер, не читающий `http`, SHALL оставаться допустимым в этом слоте.

#### Scenario: Хендлер читает заголовок запроса

- **WHEN** анонимный `httpEndpoint` объявлен без `pipeline`, а его хендлер
  объявлен `(input, meta: HttpHandlerMeta) => …`
- **THEN** код компилируется, и `meta.http.headers` содержит заголовки
  запроса

#### Scenario: Нейтральный хендлер годится для HTTP

- **WHEN** в анонимный `httpEndpoint` передан класс с `handle(input, meta: HandlerMeta)`
- **THEN** код компилируется

### Requirement: `HttpResponse` задаёт заголовки, cookie и редирект

`@nestling/transport.http` SHALL экспортировать `HttpResponse` —
значение, реализующее конверт транспортного ответа с именем `http`. Класс
SHALL иметь два конструктора:

- `HttpResponse.of(ok, options?)` — обычный ответ; `ok` это `Ok<T>` или
  значение;
- `HttpResponse.redirect(location, options?)` — редирект.

`options` SHALL принимать `headers` (`Record<string, string>`) и `cookies`
(список значений `Cookie`); `redirect` SHALL дополнительно принимать
`status` из перечня `301 | 302 | 303 | 307 | 308`.

`Cookie` SHALL быть значением с полями `name`, `value`, `maxAge`,
`expires`, `path`, `domain`, `secure`, `httpOnly`, `sameSite`. Каждый
элемент списка SHALL уходить отдельным заголовком `Set-Cookie`.

Результат HTTP-хендлера SHALL описываться типами `HttpOutputSync<T, E>` и
`HttpOutput<T, E>` — это `OutputSync<T, E>` и `Output<T, E>`, дополненные
`HttpResponse<T>`.

#### Scenario: Две cookie уходят двумя заголовками

- **WHEN** хендлер возвращает `HttpResponse.of(value, { cookies: [session, locale] })`
- **THEN** ответ содержит два заголовка `Set-Cookie`

#### Scenario: Редирект отвечает статусом и `Location`

- **WHEN** хендлер возвращает `HttpResponse.redirect('/app')`, а
  декларация объявляет `redirect: 303`
- **THEN** ответ имеет код 303 и заголовок `location: /app`

#### Scenario: Статус вызова перекрывает объявленный

- **WHEN** хендлер возвращает `HttpResponse.redirect('/app', { status: 307 })`
  при `redirect: 303` в декларации
- **THEN** ответ имеет код 307

### Requirement: Редирект объявляется декларацией

`HttpEndpointDictionary` SHALL принимать поле `redirect` со значением из
перечня статусов редиректа. Поле SHALL быть источником статуса ответа,
если вызов `HttpResponse.redirect` статуса не задал; без обоих значений
статус SHALL равняться `302`.

Хендлер, вернувший редирект у декларации без поля `redirect`, SHALL
получать ответ `internal_error`; текст SHALL называть endpoint и поле.

`redirect` вместе с потоковой формой `output` SHALL отвергаться в момент
создания декларации.

#### Scenario: Незаявленный редирект — ошибка обработки

- **WHEN** хендлер вернул `HttpResponse.redirect('/app')`, а декларация
  поля `redirect` не объявила
- **THEN** ответ имеет код 500 с `code: 'internal_error'`, а текст ошибки
  называет endpoint и поле `redirect`

#### Scenario: Редирект и поток вместе не объявляются

- **WHEN** декларация объявляет `redirect: 302` и `output: stream(Item)`
- **THEN** вызов `httpEndpoint` бросает ошибку в момент создания
  декларации

### Requirement: HTTP-форма хендлера допустима только в анонимной декларации

`implement` и форма `httpEndpoint({ operation })` SHALL принимать только
хендлер без `http` в `meta` и без `HttpResponse` в результате. Слот
`pipeline` у `implement` SHALL отвергать пайплайн, требующий полей
стартового контекста: при несовпадении слот SHALL принимать литерал
ошибки с полями `__error`, `missing` и `hint`.

`@nestling/transport.http` SHALL экспортировать `HttpHandlerMeta`
(расширяет `HandlerMeta` полем `http: HttpRequest`) и `HttpHandler<C>` —
интерфейс HTTP-хендлера операции с результатом `HttpOutput`.

#### Scenario: HTTP-класс не проходит в реализацию операции

- **WHEN** класс, объявленный `implements HttpHandler<typeof CreateUser>`,
  передан в `implement(CreateUser, { handler })`
- **THEN** это ошибка компиляции

#### Scenario: HTTP-класс не проходит в форму с `operation:`

- **WHEN** тот же класс передан в `httpEndpoint({ operation: CreateUser, handler })`
- **THEN** это ошибка компиляции

#### Scenario: HTTP-пайплайн не проходит в `implement`

- **WHEN** в слот `pipeline` у `implement` передан
  `makePipeline<HttpStartContext>().pre(withClientIp())`
- **THEN** это ошибка компиляции с литералом, называющим недостающие поля

### Requirement: Стартовый контекст задаётся в тестовом вызове

`TestCallOptions` SHALL принимать поле `input` — стартовый контекст
запроса. Поле SHALL быть общим для всех транспортов: `@nestling/testing`
SHALL NOT зависеть от пакета транспорта и SHALL NOT называть его типы.

#### Scenario: Тест задаёт HTTP-метаданные

- **WHEN** тест вызывает `app.call('POST /login', body, { input: { http: { method: 'POST', url: '/login', headers: {} } } })`
- **THEN** хендлер получает эти значения в `meta.http`
