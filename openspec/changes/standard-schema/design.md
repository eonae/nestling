# standard-schema — design

## Context

Источник истины по логике — `docs/decisions/ideas.md`, секция «[2026-07-13]
Схемы: Standard Schema вместо привязки к zod; OpenAPI через явные конвертеры»,
Решение 1. Целевое состояние — `docs/design/schemas.md` §1. Мотивация — в
`proposal.md`.

Текущее состояние кода (сверено 2026-07-29):

- **`@common/misc`** (`src/index.ts`): `Schema = z.ZodTypeAny`,
  `Infer<T> = T extends z.ZodTypeAny ? z.infer<T> : undefined`. Это корневой
  алиас — через него zod протекает во все пакеты. У пакета нет `dependencies`,
  импорт zod — type-only и работает на хойстинге корневого devDep.
- **`@nestling/pipeline/src/schema/`**:
  - `types.ts` — `DomainType<S extends z.ZodType> = z.infer<S>`;
  - `parse.ts` — `parsePayload`/`parseMetadata` вызывают `schema.parse(...)`
    в `try/catch`, ловят «объект с `issues`» и оборачивают в
    `SchemaValidationError(message, zodError)`; поле `zodError: ZodError` —
    публичное.
- **`core/types/context.ts`** — дак-тайп `interface Schema<T> { parse(data): T }`
  и `EndpointMeta.input?/output?: Schema<unknown>` (тип лжёт: в
  `EndpointMeta.input` кладут и модификаторы, и примитивы).
- **`core/io/io.ts`** — `InferSchemaType` разбирает вендорские фантомы:
  `{ _output }` (zod), `{ __outputType }` (yup), иначе `Infer<S>`;
  `analyzePayload()` считает схемой любой объект, не являющийся модификатором.
- **`middlewares/validate.ts`** — дак-тайп `{ parse(data): unknown }`,
  `catch` вытаскивает `issues` «если есть» и бросает `Fail.badRequest`.
- **`middlewares/meta.ts`** — единственный **рантайм**-импорт zod в ядре:
  `z.string().safeParse(headers['x-request-id'])`.
- **`transport.http`**: `parser.ts` валидирует NDJSON-чанки через
  `(schema as z.ZodTypeAny).parse(...)`; `transport.ts:492` формирует тело
  400-ответа как `body.details = error.zodError.issues`; `parsePayload`
  вызывается в ветках `withFiles` и fallback-без-pipeline.
- **`transport.cli`**: три call-site `parsePayload(inputConfig.schema as Schema, …)`.
- **Зависимости**: `zod: ^4.0.0` в `peerDependencies` пяти пакетов ядра
  (`pipeline`, `app`, `transport`, `transport.http`, `transport.cli`) и в
  `devDependencies` корня монорепо; в `examples.*` — прямая `dependency`.
- **`@nestling/models`** — отдельный пакет с zod-нативной интроспекцией в типах
  (`z.ZodObject<infer Shape>`, `z.input<S>`); не импортируется ни ядром, ни
  примерами, ни доками; своя `peerDependencies.zod`.

Ограничения: TS 5.7 strict, ESM, ES-декораторы без reflect-metadata, zero
magic, минимум зависимостей. Change идёт первым в breaking-окне волны 2 —
обратную совместимость держать не нужно, но ломать надо один раз и явно.

Ключевое свойство спеки, определяющее весь дизайн: **Standard Schema даёт
только валидацию и инференс, интроспекции нет.** Схема в рантайме —
чёрный ящик; всё, что требует знания структуры, в ядро не попадает.

## Goals / Non-Goals

**Goals:**

- Единый тип схемы на всех границах ядра — `StandardSchemaV1`; ни один
  вендорский тип не участвует в публичных сигнатурах.
- Единая точка валидации в рантайме — ни одного прямого `schema.parse(...)`
  в коде ядра и транспортов.
- Стандартизованный, JSON-сериализуемый формат отказа валидации.
- Синхронность валидации как гарантия, а не как удача: Promise из `validate`
  → явная ошибка.
- Понятная диагностика на «схема не по спеке» (zod < 3.24, случайный объект).
- Ноль валидаторов в зависимостях ядра.

