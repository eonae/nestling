# guide-review-1

## Why

Первое ревью гайда (главы 1–5) показало три места, где API объясняется
хуже, чем мог бы, потому что сам API устроен неудобно. Словарь сборки не
является значением фреймворка и смешивает состав приложения с выбором фич
процесса. У отказа две оси, `status` и `code`, связь которых держится
соглашением. Зависимости хендлера лежат на декларации, а отказ можно
вернуть тремя способами без названного канона. Решения зафиксированы в
`docs/decisions/ideas.md` записями от 2026-09-03: «Декларация приложения:
`makeApp`, `assemble(select)`, `AssembledApp`», «Код отказа: категория и
уточнение; `makeFail`», «Поле `handler`: зависимости принадлежат хендлеру;
канон `return`; `Output<T, typeof Def>`», «Заголовки `Ok` не зависят от
транспорта». Гайд переписывается под новый API тем же change'ем, а превью
документации собирается из гайда: на выходе гайд в HTML.

## What Changes

- **BREAKING** Composition root: `assemble(spec)` заменяется парой
  `makeApp(spec)` → `app.assemble(select?)` → `AssembledApp` с `run()` и
  `close()`. `check(select?, options?)` живёт на декларации. Поле `select`
  уходит из словаря. `assembleTest(app, options)` и `checkTopologies(app, …)`
  принимают декларацию. Тип `App` — декларация; собранное приложение —
  `AssembledApp`.
- **BREAKING** Модель ошибок: `defineFail` → `makeFail(code, { details?,
  message? })`. Код составной, `category[:detail…]`, сегменты `[a-z_]+`,
  категория из закрытого перечня. Поля `status` у `Fail` нет, есть
  производное `category`. Статусы успеха и категории в нижнем регистре.
  Отказы ядра несут голую категорию: `BadRequest`, `PayloadTooLarge`,
  `Timeout`, `InternalError`; определения `ValidationFailed`,
  `StreamLimitExceeded`, `StreamGapTimeout`, `DeadlineExceeded`,
  `UnknownError` удалены. Закрытое множество ответа — `E ∪ InternalError`.
- **BREAKING** Хендлер: поля `deps` и `handle` декларации заменяются одним
  полем `handler` с тремя формами (функция, `{ deps, handle }`, класс).
  Endpoint сам создаёт класс-хендлер; повторная регистрация в
  `providers:` — ошибка сборки. `meta.fail` удалён. `Output<T, E>`
  принимает определения (`typeof Def`), `FailOf` уходит из публичного API.
- Заголовки `Ok` — метаданные ответа, не зависящие от транспорта: HTTP
  пишет их в заголовки ответа, NATS — в заголовки ответного сообщения, CLI
  отбрасывает.
- Гайд: главы 1–5 переписаны по ревью. Новая глава «Хендлер как класс»
  перед DI, нумерация глав 5–24 сдвигается на единицу. Health-проба уходит
  в плагин `ops`; глава 1 начинается с `GET /users`. Глава DI строится
  «токен → интерфейс → `providers` → зависимости зависимостей →
  значения-провайдеры и функция с `deps`». Примеры `query()` и `body()`,
  `.describe()` у полей конфига. Правила именования — `docs/conventions.md`.
  Все хендлеры примера `users-service` — классы.
- Превью `docs/preview` собирается из `docs/guide/*.md`: страница на
  главу, навигация из частей гайда. Старые `preview/src/*.md` уходят в
  `history/superseded`.
- Примеры `examples.*`, README пакетов, `design/`, глоссарий и спеки
  мигрированы.

## Non-goals

- Форма `httpEndpoint.get(path, …)` и пересмотр политик сборки:
  отложены ([deferred.md](../../../docs/decisions/deferred.md), записи
  2026-09-03).
- Пометка `header()`, wire-формат RFC 9457, описание полей конфига как
  слот фреймворка: в примерах используется `.describe()` zod, фреймворк
  его не читает.
- Переименование `detached` и `doc.hidden`.
- Изменение семантики политик, `select`, discovery, item-цепочек и
  OpenAPI сверх переименований.

## Capabilities

### New Capabilities
- `docs-preview-guide`: статическое HTML-превью документации собирается
  из глав гайда `docs/guide`: страница на главу, навигация по частям,
  переписанные ссылки между главами.

### Modified Capabilities
- `composition-root`: `makeApp` + `assemble(select)` + `AssembledApp`;
  `select` не поле словаря; `check` на декларации.
- `structural-check`: `check(select?, options?)` — метод декларации;
  `checkTopologies(app, …)`.
- `test-composition-root`: `assembleTest(app, options)`; политики из
  декларации; `config` теста заменяет привязку декларации.
- `assembly-policies`: политики объявляются в `makeApp`; сценарии
  тестового корня.
- `lifecycle-phases`: `select` передаётся в `app.assemble(select)`.
- `config-sources-binding`: привязка объявляется в `makeApp`.
- `domain-fail-definitions`: `makeFail`, формат кода, отказы ядра голой
  категорией.
- `error-values`: канон `return`; `Output<T, typeof Def>`; категория
  вместо словаря статусов; `code` обязателен; статусы в нижнем регистре.
- `endpoint-error-contract`: `meta.fail` удалён; нормализация в
  `InternalError`; call-site порта.
- `endpoint-handler-di`: поле `handler`; endpoint создаёт класс-хендлер
  сам.
- `endpoint-declarations`: словарь с `handler`; `makeFail` в проверках
  `errors:`.
- `contract-implementations`: `implement(Operation, { pipeline?, handler,
  … })`.
- `endpoint-input-validation`: отказ проверки входа — `BadRequest`
  (`bad_request`).
- `http-request-validation-errors`: код `bad_request`.
- `http-transport-limits`, `stream-item-chains`, `port-deadline`: коды
  ядра — категории.
- `openapi-document`: ответы группируются по категории; `default` —
  `InternalError`; `doc.status` в нижнем регистре.
- `typed-http-client`: `E ∪ InternalError`; категория выводится из кода.
- `declaration-doc-metadata`: `doc.status` в нижнем регистре.

## Impact

- Пакеты: `@nestling/app` (`makeApp`, `App`, `AssembledApp`, `check`),
  `@nestling/testing` (`assembleTest`, `checkTopologies`),
  `@nestling/operations` (`makeFail`, `Fail`, статусы, `Ok`),
  `@nestling/pipeline` (`Output`, формы `handler`, `meta`, проверка границы,
  отказы ядра), `@nestling/transport.http` (карта категорий, заголовки
  `Ok`), `@nestling/transport.nats` (заголовки ответа),
  `@nestling/transport.cli`, `@nestling/ports` (`Timeout` вместо
  `DeadlineExceeded`), `@nestling/openapi` (группировка по категории),
  `@nestling/client` (восстановление `Fail` из ответа), `@nestling/streams` (отказы
  лимита и таймаута), `@nestling/eslint-plugin` (правила, читающие
  `handle:`/`deps`), `@nestling/subscriptions`.
- Примеры: `examples.users-service` (переработка под гайд),
  `examples.app-with-http`, `examples.split-nats`, `examples.simple-cli`,
  `examples.simple-http-server`, `examples.container`.
- Документация: `docs/guide/*` (главы 1–25, приложения, README),
  `docs/preview` и `scripts/preview/build.mjs`, `docs/design/*`,
  `docs/glossary.md`, `docs/conventions.md`, README пакетов.
- Спеки: 20 дельта-спек плюс механическая замена старых имён в спеках с
  побочными упоминаниями (список в `tasks.md`).
