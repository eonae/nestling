## Why

Ядро жёстко завязано на zod: `z.ZodType`/`z.infer` в сигнатурах
`parsePayload`/`parseMetadata`/`DomainType`, `Schema = z.ZodTypeAny` в
`@common/misc`, `ZodError` торчит из публичного `SchemaValidationError`,
`import z from 'zod'` — рантайм-импорт внутри `@nestling/pipeline`. Фреймворк,
продающий «no lock-in», привязывает пользователя к вендору схем.

Экосистема стандартизовалась: **Standard Schema v1** (standardschema.dev) —
общий интерфейс zod / valibot / arktype / Effect Schema / TypeBox: одно
проперти `~standard` с `validate(value) → {value} | {issues}` и фантомными
типами для инференса. Логика решения зафиксирована в
[ideas.md, «[2026-07-13] Схемы: Standard Schema вместо привязки к
zod; OpenAPI через явные конвертеры»](../../../docs/decisions/ideas.md),
целевое состояние — [design/schemas.md](../../../docs/design/schemas.md).
Это change #19 из [roadmap](../../../docs/decisions/roadmap.md) — первый в
breaking-окне волны 2: чем раньше, тем меньше кода написано против
`z.ZodType`.

## What Changes

- **BREAKING** `@common/misc`: `Schema` = `StandardSchemaV1` вместо
  `z.ZodTypeAny`; `Infer<T>` — через `StandardSchemaV1.InferOutput`.
  Тип `StandardSchemaV1` реэкспортируется, чтобы потребителю не требовалось
  ставить пакет спеки самому.
- **BREAKING** `@nestling/pipeline`: `parsePayload`/`parseMetadata` принимают
  `StandardSchemaV1` и валидируют через `~standard.validate`; `DomainType<S>`
  = `InferOutput<S>`.
- **BREAKING** `SchemaValidationError` несёт `issues: readonly Issue[]`
  (`{ message, path? }`) вместо поля `zodError: ZodError`. Обратная
  совместимость поля не сохраняется.
- **BREAKING** формат `details` в 400-ответе транспорта: стандартные issue'ы
  (`message` + нормализованный `path`) вместо zod-специфичных
  (с `code`, `expected`, `received`).
- **BREAKING** `EndpointMeta.input`/`output` (`@nestling/pipeline`) типизируются
  как `StandardSchemaV1`; дак-тайп `interface Schema<T> { parse(data): T }`
  удаляется.
- Валидация становится единой: приватный `validateSync` — общая точка для
  `parsePayload`, юнита `validate()`, поэлементной валидации чанков
  в `parseStream` (HTTP) и fallback-ветки транспортов. Прямые вызовы
  `schema.parse(...)` из кода уходят.
- `validate`, вернувший Promise (async refinements), — ошибка
  (`AsyncSchemaNotSupportedError`), не тихая деградация и не «повисший»
  объект вместо значения.
- Fail-fast на объекте, который не является Standard Schema (например,
  zod < 3.24): понятная ошибка вместо `Cannot read properties of undefined`.
- `InferSchemaType` в `io.ts` схлопывается: вендорские ветки (`_output` zod,
  `__outputType` yup) заменяются одной — через `~standard`.
- **BREAKING** zod уходит из `peerDependencies` пакетов ядра
  (`@nestling/pipeline`, `@nestling/app`, `@nestling/transport`,
  `@nestling/transport.http`, `@nestling/transport.cli`) — валидатор приносит
  пользователь; в тестах и примерах zod остаётся как один из вариантов.
  Рантайм-импорт zod из `middlewares/meta.ts` удаляется.

## Capabilities

### New Capabilities

- `standard-schema-validation`: ядро принимает `StandardSchemaV1` на всех
  схемных границах — валидация через `~standard.validate`, инференс через
  `InferOutput`, стандартизованные `issues` в `SchemaValidationError`,
  синхронность валидации как гарантия (Promise → ошибка), fail-fast на
  не-Standard-Schema, отсутствие валидатора в зависимостях ядра.