**Non-Goals:** конвертеры в JSON Schema/OpenAPI (change `openapi`);
интроспекция вендорских схем; async-ветка пайплайна валидации; сохранение
`SchemaValidationError.zodError`; переписывание `@nestling/models`; изменение
канона размещения input (change `input-bind`).

## Decisions

### 1. Тип берём из `@standard-schema/spec`, а не вендорим

`@common/misc` получает `dependencies: { "@standard-schema/spec": "^1.1.0" }`
и реэкспортирует `StandardSchemaV1`; `Schema` становится его алиасом:

```typescript
export type { StandardSchemaV1 } from '@standard-schema/spec';
export type Schema = StandardSchemaV1;
export type Infer<T extends Optional<Schema>> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T>
  : undefined;
```

Пакет — **types-only** (в нём только `dist/index.d.ts`, ноль зависимостей,
ноль рантайм-байт), поэтому «минимум зависимостей» не нарушается: рантайм
приложения не меняется ни на байт.

Реэкспорт важен: потребитель, объявляющий собственную сигнатуру
`(schema: Schema) => …`, не обязан ставить `@standard-schema/spec` сам.

*Альтернатива — вендорить интерфейс* (~40 строк в `@common/misc`): убирает
запись в `dependencies`, но создаёт номинально свой тип. Структурная
типизация TS сделает его совместимым, однако при появлении v2 спеки мы
разъедемся молча, а `guarantee over convention` требует ссылки на
канон, а не копии. Отвергнуто.

*Альтернатива — `peerDependencies`*: спека — не рантайм-плагин и не имеет
проблемы «двух копий в графе»; peer только заставил бы пользователя ставить
пакет руками. Отвергнуто.

### 2. Одна приватная точка валидации: `validateSync`

Новый модуль `packages/nestling.pipeline/src/schema/validate.ts`:

```typescript
export function validateSync<S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
  message: string,
): StandardSchemaV1.InferOutput<S>;
```

Порядок проверок:

1. `assertStandardSchema(schema)` → иначе `NotAStandardSchemaError`;
2. `const result = schema['~standard'].validate(value)`;
3. thenable (`typeof result?.then === 'function'`) → `AsyncSchemaNotSupportedError`;
4. `result.issues` непустой → `SchemaValidationError(message, issues)`;
5. иначе `result.value`.

Через неё проходят **все** валидации: `parsePayload`, `parseMetadata`,
юнит `validate()`, поэлементная валидация NDJSON-чанков в `parseStream`,
fallback-ветки транспортов. Сегодня это четыре разных куска кода с четырьмя
слегка разными `catch`-ами — расхождение форматов ошибки было вопросом
времени.

*Альтернатива — оставить валидацию по месту*, просто заменив `.parse` на
`~standard.validate`: меньше диффа, но три копии логики «async? issues?
не-схема?». Отвергнуто.

Экспортируется ли `validateSync` наружу: **да**, из `@nestling/pipeline`
(его зовут транспорты — отдельные пакеты). `parsePayload`/`parseMetadata`
остаются публичными и становятся тонкими обёртками над ним.

### 3. `SchemaValidationError.issues` — нормализованные, JSON-сериализуемые

```typescript
export interface SchemaIssue {
  readonly message: string;
  readonly path?: readonly (string | number)[];
}

export class SchemaValidationError extends Error {
  constructor(message: string, readonly issues: readonly SchemaIssue[]);
}
```

`path` спеки — `ReadonlyArray<PropertyKey | { key: PropertyKey }>`; сегмент
может быть объектом-с-ключом, а ключ — символом. Нормализуем **при
конструировании ошибки**: `{key}` разворачивается в `key`, `symbol` →
`String(symbol)`, `number` остаётся числом (индексы массивов). Причина:
`issues` уезжают в тело HTTP-ответа как `details` — форма провода должна
быть стабильной и сериализуемой, а не зависеть от того, как вендор упаковал
путь.

