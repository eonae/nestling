## Context

Проверка входа сегодня живёт в трёх местах, и ни одно из них не гарантирует
её для каждого endpoint'а.

| Где | Что делает | Пробел |
|---|---|---|
| `packages/nestling.transport/src/dispatch.ts`, `executeDirectly` | endpoint без `pipeline`: `parsePayload` по листу формы значения, вызов хендлера с `meta = { signal, fail }` | бросает `SchemaValidationError` и `Fail` наружу; проверки `errors:` нет, незадекларированный отказ уходит клиенту как есть; потоковый выход не нормализуется |
| `packages/nestling.pipeline/src/middlewares/validate.ts` | `.pre`-юнит: `validateSync(leaf, raw.payload)`, результат в `{ payload }`; отказ — `ValidationFailed` | выполняется, только если автор положил юнит |
| `packages/nestling.transport.http/src/transport.ts`, ветка `multipart` | `parsePayload(inputForm.fields, …)` при разборе запроса | не выполняется на `app.call`; отказ идёт через `sendError`, минуя `.catch` и `.finally` |

Рантайм пайплайна (`PipelineImpl.execute()`) после цикла `.pre`-юнитов
берёт `'payload' in finalInput ? payload : ctx.raw.payload` и вызывает
хендлер. Точки проверки в нём нет.

Ограничения, в которые обязано уложиться решение:

- `validateSync` из `@common/misc` — единственная реализация проверки
  (`standard-schema-validation`); форма отказа одна на всех путях.
- `VALIDATION_FAILED` — kernel-код: проверка `errors:` пропускает его без
  объявления (`domain-fail-definitions`).
- Модель слоёв: слой включается первым своим `.pre`-юнитом, и только
  включённый слой получает `.catch` и `.finally` (`pipeline-phase-model`).
  Точка проверки должна стоять там, где все слои уже включены.
- Область контекста запроса открывает рантайм (`request-context-scope`);
  `Ctx`-ридеры читают проекцию `input` после каждого `.pre`-юнита.
- Схема непрозрачна в рантайме (`design/schemas.md`): о форме говорит только
  `describeForm`, о содержимом — только `~standard.validate`.
- Публичный API V1 зафиксирован; удаление `validate()` — ломающее
  изменение, принятое записью журнала. Остальное аддитивно или внутренне.

## Goals / Non-Goals

**Goals:**

- Хендлер любого endpoint'а со схемой `input` получает проверенное
  значение, независимо от наличия и состава пайплайна.
- Одна точка проверки в коде и один путь исполнения endpoint'а во всех
  транспортах и в `app.call`.
- Отказ проверки — обычный отказ ответной фазы: его видят `.catch` и
  `.finally`, хук `onUnknownFail` не вызывается.
- Публичная поверхность уменьшается на один юнит; новых опций не
  появляется.

**Non-Goals:**

- Настраиваемая позиция проверки, изменения потоковых форм, флаг на
  декларации, доступ `.pre`-юнитов к проверенному payload, дедупликация
  проверки «порт и реализация» — см. Non-goals proposal'а.

## Decisions

### 1. Точка проверки — в `PipelineImpl.execute()`, между циклом `.pre` и хендлером

Проверка выполняется внутри существующего `try` сразу после цикла по слоям
и до `setPhase(cell, 'handler')`. Брошенный `ValidationFailed` попадает в
тот же `catch`, что и отказ `.pre`-юнита: `errorToResponse` даёт
`BAD_REQUEST` с `code: 'VALIDATION_FAILED'` и `details: issues`, дальше
выполняются `.catch`-юниты всех слоёв (к этому моменту включены все),
`enforceContract` пропускает kernel-код, `.finally` видит ответ 400.

Отвергнуто:

- **Проверка в `dispatch` перед `executeWithHandler`.** Ошибка 400 не
  попала бы ни в один `.catch` и `.finally`, а `withRequestId()` не успел
  бы отработать. Это тот же дефект, что у сегодняшней ветки без пайплайна.
