## Why

`Ok` несёт поле `headers`, и это единственный способ вернуть `Location`
или `Set-Cookie`. Поле объявлено не зависящим от транспорта, но
осмысленно только в HTTP: CLI его отбрасывает, NATS кладёт в заголовки
ответного сообщения, где `Location` ничего не значит. Редирект и cookie
через него не выражаются вовсе: редирект требует статуса 3xx, которого в
`SuccessStatus` нет.

Отдельная дыра рядом — юниты пайплайна, которым нужен HTTP-запрос.
Правила для них нет: юнит, читающий заголовок, ничем не отличается от
юнита, работающего на шине, и попадает в реализацию операции без ошибки
компиляции.

Решение зафиксировано записью
[ideas.md [2026-09-06] «HTTP-хендлер явной формой»](../../../docs/decisions/ideas.md)
и уже описано в `design/`
([endpoints.md §3](../../../docs/design/endpoints.md),
[transports.md §1.2](../../../docs/design/transports.md),
[errors.md §5](../../../docs/design/errors.md),
[pipeline.md §5](../../../docs/design/pipeline.md)). Change приводит код
к этому описанию. Он идёт после `resources-and-roles` (46), чей декоратор
`@Handler` уже в коде.

## What Changes

- **BREAKING**: `Ok` больше не принимает заголовки. Убираются
  необязательный параметр конструктора, вторые параметры `Ok.created` и
  `Ok.accepted`, единственный параметр `Ok.noContent` и поле
  `Ok.headers`. Статусы успеха остаются.
- **BREAKING**: `implement` и форма `httpEndpoint({ operation })`
  принимают только хендлер без HTTP-метаданных. Пайплайн, требующий
  HTTP-контекст, в эти слоты не компилируется.
- Ядро получает конверт транспортного ответа: значение плюс метаданные
  протокола, помеченные именем транспорта. Пайплайн его разбирает,
  контекст ответа доносит метаданные до транспорта, чужой транспорт
  отвечает `internal_error`.
- `@nestling/transport.http` экспортирует `HttpRequest`,
  `HttpHandlerMeta`, `HttpResponse`, `HttpOutput`, `HttpHandler<Op>` и
  `HttpStartContext`. `HttpResponse.redirect(location, options)` даёт
  редирект, `HttpResponse.of(ok, options)` — обычный ответ с заголовками
  и cookie.
- Анонимный `httpEndpoint` кладёт `http: HttpRequest` в стартовый
  контекст и в `meta` хендлера. Хендлер без HTTP-метаданных в этом слоте
  по-прежнему компилируется.
- `@nestling/app` экспортирует `HandlerMeta` и `Handler<Op>`: типы
  хендлера выводятся из операции и руками не переписываются.
- `@nestling/transport.http` поставляет юниты `withHeader(name)`,
  `withClientIp()` и `httpAccessLog(logger)`. Они типизированы
  `HttpStartContext` и допустимы только в слоте `pipeline` анонимного
  `httpEndpoint`.
- HTTP-транспорт пишет заголовки, cookie и статус редиректа из
  `HttpResponse`, а не из `Ok`.
- Генератор OpenAPI документирует редирект ответом 3xx с заголовком
  `Location`.
- Отложенная под-тема «типизация ответных заголовков» в `deferred.md`
  переформулируется: `Ok.created(value, headers)` там больше нет.

## Non-goals

- Разбор входящих cookie и подписанные cookie. Заголовок `Cookie`
  читается из `meta.http.headers`; отдельного API в V1 нет.
- Пометка `header()` в bind-карте. Она остаётся отложенной
  ([deferred.md](../../../docs/decisions/deferred.md)).
- Доверие заголовкам прокси в `withClientIp()`. Юнит отдаёт адрес
  сокета; разбор `X-Forwarded-For` пишет приложение.
- Стартовый контекст CLI-транспорта и его юниты. Change трогает только
  HTTP.
- Типизация ответных заголовков схемой `output`.
- Content negotiation, сжатие и любые другие байтовые части.

## Capabilities

### New Capabilities

- `http-handler-form`: HTTP-форма хендлера. `meta.http`, результат
  `HttpOutput`, значение `HttpResponse` с редиректом и cookie, конверт
  транспортного ответа в ядре, допустимость формы только в анонимном
  `httpEndpoint`.
- `transport-pipeline-units`: стартовый контекст транспорта как
  экспортируемый тип и юниты, типизированные им. Правило слота и три
  юнита HTTP-транспорта.

### Modified Capabilities

- `endpoint-declarations`: правило «хендлер не получает полей
  транспорта» заменяется границей. Анонимная форма `httpEndpoint`
  допускает HTTP-хендлер, `implement` и форма с `operation:` — нет.
  Добавляются интерфейсы `Handler<Op>` и `HttpHandler<Op>`.
- `error-values`: `Ok` несёт значение и статус успеха, но не заголовки.
- `http-transport-boundary`: заголовки, cookie и статус редиректа
  берутся из `HttpResponse` хендлера. Запись ответа формы `value`
  остаётся одной операцией.
- `openapi-document`: endpoint, объявивший редирект, документируется
  ответом 3xx с заголовком `Location`.

## Impact

Код:

- `@nestling/operations` — `Ok` (`src/result.ts`), конверт транспортного
  ответа рядом с `Output`.
- `@nestling/app` — `normalizeResponse` и `ResponseContext`
  (`src/pipeline/core/`), типы хендлера (`types/endpoint.ts`),
  `HandlerMeta` и `Handler<Op>`, слот `pipeline` у `implement`.
- `@nestling/transport.http` — стартовый контекст и слоты `httpEndpoint`
  (`src/helpers.ts`), запись ответа (`src/adapter.ts`), сбор
  `HttpRequest` (`src/transport.ts`), новый модуль юнитов, новый модуль
  `HttpResponse`.
- `@nestling/openapi` — план ответов (`src/responses.ts`).
- `@nestling/transport.nats`, `@nestling/transport.cli` — чтение
  `response.headers` убирается.

Документация:

- `docs/design/` — уже описывает целевое состояние; правится только
  сигнатура `httpAccessLog` в `transports.md §1.2`.
- `docs/guide/` — главы 4, 11, 13, 15, 27, приложения А и Б.
- `docs/decisions/deferred.md` и `docs/decisions/ideas.md`.
- README пакетов `transport.http`, `app`, `operations`, `openapi`.

Примеры: `examples/users-service` и `examples/app-with-http` возвращают
`Ok.created(user, { Location })`; обе строки переписываются на
`HttpResponse.of`.
