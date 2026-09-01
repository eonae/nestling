## Why

Проверка входных данных по схеме `input` сегодня зависит от того, как
объявлен endpoint, а не от самой схемы. Endpoint без поля `pipeline`
проверяет данные в `dispatch` (`packages/nestling.transport/src/dispatch.ts`,
функция `executeDirectly`). Endpoint с пайплайном проверяет их только юнитом
`validate()`, и без этого юнита хендлер получает сырой payload
(`packages/nestling.pipeline/src/core/pipeline.ts`, ветка «`payload` в
контексте не найден»). Поля формы `multipart` проверяет HTTP-транспорт при
разборе запроса, поэтому в app-тестах через `app.call` эта проверка не
выполняется. Эксперимент на `makeDispatch` подтвердил: endpoint с
`input: z.object({ n: z.number() })` и пайплайном
`makePipeline().pre(withRequestId())` принимает `{ n: 'not-a-number' }` и
отвечает успехом.

Остальной фреймворк считает проверку безусловной: тип payload в `HandlerFn`
выводится из схемы независимо от пайплайна, генератор OpenAPI добавляет
ответ 400 каждому endpoint'у со схемой входа, порты и клиент проверяют
данные по схемам контракта, проверка ответа по `errors:` выполняется
рантаймом всегда. Для входа такого правила не было: инвариант держался на
дисциплине «не забудь `validate()`», а в примере `app-with-http` — на двух
пайплайнах с комментариями-предупреждениями.

Решение зафиксировано записью
[ideas.md [2026-08-29] «Проверка входа по `input`: обязанность рантайма, точка после `.pre`-юнитов»](../../../docs/decisions/ideas.md):
проверка входа — свойство декларации, одна точка проверки после всех
`.pre`-юнитов, один путь исполнения, юнит `validate()` удаляется. Change
ломающий и идёт после закрытия плана V1
([roadmap](../../../docs/decisions/roadmap.md), волна 6 закрыта
2026-08-01): он правит гарантию, а не добавляет способность. Строку в
roadmap заводит этот же change.

## What Changes

- **Рантайм пайплайна проверяет вход всегда.** Если у endpoint'а есть
  схема `input`, рантайм проверяет данные по ней в одной точке: после всех
  `.pre`-юнитов и перед хендлером. Форма значения проверяется целиком, у
  `multipart` проверяются `fields`, потоковые формы не меняются (элементы
  проверяет `bindInputStream` при чтении). Примитивные листья (`binary`,
  `text`) и отсутствие `input` означают «проверять нечего». Отказ от
  проверки объявляется схемой, которая принимает любое значение
  (`z.unknown()`).
- **Кандидат проверки — ключ `payload` контекста.** Рантайм берёт
  `ctx.input.payload`, если его положил какой-то `.pre`-юнит, иначе
  `ctx.raw.payload`. Ключ остаётся зарезервированным и меняет смысл: не
  «уже проверено», а «проверить это». Так `.pre`-юнит может подменить
  значение для хендлера (например, распаковать конверт JSON-RPC), и
  проверка всё равно выполнится.
- **Отказ проверки — `ValidationFailed` (400) на обычной ответной фазе.**
  Он проходит `.catch`-юниты всех слоёв, проверку `errors:` (kernel-код) и
  `.finally`. Ошибки конфигурации схемы (`AsyncSchemaNotSupportedError`,
  `NotAStandardSchemaError`) остаются ошибками приложения: 500, а не 400.
- **BREAKING: юнит `validate()` удаляется** из публичного API
  `@nestling/pipeline` вместе с файлом и тестами. Тип
  `Pipeline.executeWithHandler` получает `payload: unknown` вместо
  `TAcc extends { payload: infer P } ? P : undefined`; тип `meta`
  по-прежнему без ключа `payload`.
- **BREAKING: один путь исполнения.** `dispatch.call` исполняет endpoint
  без `pipeline` тем же рантаймом с пустым пайплайном; ветка
  `callDirectly`/`executeDirectly` удаляется. На этом пути появляется всё,
  что даёт рантайм: проверка входа с кодом `VALIDATION_FAILED` (раньше —
  брошенная `SchemaValidationError`, которую в 400 превращал
  HTTP-транспорт), проверка ответа по `errors:` (незадекларированный отказ
  становится `UnknownError`/500, раньше уходил клиенту как есть), стартовый
  контекст транспорта в `meta`, нормализация потокового выхода.
- **Новый kernel-отказ `PayloadTooLarge`** (`PAYLOAD_TOO_LARGE`, 413) в
  закрытом наборе кодов ядра. Лимит длины строки потокового входа
  срабатывает во время чтения, то есть уже внутри хендлера; без кода ядра
  единый путь исполнения превращал бы 413 в `UnknownError`/500. Парсер
  NDJSON бросает этот отказ вместо класса `ChunkTooLargeError`, и класс
  удаляется из `@nestling/transport.http`. До change'а 413 держался только
  на прямой ветке исполнения: у endpoint'а с пайплайном тот же лимит уже
  давал 500.
- **Копия проверки `multipart` в HTTP-транспорте удаляется.** Транспорт
  только собирает `{ fields, files }`; поля проверяет рантайм, поэтому
  `app.call` проверяет их так же, как HTTP. Метод `sendError` теряет ветки
  `Fail` и `SchemaValidationError`: после объединения путей они
  недостижимы.
- **Примеры и документация.** `examples.simple-http-server` убирает
  `.pre(validate())`; `examples.app-with-http` сводит
  `basePipeline`/`noValidationPipeline` к одному `basePipeline`. Гайды,
  README пакетов, design-доки и превью описывают правило одной фразой:
  хендлер получает проверенный вход.