Поле `zodError` удаляется без алиаса (non-goal proposal'а). Клиенты,
разбиравшие `details` по zod-специфичным `code`/`expected`/`received`,
ломаются — это заявленный BREAKING: спека гарантирует только `message`
и `path`, и именно эта гарантия — предмет change'а.

*Альтернатива — прокидывать issue'ы вендора как есть* (`unknown[]`):
ноль нормализации, но `SchemaValidationError` перестаёт что-либо
гарантировать, а сериализация символа в пути молча ломает JSON. Отвергнуто.

### 4. Async-схема — ошибка приложения (500), а не ошибка входа (400)

`AsyncSchemaNotSupportedError` — отдельный класс, не наследник
`SchemaValidationError`. Юнит `validate()` и транспорты **не** заворачивают
его в `Fail.badRequest`: пользователь прислал нормальные данные, это автор
приложения подключил схему с async-refinement. Транспорт отдаёт 500 по общей
ветке необработанных ошибок (с маскировкой по `exposeErrorDetails` —
политика `error-response-safety` не ослабляется).

Практический эффект: `catch`-ветки, которые сегодня ловят «всё подряд»,
переписываются на `instanceof SchemaValidationError`, иначе конфигурационная
ошибка замаскируется под 400 и будет искаться в клиенте.

### 5. Guard на «не Standard Schema» — в `validateSync`, не в `analyzePayload`

`assertStandardSchema` проверяет `typeof x === 'object' && x !== null &&
'~standard' in x && x['~standard'].version === 1`. Живёт **только** в
`validateSync`.

`analyzePayload()` остаётся классификатором как есть (модификаторы →
примитивы → «схема»): он вызывается на каждом запросе и в ветках, где
валидация может вообще не понадобиться; превращать его в валидатор деклараций
означало бы платить за проверку на горячем пути и падать в местах, где
объект-не-схема ещё безвреден.

Боот-тайм-проверка деклараций (жадный контейнер знает все endpoints на
старте) — правильное место для этого guard'а, но она приезжает с
`endpoint-discovery` (#8) и `features` (#10); в этом change ограничиваемся
внятной ошибкой в момент первой валидации.

Сообщение ошибки называет вероятную причину явно — «zod < 3.24 / valibot <
1.0 не реализуют Standard Schema», иначе диагностика вырождается в
`Cannot read properties of undefined (reading 'validate')`.

### 6. `InferSchemaType` схлопывается до одной ветки

Вендорские ветки `{ _output }` (zod) и `{ __outputType }` (yup) удаляются:
`~standard.types.output` — единственный источник инференса. Остаются только
ветки примитивов (`'binary'`/`'text'`).

Побочный эффект, который надо назвать: **yup выпадает из поддержки** —
у yup нет Standard Schema. Это осознанная цена стандарта, не регрессия по
недосмотру: поддержка yup была декларацией в типах без единого теста.

### 7. `EndpointMeta` перестаёт врать о типах

Дак-тайп `interface Schema<T> { parse(data): T }` из `core/types/context.ts`
удаляется. `EndpointMeta.input`/`output` типизируются как
`AnyPayload`/`AnyOutput` (`core/io/io.ts`) — честно отражая, что туда кладут
схему, примитив или модификатор. Импорт из `context.ts` в `io.ts` уже есть
(`AnyInput`, `EmptyInput`), новых циклов не появляется (импорты type-only).

### 8. `meta.ts` теряет рантайм-импорт zod

`z.string().safeParse(headers['x-request-id'])` → `typeof v === 'string'`.
Использовать валидатор ради проверки «это строка?» внутри ядра —
ровно то, от чего change избавляется; тащить рантайм-зависимость ради
одной строки нельзя по определению.

### 9. Раскладка зависимостей после change

| Пакет | было | стало |
|---|---|---|
| `@common/misc` | — | `dependencies: @standard-schema/spec@^1.1.0` |
| `@nestling/pipeline`, `app`, `transport`, `transport.http`, `transport.cli` | `peerDependencies: zod@^4` | zod убран; `devDependencies: zod@^4` там, где zod используют тесты (`pipeline`, `app`, `transport.http`) |
| `examples.*` | `dependencies: zod@^4` | без изменений — валидатор приносит пользователь, примеры и есть пользователь |
| `@nestling/models` | `peerDependencies: zod@^4` | без изменений (вне периметра, см. ниже) |

Корневой `devDependencies.zod@^4.0.0` остаётся — им живут тесты и хойстинг.

### 10. `@nestling/models` — вне периметра, с явной пометкой

Пакет типобезопасно строит модели поверх zod, разбирая `z.ZodObject<infer
Shape>` и `z.input<S>` **в типах**. Это ровно та вендор-специфичная
интроспекция, которую change объявляет non-goal'ом, — но переписать его под
спеку нельзя: без интроспекции его центральная фича (сверка схемы с уже
существующим доменным типом по полям) не выражается.

Решение: **не трогать код**, оставить явный `peerDependencies.zod` и добавить
в README пакета плашку — «zod-специфичный сателлит вне ядра V1; ядро схемы
не интроспектирует». Пакет ничем не импортируется, на `yarn verify` влияет
только своей сборкой.

*Альтернатива — удалить пакет в этом change*: чище по итогу, но это
самостоятельное продуктовое решение (что предлагать вместо), а не следствие
перехода на спеку. Вынесено в Open Questions.

## Risks / Trade-offs

- **[Тихая смена формы `details` у существующих клиентов]** → BREAKING
  объявлен в `proposal.md`, зафиксирован дельта-спекой
  `http-request-validation-errors` и попадёт в README `transport.http`;
  тест на форму `details` (`message` + `path`, без `code`) — часть change'а.
- **[`catch`-ветки ловят async-ошибку и отдают 400]** → отдельный класс
  `AsyncSchemaNotSupportedError` вне иерархии `SchemaValidationError`
  плюс тест «async-схема → 500, не 400».
- **[zod 4 отдаёт по `~standard.validate` менее детальные issue'ы, чем
  `ZodError`]** → это и есть цена стандарта; кому нужен вендорский разбор —
  ловит ошибку валидатора сам в своём слое. Детализация ответа сверх
  `message`/`path` — забота change'а `error-model` (#15), а не валидации.
- **[Хойстинг маскирует потерянную зависимость]** → zod прописывается в
  `devDependencies` пакетов, чьи тесты его импортируют, а не только в корне;
  проверка — `yarn verify` плюс отсутствие `from 'zod'` в `src/**` пакетов
  ядра вне `*.spec.ts` (grep-задача в `tasks.md`).
- **[Регрессия на нестандартных схемах в примерах]** → zod 4.2 реализует
  `~standard` нативно, правки в `examples.*` ожидаются нулевыми; риск
  закрывается прогоном примеров и пересверкой гайдов (DoD п. 6).

## Migration Plan

Deprecation-периода нет — change открывает breaking-окно волны 2, пакеты
до 1.0. Порядок работ снизу вверх, чтобы репозиторий собирался на каждом
шаге:

1. `@common/misc` — `Schema`/`Infer`/реэкспорт (ломает компиляцию всех
   зависимых — ожидаемо);
2. `@nestling/pipeline` — `validate.ts`, `parse.ts`, `types.ts`, `io.ts`,
   `context.ts`, `middlewares/*`;
3. транспорты — `http`, `cli`;
4. `package.json` пяти пакетов ядра;
5. примеры, гайды, README, `docs/preview`.

Для потребителей миграция описывается тремя строками в README
`@nestling/pipeline`: `zodError` → `issues`; `details` содержат
`{message, path}`; async-refinement'ы в схемах endpoint'ов запрещены.

Откат — реверт ветки `change/standard-schema` целиком; частичного отката
нет, промежуточные состояния не собираются.

## Open Questions

- **Судьба `@nestling/models`**: удалить, вынести из монорепо или оставить
  zod-сателлитом. Требует отдельного решения (что предлагать вместо
  сверки схемы с доменным типом) — не блокирует этот change.
- **Async-схемы — запрет навсегда или async-ветка пайплайна валидации**
  (открытый вопрос ideas.md [2026-07-13]). В V1 — запрет; пересмотр
  возможен, если появится спрос на async-refinement'ы.
- **`$ref`/components и именованные схемы** — вопрос change'а `openapi`
  (#20), здесь не решается.