- **Проверка перед первым `.pre`-юнитом.** Те же наблюдатели не увидели бы
  ошибку, а авторизация выполнялась бы после разбора данных. Аргументы — в
  записи журнала.
- **Проверка как неявно добавленный последний `.pre`-юнит.** Юнит
  дополняет контекст, а проверка его не дополняет: результат уходит
  хендлеру аргументом `payload`, в `ctx.input` он не попадает. Иначе
  `Ctx`-проекция и `hasVar` увидели бы поле, которого не объявлял ни один
  слой (`context-propagation`: значение не попадает в `input` мимо юнита).

### 2. Проверка по форме — чистая функция `validateInput(form, candidate)`

Новый внутренний модуль
`packages/nestling.pipeline/src/core/io/validate-input.ts` рядом с
`bind-stream.ts`:

```typescript
export function validateInput(form: FormDescriptor, candidate: unknown): unknown
```

| Форма | Поведение |
|---|---|
| `value`, лист-схема | `validateSync(leaf, candidate, 'Validation failed')`, результат — выход схемы |
| `value`, лист `binary`/`text` или без `input` | `candidate` как есть |
| `multipart` | `{ fields: fields ? validateSync(fields, candidate.fields) : candidate.fields, files: candidate.files }` |
| `stream`, `events` | `candidate` как есть: элементы проверяет обёртка `bindInputStream`, которую транспорт уже наложил на `raw.payload` |

`SchemaValidationError` превращается в `ValidationFailed(issues, { cause })`.
`AsyncSchemaNotSupportedError` и `NotAStandardSchemaError` пробрасываются
как есть: это ошибки конфигурации приложения, `errorToResponse` даст
`INTERNAL_ERROR`, `enforceContract` — `UnknownError` с вызовом
`onUnknownFail`. Это то же поведение, что было у юнита `validate()`, и оно
теперь одинаково для endpoint'ов с пайплайном и без.

Кандидат для `multipart`, не являющийся объектом, даёт
`validateSync(fields, undefined)` — обычный отказ 400 с issues, без
отдельной ветки.

Модуль не экспортируется из `index.ts`: у него нет потребителей вне
рантайма, тесты импортируют его относительным путём.

### 3. Кандидат — `ctx.input.payload`, если он есть, иначе `ctx.raw.payload`

Правило существующего кода
(`'payload' in finalInput ? payload : ctx.raw.payload`) сохраняется.
Меняется только то, что происходит дальше: значение проверяется, а не
передаётся хендлеру напрямую. Ключ `payload` остаётся зарезервированным: в
`meta` хендлера он не попадает (`Omit<TAcc, 'payload'>` в типах и
деструктуризация в рантайме — без изменений). Проверенное значение в
`ctx.input` и в ячейку контекста запроса не пишется.

JSDoc `ExtendableContext` и README описывают ключ так: «`.pre`-юнит может
положить в контекст `payload` — значение, которое рантайм проверит по
схеме `input` вместо `raw.payload`».

Отвергнуто: **проверять всегда `raw.payload`.** Тогда распаковка конверта
(JSON-RPC, тело внутри подписанного конверта вебхука) потребовала бы
второго механизма подмены.

### 4. Пустой пайплайн подставляет `dispatch`

```typescript
const emptyPipeline = makePipeline();
// в call:
const pipeline = (definition.pipeline ?? emptyPipeline) as Pipeline<AnyInput, AnyInput, never>;
return await pipeline.executeWithHandler(definition.handle, ctx, options);
```

`emptyPipeline` — константа уровня модуля; `callDirectly`,
`executeDirectly` и импорты `parsePayload`, `describeForm`, `isFail`,
`Ok`, `runInRequestScope` из `dispatch.ts` удаляются. Пустой слой в
рантайме: включается без юнитов, хендлер вызывается с
`meta = { ...ctx.input, signal, fail }`, ответных юнитов нет,
`enforceContract` и область контекста работают как у любого пайплайна.

