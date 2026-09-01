## 1. Ядро пайплайна: проверка входа

- [x] 1.1 Модуль `packages/nestling.pipeline/src/core/io/validate-input.ts`: `validateInput(form, candidate)` по таблице форм из design §2; `SchemaValidationError` превращается в `ValidationFailed(issues, { cause })`, ошибки конфигурации схемы (`AsyncSchemaNotSupportedError`, `NotAStandardSchemaError`) пробрасываются; из `index.ts` не экспортируется
- [x] 1.2 Точка проверки в `PipelineImpl.execute()` (`core/pipeline.ts`): после цикла `.pre`-юнитов и до `setPhase(cell, 'handler')`, внутри `try`; кандидат — `'payload' in finalInput ? finalInput.payload : ctx.raw.payload`; результат уходит хендлеру аргументом `payload`, в `ctx.input` и ячейку контекста не пишется; комментарий «без `validate()` хендлер получает сырой payload» удаляется
- [x] 1.3 Рантайм-тесты `core/input-validation.spec.ts` по перечню design §7: невалидный вход с пайплайном без юнитов проверки и с пустым `makePipeline()`; выход схемы с трансформацией; подмена кандидата `.pre`-юнитом и отсутствие `payload` в `meta`; отказ `.pre` раньше проверки (схема не вызвана); `.catch`/`.finally` двух слоёв видят 400, `onUnknownFail` не вызван; без `input` и с листом `binary`/`text`; `z.unknown()`; `multipart` (fields проверены, files та же ссылка, без схемы fields как есть, кандидат не объект даёт 400); потоковый вход как есть; async-схема и объект-не-схема дают `UNKNOWN`/500 с оригиналом в хуке
- [x] 1.4 Перенести сценарий «потоковый input проходит без изменений» из `core/stream.runtime.spec.ts` (describe `validate() не трогает…`) в новый файл; убрать импорт `validate` из `stream.runtime.spec.ts`

## 2. Удаление `validate()` и типы

- [x] 2.1 Удалить `middlewares/validate.ts`, `middlewares/validate.spec.ts` и строку экспорта в `middlewares/index.ts`
- [x] 2.2 `Pipeline.executeWithHandler` (`core/pipeline.ts`): аргумент `payload: unknown`; JSDoc метода перечисляет проверку входа среди шагов
- [x] 2.3 JSDoc `ExtendableContext` (`core/types/context.ts`): контекст до проверки входа, ключ `payload` — кандидат проверки; JSDoc `HandlerFn` (`core/types/endpoint.ts`): «данные, проверенные рантаймом по схеме `input`»
- [x] 2.4 Type-тесты `core/pipeline.spec.ts` (три места с `validate()`): пользовательский `.pre`-юнит, возвращающий `{ payload: unknown }`; проверить, что `'payload'` не входит в ключи `meta`, а `payload` типизирован `unknown`; обновить `core/TYPE-TESTS.md`
- [x] 2.5 Комментарии и JSDoc, упоминающие `validate()`: `middlewares/identity.ts`, `meta.ts`, `permissions.ts`, `logging.ts`, `schema/parse.ts`, `schema/index.ts`, `core/io/bind-stream.ts` — переписать по факту

## 3. Единый путь исполнения: `dispatch`

- [x] 3.1 `packages/nestling.transport/src/dispatch.ts`: константа `emptyPipeline = makePipeline()`; `call` исполняет `definition.pipeline ?? emptyPipeline` через `executeWithHandler`; удалить `callDirectly`, `executeDirectly` и неиспользуемые импорты (`parsePayload`, `describeForm`, `isFail`, `Ok`, `runInRequestScope`, `Schema`); JSDoc `Dispatch.call` без «ветки с pipeline / без pipeline»
- [x] 3.2 `dispatch.spec.ts`: невалидный вход без пайплайна даёт `ResponseContext` 400 с `VALIDATION_FAILED` (вместо `rejects.toThrow`); незадекларированный отказ без пайплайна даёт `UNKNOWN`/500 и вызов `onUnknownFail`; стартовый `input` контекста попадает в `meta`; тест области контекста запроса остаётся зелёным
- [x] 3.3 Проверить grep'ом, что `@nestling/transport.cli`, `@nestling/transport.nats`, `@nestling/testing` (`app.call`) и `@nestling/ports` не содержат собственной проверки payload endpoint'а и упоминаний прямой ветки; поправить комментарии там, где они есть

## 4. HTTP-транспорт

- [x] 4.1 `packages/nestling.transport.http/src/transport.ts`, ветка `case 'multipart'`: `payload = { fields: assemblePayload(...), files: multipart.files }` без `parsePayload`; убрать ставшие лишними импорты (`parsePayload`, `SchemaValidationError`, `isFail`, `Schema`)
- [x] 4.2 `sendError`: удалить ветки `isFail(error)` и `SchemaValidationError`; JSDoc — только ошибки разбора и роутинга (`JsonParseError`, `MultipartFieldError` — 400; `PayloadTooLargeError`, `ChunkTooLargeError` — 413; остальное — 500)
- [x] 4.3 `transport.integration.spec.ts`: убрать `.pre(validate())` из деклараций и комментарий «валидация в транспорте»; тесты `/json` и `/fallback` — 400 с кодом на обоих путях; новый тест: `multipart` с невалидными `fields` и файлом даёт 400, ответ получен, соединение закрыто штатно; новый тест: async-схема у endpoint'а без пайплайна даёт 500; тест «fallback-endpoint получает `meta.signal`» остаётся зелёным