## Capabilities

### New Capabilities

- `endpoint-input-validation`: проверка входа по схеме `input` как
  обязанность рантайма — точка проверки, кандидат (`payload` из контекста
  или `raw.payload`), поведение по формам, исход отказа и ошибок
  конфигурации, отсутствие юнита `validate()` в публичном API.

### Modified Capabilities

- `standard-schema-validation`: перечень путей, проходящих через
  `validateSync`, меняется — проверка входа рантаймом пайплайна вместо
  юнита `validate()` и запасных веток транспортов.
- `http-request-validation-errors`: отказ валидации даёт 400 с
  `VALIDATION_FAILED` на одном пути исполнения; поля `multipart`
  проверяются рантаймом, а не транспортом.
- `dispatch-guarantee`: `call` исполняет endpoint одним рантаймом, для
  декларации без `pipeline` — пустым пайплайном; проверка `errors:`
  действует и там.
- `pipeline-phase-model`: в модель исполнения слоя добавляется шаг проверки
  входа между `.pre`-юнитами и хендлером; пример сборки слоя не ссылается
  на `validate()`.
- `request-context-scope`: область контекста запроса открывает одна точка —
  рантайм пайплайна.
- `http-request-cancellation`: endpoint без `pipeline` получает
  `meta.signal` тем же рантаймом, а не прямым вызовом хендлера.
- `domain-fail-definitions`: сценарий «валидация входа остаётся 400» не
  зависит от юнита в пайплайне; в закрытый набор кодов ядра добавляется
  `PAYLOAD_TOO_LARGE`.
- `http-transport-limits`: превышение длины строки потокового входа даёт
  413 у любого endpoint'а, а не только у объявленного без `pipeline`.
- `error-response-safety`: сценарий kernel-отказа описывает проверку входа
  рантаймом.

## Impact

- **`@nestling/pipeline`**: `core/pipeline.ts` (точка проверки в
  `execute()`, тип `executeWithHandler`), новый модуль проверки входа по
  форме в `core/io/`, `core/types/context.ts` (JSDoc ключа `payload`),
  удаление `middlewares/validate.ts` и его теста, рантайм- и type-тесты
  (`pipeline.spec.ts`, `stream.runtime.spec.ts`, `TYPE-TESTS.md`), README.
- **`@nestling/transport`**: `dispatch.ts` — удаление прямой ветки, пустой
  пайплайн, тесты `dispatch.spec.ts`, README.
- **`@nestling/transport.http`**: `transport.ts` — ветка `multipart` без
  `parsePayload`, `sendError` без веток `Fail`/`SchemaValidationError`;
  интеграционные тесты; README.
- **`@nestling/testing`**: тесты, использующие `validate()`; новый сценарий
  «`app.call` проверяет поля `multipart`»; README.
- **`@nestling/contracts`**: `kernel-fails.ts` — определение
  `PayloadTooLarge` и его код в закрытом наборе; реэкспорт из
  `@nestling/pipeline`.
- **`@common/misc`**: README (перечень путей через `validateSync`).
- **Примеры**: `examples.simple-http-server` (два endpoint'а),
  `examples.app-with-http` (`common/pipelines.ts` и импорты в
  endpoint'ах). Гайды `http-functional.md`, `http-app-di.md`,
  `subscriptions.md` — сниппеты и даты плашек.
- **Документация**: `design/pipeline.md` §2, `design/schemas.md` §1,
  `design/errors.md`, `design/endpoints.md` §5 и плашки этих доков;
  `preview/src/index.md`, `preview/src/concepts.md`; блок «РЕАЛИЗОВАНО»
  под записью [2026-08-29] в `ideas.md`; новая строка в `roadmap.md`;
  абзац в `archlog.md` при архивации.
- **Не затронуты**: `@nestling/contracts` (`ValidationFailed`,
  `parsePayload` остаются), `@nestling/ports` (проверка на стороне
  вызывающего), `@nestling/openapi` (ответ 400 у каждого endpoint'а со
  схемой входа теперь совпадает с рантаймом), `@nestling/transport.cli` и
  `@nestling/transport.nats` (исполняют через `dispatch.call`).

## Non-goals

- **Позиция проверки не настраивается.** Опции «проверить раньше» нет, и
  юнит `validate()` в этом качестве не возвращается. Если потребность
  появится, юнит можно добавить аддитивно.
- **Потоковые формы не меняются.** Элементы `stream(T)` и `events(T)`
  проверяются по одному при чтении (`bindInputStream`), опции
  `{ validate, onInvalid }` формы остаются.
- **Флага `validate: false` на декларации нет.** Отказ от проверки — схема,
  принимающая любое значение.
- **Доступ `.pre`-юнитов к проверенному payload** не добавляется: проверки
  по полям запроса живут в хендлере. Открытый вопрос записи журнала
  остаётся открытым.
- **Раскладка полей по частям HTTP-запроса** (bind-карта, `assemblePayload`)
  не меняется: транспорт по-прежнему собирает payload, рантайм его
  проверяет.
- **Двойная проверка на пути «порт, шина, реализация»** не
  дедуплицируется: вызывающая сторона проверяет вход по схеме контракта,
  реализация — по своей декларации, как и сегодня.
- **Пайплайн по умолчанию в декларации** не появляется: `makeEndpoint` не
  подставляет пустой пайплайн, политики `hasLayer`/`hasVar` по-прежнему
  считают endpoint без `pipeline` нарушением. Пустой пайплайн — деталь
  `dispatch`.
- **Фильтр по форме входа в `EndpointFilter`** — отдельная тема.