Наблюдаемые изменения для endpoint'а без `pipeline`:

- отказ проверки — `ValidationFailed` в `ResponseContext` (был бросок
  `SchemaValidationError`, который HTTP-транспорт переводил в тот же ответ
  400 с тем же кодом; для прямого `dispatch.call` и для `app.call` бросок
  становится ответом);
- незадекларированный отказ — `UnknownError`/500 с вызовом
  `onUnknownFail` (раньше уходил клиенту со своим статусом и кодом);
- стартовый контекст транспорта (`rawBody`, `lastEventId`) попадает в
  `meta` (раньше — только `signal` и `fail`);
- `Ok` с заголовками и потоковый выход нормализуются рантаймом
  (`executeDirectly` не оборачивал потоковый ответ в `bindOutputStream`).

Отвергнуто: **пустой пайплайн по умолчанию в `makeEndpoint`.** Это
изменило бы форму декларации (`pipeline` стал бы обязательным полем),
диагностику политик «нет пайплайна» и снимок discovery. Единственная точка
исполнения — `dispatch`, ей и подставлять.

### 5. HTTP-транспорт: `multipart` без проверки, `sendError` без веток исполнения

Ветка `case 'multipart'` собирает
`payload = { fields: assemblePayload(...), files: multipart.files }` и
больше не вызывает `parsePayload`. Раскладка path-параметров и
`query()`-полей в `fields` остаётся: это bind-карта, обязанность
транспорта.

`sendError` оставляет только ошибки разбора и роутинга: `JsonParseError`,
`MultipartFieldError` (400), `PayloadTooLargeError`, `ChunkTooLargeError`
(413), остальное — 500 с деталями по `exposeErrorDetails`. Ветки
`isFail(error)` и `SchemaValidationError` удаляются: после объединения
путей `dispatch.call` возвращает `ResponseContext` для любого исхода
хендлера и проверки, наружу выходят только ошибки конфигурации диспетчера
(неизвестный паттерн, нерезолвенный класс-юнит). JSDoc метода перестаёт
упоминать ветку без пайплайна.

Файловые потоки при ответе 400 от рантайма: транспорт уже вызывает
`drainFileStreams(multipart)` после `send(responseContext)`. Это тот же
случай, что хендлер, ответивший отказом до чтения файла. Закрепляется
интеграционным тестом.

`SchemaValidationError` остаётся в экспорте `@nestling/pipeline` для
других потребителей (конфиг, клиент); из `transport.ts` импорт уходит.

### 6. Типы: `executeWithHandler` получает `payload: unknown`

`Pipeline.executeWithHandler` типизирует `payload` как `unknown`: пайплайн
не знает схему endpoint'а, а проверенное значение имеет тип выхода схемы,
известный только `HandlerFn` (`InferInput<I>`, без изменений). Прежний тип
`TAcc extends { payload: infer P } ? P : undefined` обещал `undefined` там,
где в рантайме приходил сырой payload. Единственный потребитель
сигнатуры — `dispatch`, где хендлер уже приведён к
`(payload: unknown, meta) => unknown`.

Тип `meta` (`Omit<TAcc, 'payload'>` при наличии ключа) не меняется.
Type-тесты на «`payload` не попадает в мету» переписываются с
пользовательским `.pre`-юнитом, возвращающим `{ payload }`, вместо
`validate()`.

### 7. Тесты — доказательство

Рантайм пайплайна, новый файл `core/input-validation.spec.ts` рядом с
`stream.runtime.spec.ts`:

- endpoint со схемой и пайплайном без юнитов проверки отвергает невалидный
  payload: 400, `VALIDATION_FAILED`, `details` с `path` — регрессия
  эксперимента из записи журнала;
- пустой пайплайн `makePipeline()` проверяет так же;
- валидный payload приходит хендлеру выходом схемы (трансформация
  применена);