## 4a. Лимит потокового входа: kernel-отказ `PayloadTooLarge`

- [x] 4a.1 `PayloadTooLarge` в `packages/nestling.contracts/src/kernel-fails.ts` (код и статус `PAYLOAD_TOO_LARGE`, детали `{ limit }`) и его код в закрытом наборе `KERNEL_FAIL_CODES`; реэкспорт из `@nestling/pipeline` (`core/index.ts`)
- [x] 4a.2 `parseNdjson` (`packages/nestling.transport.http/src/parser.ts`) бросает `PayloadTooLarge({ limit })` вместо `ChunkTooLargeError`; класс удалён из `errors.ts`, его ветка — из `sendError`
- [x] 4a.3 Тест симметрии в `transport.integration.spec.ts`: строка длиннее лимита даёт 413 с кодом `PAYLOAD_TOO_LARGE` у endpoint'а с пайплайном и без него
- [x] 4a.4 README `@nestling/pipeline` и `@nestling/transport.http`: `PAYLOAD_TOO_LARGE` в перечне встроенных кодов и в таблице ошибок входа

## 5. `@nestling/testing`

- [x] 5.1 `assemble-test.spec.ts`, `emit.spec.ts`: убрать `validate()` из пайплайнов; новый сценарий в `assemble-test.spec.ts`: `app.call` endpoint'а с `multipart` и невалидными `fields` даёт `VALIDATION_FAILED`, хендлер не вызван
- [x] 5.2 README пакета: абзац о том, что `app.call` проверяет вход по схеме `input` так же, как транспорт, включая поля `multipart`

## 6. Примеры

- [x] 6.1 `examples.simple-http-server`: `create-user.endpoint.ts`, `search-users.endpoint.ts` — `makePipeline().pre(withTiming)`, без импорта `validate` и без комментария о типизации после юнита
- [x] 6.2 `examples.app-with-http/src/common/pipelines.ts`: удалить слой `validation` и экспорт `noValidationPipeline`; `basePipeline` — слой `observability`; JSDoc по факту
- [x] 6.3 Endpoint'ы `list-users`, `import-users`, `export-users`, `activity-stream`, `upload-avatar` и `ops/subscriptions` (`WatchSubscriptions`) — импорт и использование `basePipeline`
- [x] 6.4 grep по `packages/examples.*` на `validate(` и на декларации без `pipeline`; e2e-тесты примеров зелёные

## 7. Документация

- [x] 7.1 `docs/design/pipeline.md` §2: абзац о шаге проверки входа (точка, кандидат `payload`, формы, исход 400 и ошибки конфигурации); плашка — ссылка на запись [2026-08-29]
- [x] 7.2 `docs/design/schemas.md` §1 «Единая точка валидации»: перечень путей через `validateSync` без юнита и без запасных веток транспортов; плашка
- [x] 7.3 `docs/design/errors.md`: источник `VALIDATION_FAILED` — проверка входа рантаймом; плашка
- [x] 7.4 `docs/design/endpoints.md` §5: `fields` у `multipart` проверяет рантайм перед хендлером, файлы ограничивает транспорт при разборе; плашка
- [x] 7.5 README `@nestling/pipeline`: раздел «Проверка входа» (правило, кандидат `payload`, поведение по формам, отказ 400, `z.unknown()`); удалить строку `validate()` из таблицы «Готовые юниты»; поправить разделы «Схемы» и «Встроенные коды»
- [x] 7.6 README `@nestling/transport` (описание `call` и абзац про область контекста), `@nestling/transport.http` (multipart, ошибки валидации), `@common/misc` (перечень путей через `validateSync`)
- [x] 7.7 Гайды: `http-functional.md` (раздел «Endpoint с валидацией», комментарий подключения `withTiming`), `http-app-di.md` и `subscriptions.md` (`basePipeline` вместо `noValidationPipeline`); даты плашек «сверено с кодом» после фактической сверки сниппетов
- [x] 7.8 `docs/preview/src/index.md`, `docs/preview/src/concepts.md` — сниппеты и текст без `validate()`; пересобрать `yarn docs:preview`
- [x] 7.9 `docs/decisions/ideas.md`: блок «РЕАЛИЗОВАНО» под записью [2026-08-29] — фактические имена (`validateInput`, `emptyPipeline`), наблюдаемые изменения пути без пайплайна, тип `executeWithHandler`
- [x] 7.10 `docs/decisions/roadmap.md`: новая строка change'а в таблице и раздел «После волны 6» с его статусом — волны 1–6 закрыты, отдельной строки для него в плане не было
- [x] 7.11 `node .claude/skills/docs-style/scripts/lint.mjs` по затронутым файлам — 0 запрещённых слов

## 8. Definition of Done

- [x] 8.1 Все задачи выше отмечены
- [x] 8.2 `yarn verify` зелёный (build + lint + test по всем пакетам)
- [x] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 8.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [x] 8.5 `yarn docs:audit` — 0 ERROR
- [x] 8.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены с обновлённой датой в плашке «сверено с кодом»
- [x] 8.7 Коммиты осмысленные, ветка `change/input-validation-builtin` запушена
