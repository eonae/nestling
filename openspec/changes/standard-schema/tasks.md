# standard-schema — tasks

Порядок разделов = порядок из design «Migration Plan» (снизу вверх), чтобы
каждый следующий шаг чинил компиляцию, сломанную предыдущим.

## 1. Основание: тип схемы в `@common/misc`

- [x] 1.1 Добавить `dependencies: { "@standard-schema/spec": "^1.1.0" }` в `packages/common.misc/package.json` (types-only, ноль рантайма — design D1)
- [x] 1.2 `src/index.ts`: убрать `import type { z } from 'zod'`; `export type { StandardSchemaV1 } from '@standard-schema/spec'`; `Schema = StandardSchemaV1`; `Infer<T> = T extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<T> : undefined`
- [x] 1.3 Тип-тест: `Infer<undefined>` → `undefined`, `Infer<ZodObjectSchema>` → выход схемы; сигнатура с параметром типа `Schema` компилируется без прямого импорта `@standard-schema/spec` (спека `standard-schema-validation`, сценарий «Тип доступен без установки спеки»)

## 2. Ядро валидации (`@nestling/pipeline`)

- [x] 2.1 Новый `src/schema/validate.ts`: `assertStandardSchema` (`~standard` есть и `version === 1`) + `validateSync(schema, value, message)` в порядке проверок из design D2; экспорт из `src/schema/index.ts` и публичного `src/index.ts` — его зовут транспорты
- [x] 2.2 Классы ошибок: `SchemaIssue { message, path? }`, `SchemaValidationError(message, issues)` без поля `zodError`; нормализация пути при конструировании (`{key}` → `key`, `symbol` → `String`, число остаётся числом — design D3)
- [x] 2.3 `AsyncSchemaNotSupportedError` и `NotAStandardSchemaError` — отдельные классы, **не** наследники `SchemaValidationError` (design D4, D5); сообщение `NotAStandardSchemaError` называет вероятную причину (валидатор старой версии)
- [x] 2.4 `src/schema/parse.ts`: `parsePayload`/`parseMetadata` — тонкие обёртки над `validateSync` с сохранением сообщений `'Payload validation failed'` / `'Metadata validation failed'`; `try/catch` вокруг `.parse` удалён
- [x] 2.5 `src/schema/types.ts`: `DomainType<S extends StandardSchemaV1> = StandardSchemaV1.InferOutput<S>`; импорт zod убран
- [x] 2.6 Юнит-тесты `validate.spec.ts`: успех (включая трансформирующую схему — отдаётся `result.value`), issues с путём `['name']` и вложенным `['items', 0, 'id']`, `JSON.stringify(issues)` без потерь, thenable → `AsyncSchemaNotSupportedError` и `!(e instanceof SchemaValidationError)`, объект без `~standard` → `NotAStandardSchemaError`
- [x] 2.7 Переписать `src/schema/parse.spec.ts` под новую форму ошибки (`issues` вместо `zodError`)

## 3. Границы pipeline: типы и юниты

- [x] 3.1 `src/core/types/context.ts`: удалить дак-тайп `interface Schema<T> { parse(data): T }`; `EndpointMeta.input?: AnyPayload` / `output?: AnyOutput` из `core/io/io` (design D7); проверить, что новых циклов импорта не появилось (импорты type-only)
- [x] 3.2 `src/core/io/io.ts`: `InferSchemaType` — убрать ветки `{ _output }` (zod) и `{ __outputType }` (yup), оставить примитивы + `Infer<S>` (design D6)
- [x] 3.3 `src/middlewares/validate.ts`: валидация через `validateSync`; `SchemaValidationError` → `Fail.badRequest(message, issues)`; `AsyncSchemaNotSupportedError`/`NotAStandardSchemaError` **пробрасываются** наружу, а не заворачиваются в 400 (design D4)
- [x] 3.4 `src/middlewares/meta.ts`: снять рантайм-`import z from 'zod'` — `typeof v === 'string'` вместо `z.string().safeParse` (design D8)
- [x] 3.5 Обновить `src/core/io/io.spec.ts` под изменённый инференс; тест «async-схема в `validate()` не превращается в `Fail.badRequest`»

## 4. Транспорты