### Modified Capabilities

- `http-request-validation-errors`: требование «Schema validation failures keep
  400» переформулируется с zod на Standard Schema; фиксируется форма `details`
  (список `{ message, path }`) и добавляется поведение для async-схемы
  (не 400, а 500 — это ошибка конфигурации приложения, а не входа).

## Impact

**Код (ядро):**

- `packages/common.misc/src/index.ts` — `Schema`, `Infer`, реэкспорт
  `StandardSchemaV1`; появляется зависимость `@standard-schema/spec`
  (types-only, 0 байт рантайма).
- `packages/nestling.pipeline/src/schema/{types,parse}.ts` — `DomainType`,
  `parsePayload`/`parseMetadata`, `SchemaValidationError`, новый `validateSync`.
- `packages/nestling.pipeline/src/core/types/context.ts` — удаление дак-тайпа
  `Schema<T>`, типизация `EndpointMeta`.
- `packages/nestling.pipeline/src/core/io/io.ts` — `InferSchemaType`,
  распознавание схемы в `analyzePayload`.
- `packages/nestling.pipeline/src/middlewares/{validate,meta}.ts` — валидация
  через `validateSync`, снятие рантайм-импорта zod.
- `packages/nestling.transport.http/src/{parser,transport}.ts` — валидация
  чанков стрима, `error.zodError.issues` → `error.issues`.
- `packages/nestling.transport.cli/src/index.ts` — типы схем на call-site
  `parsePayload`.

**Зависимости:** `zod` из `peerDependencies` ядра → devDependency
(в корне монорепо уже есть); `@standard-schema/spec@^1.1.0` в `@common/misc`.

**Публичный API (потребители):** пользователи, читавшие
`SchemaValidationError.zodError`, ломаются — читают `issues`; клиенты,
разбиравшие `details` 400-ответа по `code`, ломаются — в issue'ах остаются
`message` и `path`.

**Примеры и доки:** `packages/examples.{app-with-http,simple-cli,simple-http-server}`
проверяются на совместимость (zod 4 реализует `~standard` нативно — правки
ожидаются минимальными, zod остаётся их прямой зависимостью как выбор
пользователя); гайды `docs/guides/{cli,http-app-di,http-functional}.md`
пересверяются с обновлённой датой; README затронутых пакетов и
`docs/preview` — по факту изменений.

**Вне периметра:** `@nestling/models` — самостоятельный zod-нативный пакет
(`z.ZodObject`-интроспекция в типах), не используемый ни ядром, ни примерами,
ни доками. Он сохраняет свой явный `peerDependencies.zod` и в этом change не
переписывается; его судьба (переписать под спеку без интроспекции либо
удалить) — отдельное решение, см. design.md.

## Non-goals

- **Конвертеры схем в JSON Schema/OpenAPI** — отдельный change `openapi`
  (#20): `SchemaDocConverter`, диспетчеризация по `~standard.vendor`,
  пакеты `@nestling/openapi.zod` и т. п.
- **Вендор-специфичная интроспекция схем где бы то ни было** — спека
  интроспекции не даёт, и ядро её не эмулирует; всё, что требует знания
  структуры схемы, решается явными декларациями в других change'ах.
- **Сохранение обратной совместимости поля `SchemaValidationError.zodError`** —
  поле удаляется без алиаса и без deprecation-периода: change идёт внутри
  breaking-окна волны 2.
- **Асинхронная ветка валидации** — async-схемы остаются ошибкой; вопрос
  «запрет навсегда или async-ветка пайплайна» открыт в ideas.md и решается
  отдельно.
- **Изменение канона размещения input** (path/query/body, bind-карта) —
  change `input-bind` (#21).
- **Переписывание `@nestling/models`** — см. «Вне периметра» выше.