- `.pre`-юнит, положивший `payload`, определяет кандидата: проверяется он,
  а не `raw.payload`; в `meta` ключа нет;
- отказ `.pre`-юнита (`UNAUTHORIZED`) до проверки: ответ 401, схема не
  вызывалась;
- `.catch` и `.finally` двух слоёв видят ответ 400, `onUnknownFail` не
  вызван;
- без `input` и с листом `binary`/`text`: хендлер получает кандидата как
  есть;
- `z.unknown()` пропускает любое значение;
- `multipart`: `fields` проверены (трансформация применена), `files` — та
  же ссылка; без схемы `fields` — как есть; кандидат не объект — 400;
- потоковая форма: кандидат как есть (перенос теста «`validate()` не
  трогает потоковые формы» из `stream.runtime.spec.ts`);
- async-схема и объект-не-схема: 500 `UNKNOWN`, не `Fail`, хук получил
  исходную ошибку (перенос из `validate.spec.ts`).

`dispatch.spec.ts`: невалидный вход без пайплайна — `ResponseContext` 400
с `VALIDATION_FAILED` (был `rejects.toThrow`); незадекларированный отказ
без пайплайна — `UNKNOWN` и вызов хука; стартовый `input` попадает в
`meta`; тест области контекста остаётся.

HTTP, `transport.integration.spec.ts`: убрать `.pre(validate())` из
деклараций; `/json` и `/fallback` — 400 с кодом на обоих путях;
`multipart` с невалидными `fields` и файлом — 400, ответ получен,
соединение закрыто штатно; async-схема без пайплайна — 500.

`@nestling/testing`, `assemble-test.spec.ts`: `app.call` endpoint'а с
`multipart` и невалидными `fields` — `VALIDATION_FAILED`, хендлер не
вызван.

Type-тесты: `pipeline.spec.ts` (три места с `validate()`),
`TYPE-TESTS.md`. Отсутствие экспорта `validate` проверяет `yarn build`,
отдельный `@ts-expect-error` не нужен.

### 8. Лимит потокового входа: kernel-отказ `PayloadTooLarge`

Найдено при исполнении change'а. Лимит длины строки NDJSON срабатывает
лениво, во время итерации потока внутри хендлера. На прямой ветке
исполнения ошибка всплывала мимо рантайма, и `sendError` отвечал 413. У
endpoint'а с пайплайном та же ошибка уже сегодня становится 500: рантайм
считает не-`Fail` внутренней ошибкой. Спека `http-transport-limits`
требует 413 без оговорок про пайплайн, то есть до change'а требование
выполнялось только для части endpoint'ов.

Единый путь исполнения выравнивает поведение, и выравнивать его нужно в
сторону 413. Для этого набор кодов ядра пополняется определением
`PayloadTooLarge` (`PAYLOAD_TOO_LARGE`, статус `PAYLOAD_TOO_LARGE`,
детали `{ limit }`), и `parseNdjson` бросает его вместо класса
`ChunkTooLargeError`. Класс удаляется: больше его никто не бросает.
Буферизуемое тело и файлы `multipart` проверяются до вызова `dispatch`,
поэтому `PayloadTooLargeError` и его ветка в `sendError` остаются.

Отвергнуто:

- **Переиспользовать `StreamLimitExceeded`.** Статус тот же, но код
  ответа означал бы «слишком много элементов», тогда как причина —
  длина одной строки.
- **Принять 500 и ослабить спеку.** Клиент перестал бы отличать
  превышение лимита от внутренней ошибки сервера.

### 9. Примеры и документация

`examples.app-with-http/src/common/pipelines.ts`: слой `validation` и
экспорт `noValidationPipeline` удаляются, `basePipeline` становится слоем
`observability` (одна строка), `auditDeletions` остаётся. Шесть
endpoint'ов меняют импорт `noValidationPipeline` на `basePipeline`;
политика `hasLayer(observability)` в корне продолжает выполняться, потому
что `basePipeline` — тот же слой. `examples.simple-http-server`:
`create-user` и `search-users` получают `makePipeline().pre(withTiming)`,
комментарий «input типизирован после validate()» удаляется.