- [x] 4.1 `transport.http/src/parser.ts`: валидация NDJSON-элементов через `validateSync` вместо `(schema as z.ZodTypeAny).parse` в обеих ветках (полные строки и хвост буфера); импорт `z`/`ZodError` убран
- [x] 4.2 `transport.http/src/transport.ts`: `body.details = error.issues` вместо `error.zodError.issues`; убедиться, что `AsyncSchemaNotSupportedError`/`NotAStandardSchemaError` уходят в общую 500-ветку с маскировкой по `exposeErrorDetails` (спека `error-response-safety` не ослабляется)
- [x] 4.3 `transport.cli/src/index.ts`: три call-site `parsePayload(... as Schema, ...)` — привести касты к новому `Schema`
- [x] 4.4 Интеграционные тесты `transport.http`: форма `details` = `[{ message, path }]` без поля `code`; async-схема → 500, не 400; объект-не-схема в `input` → 500, не 400 (дельта-спека `http-request-validation-errors`)

## 5. Зависимости и отсутствие валидатора в ядре

- [x] 5.1 Убрать `peerDependencies.zod` из `package.json` пяти пакетов ядра: `pipeline`, `app`, `transport`, `transport.http`, `transport.cli`
- [x] 5.2 Добавить `devDependencies.zod: ^4.0.0` в пакеты, чьи тесты импортируют zod (`pipeline`, `app`, `transport.http`) — чтобы хойстинг не маскировал потерянную зависимость (design «Risks»)
- [x] 5.3 Проверка-инвариант: `grep -rn "from 'zod'" packages/{common.misc,nestling.pipeline,nestling.app,nestling.transport,nestling.transport.http,nestling.transport.cli}/src --include='*.ts'` с исключением `*.spec.ts` даёт пустой вывод (спека, сценарий «Нет рантайм-импортов валидатора»)
- [x] 5.4 `examples.*` не трогаем по зависимостям: zod остаётся их прямой `dependency` — валидатор приносит пользователь

## 6. Примеры и вне периметра

- [x] 6.1 Прогнать `examples.app-with-http`, `examples.simple-cli`, `examples.simple-http-server`: сборка + запуск; правки только если zod 4 где-то не подошёл под новые сигнатуры (ожидание — правок ноль)
- [x] 6.2 `@nestling/models`: код не трогать, `peerDependencies.zod` оставить; добавить в README (`README.md` + `README.ru.md`) плашку «zod-специфичный сателлит вне ядра V1; ядро схемы не интроспектирует» (design D10)

## 7. Документация

- [x] 7.1 README `@nestling/pipeline` (`README.md` + `README.ru.md`): раздел о Standard Schema на границах, три строки миграции (`zodError` → `issues`; `details` = `{message, path}`; async-refinement'ы запрещены), плашка статуса
- [x] 7.2 README `@nestling/transport.http` и `@nestling/transport.cli`: смена формы `details` в 400-ответе, отсутствие zod в зависимостях; плашки статуса
- [x] 7.3 README `@common/misc`: `Schema`/`Infer`/реэкспорт `StandardSchemaV1`
- [x] 7.4 `docs/design/schemas.md` §1: сверить с фактом реализации (`validateSync` как единая точка, отдельные классы ошибок, нормализация `path`); при расхождении править design-док по месту, без статусов реализации
- [x] 7.5 `docs/decisions/ideas.md`, секция «[2026-07-13] Схемы…»: пометить `~~строкой~~ — РЕШЕНО` то, что закрыто (Решение 1 реализовано); открытый вопрос про async оставить открытым; текст записи не переписывать (CLAUDE.md, append-only)
- [x] 7.6 `docs/guides/{cli,http-app-di,http-functional}.md`: пересверить с кодом примеров, обновить дату в плашке «сверено с кодом»; добавить фразу «zod — один из вариантов, ядро принимает любую Standard Schema»
- [x] 7.7 `docs/preview`: обновить упоминания zod/схем, если затронуты — не затронуты: preview уже описывает целевое состояние (Standard Schema, конвертеры), `zodError`/вендорских `details` там нет
- [ ] 7.8 `docs/decisions/archlog.md` — абзац о переходе на Standard Schema (на этапе archive); статус change #19 в `docs/decisions/roadmap.md` (после archive)

## 8. Definition of Done

- [x] 8.1 Все задачи разделов 1–7 отмечены (кроме 7.8 — она по своему тексту выполняется на этапе archive)
- [x] 8.2 `yarn verify` зелёный (build + lint + test по всем пакетам)
- [x] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 8.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [x] 8.5 `yarn docs:audit` → 0 ERROR
- [x] 8.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены с обновлённой датой в плашке «сверено с кодом» — код примеров правок не потребовал (zod 4 реализует `~standard` нативно), три гайда пересверены на 2026-07-29
- [x] 8.7 Коммиты осмысленные, ветка запушена