Документация — по правилам CLAUDE.md. «Что» в `design/`: `pipeline.md` §2
(абзац о шаге проверки), `schemas.md` §1 (перечень путей через
`validateSync`), `errors.md` (источник `VALIDATION_FAILED`),
`endpoints.md` §5 (кто и когда проверяет `fields`); плашки этих доков
получают ссылку на запись [2026-08-29]. README `@nestling/pipeline` —
раздел «Проверка входа» вместо строки `validate()` в таблице юнитов; README
`@nestling/transport`, `@nestling/transport.http`, `@nestling/testing`,
`@common/misc` — по одному абзацу. Гайды `http-functional.md`,
`http-app-di.md`, `subscriptions.md` — сниппеты и даты плашек.
`preview/src/index.md`, `concepts.md` и пересборка `yarn docs:preview`.
Блок «РЕАЛИЗОВАНО» под записью журнала и новая строка в `roadmap.md`:
волны 1–6 закрыты, поэтому change'у нужен раздел «После волны 6» рядом с
таблицей changes.

## Risks / Trade-offs

- [Endpoint без `pipeline`, бросающий незадекларированный `Fail`, начнёт
  отвечать 500 `UNKNOWN`] → ломающее изменение названо в proposal;
  миграция — объявить отказ в `errors:`. В примерах репозитория endpoint'ов
  без пайплайна нет; первая задача проверяет это grep'ом.
- [Endpoint с пайплайном без `validate()` и схемой `input`, полагавшийся
  на сырой payload, начнёт отвечать 400] → миграция — `z.unknown()`. В
  примерах такие endpoint'ы (`noValidationPipeline`) имеют потоковый,
  `multipart` или пустой вход, их поведение не меняется.
- [Ответ 400 от рантайма при `multipart` оставит непрочитанные файловые
  потоки] → дренаж после `send` уже есть; интеграционный тест закрепляет.
- [`describeForm` на каждом запросе в рантайме] → тот же вызов выполнял
  юнит `validate()` и выполняет `normalizeResponse` для выхода;
  классификатор без аллокаций.
- [Набор kernel-кодов растёт на один] → аддитивно: `PAYLOAD_TOO_LARGE`
  входит в контракт каждого endpoint'а без объявления, как и соседние
  коды. Публичного способа пополнить набор по-прежнему нет.
- [Тип `executeWithHandler` меняется] → потребитель один (`dispatch`);
  публичный `HandlerFn` не меняется.
- [`.pre`-юнит кладёт `payload` для потоковой формы] → рантайм передаёт
  кандидата как есть, элементы повторно не проверяются; README описывает
  это как поведение потоковых форм.
- [Спеки `cli-request-cancellation` и `policy-predicates` упоминают
  «fallback без pipeline» словами] → их требования остаются верными:
  декларация без `pipeline` по-прежнему существует, меняется только способ
  её исполнения. Дельты не нужны.

## Migration Plan

1. Удалить `.pre(validate())` из пайплайнов; импорт `validate` из
   `@nestling/pipeline` перестаёт компилироваться.
2. Endpoint со схемой `input`, которому проверка не нужна, получает схему,
   принимающую любое значение (`z.unknown()`).
3. Endpoint без `pipeline`, бросающий или возвращающий отказ, объявляет его
   в `errors:`.
4. Код, вызывавший `dispatch.call` напрямую и ловивший бросок
   `SchemaValidationError`, читает `ResponseContext` с
   `code: 'VALIDATION_FAILED'`.

Отката по частям нет: change ломающий по замыслу и живёт целиком в ветке
`change/input-validation-builtin`.

## Open Questions

- Доступ `.pre`-юнитов к проверенному payload (проверка прав по полям
  запроса). В V1 нет; вернуться, если появится случай, который не
  укладывается в хендлер. Зафиксировано в записи журнала.
