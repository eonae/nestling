# Схемы: Standard Schema и генерация документации

> **Целевое состояние V1.** Логика решений: [ideas.md](../decisions/ideas.md) —
> «Схемы: Standard Schema вместо привязки к zod; OpenAPI через явные
> конвертеры» [2026-07-13]. Статус реализации —
> [roadmap](../decisions/roadmap.md).

## 1. Ядро принимает Standard Schema

На всех схемных границах ядро принимает **`StandardSchemaV1`**
(standardschema.dev) — общий интерфейс zod / valibot / arktype /
Effect Schema / TypeBox: одно проперти `~standard` с
`validate(value) → {value} | {issues}` и фантомными типами для инференса.

- Валидация — через `~standard.validate`; вывод типов — `InferOutput`.
- **Валидатор приносит пользователь** — zod, `zod/mini`, valibot, arktype —
  на его вкус и бюджет бандла; зависимостью ядра валидатор не является.
  В примерах документации — zod как один из вариантов.
- `SchemaValidationError` несёт стандартизованные `issues`
  (`{message, path?}[]`) — формат отказа валидации гарантирован спекой,
  а не вендором; вендорские типы ошибок в публичный API не текут.
- `validate`, вернувший Promise (async refinements), в синхронном
  пайплайне — ошибка, не тихая деградация.

Критичное свойство спеки: она покрывает **только валидацию + инференс,
интроспекции нет** — схема в рантайме непрозрачна. Поэтому всё, что требует
знания структуры, устроено явно, без заглядывания в вендорские схемы:
bind-карта пишется руками при непрозрачной схеме
([endpoints.md](./endpoints.md)), секция конфига — рекорд полей
([config.md](./config.md)), генерация JSON Schema — через вендор-конвертеры
(ниже).

## 2. OpenAPI/AsyncAPI — opt-in модуль с явными конвертерами

Валидация и документирование разведены: рантайм ядра знает только
`~standard.validate`; JSON Schema нужна лишь модулю документации.

```typescript
openapi({ converters: [zodConverter()], info: { title: 'My API' } })
```

- **`@nestling/openapi` не знает ни про один валидатор.** Конвертер —
  публичный контракт `SchemaDocConverter { vendor; toJsonSchema(schema) }`;
  диспетчеризация — по `~standard.vendor` схемы.
- **Конвертеры — отдельные пакеты** (`@nestling/openapi.zod` peer-зависит
  от zod, и т. п.): пользователь ставит ровно то, чем пользуется; мажоры
  конвертера следуют за мажорами валидатора.
- **Boot-time-гарантия**: жадный контейнер знает все endpoints на старте —
  модуль сверяет вендоров всех схем с переданными конвертерами; нет
  конвертера → приложение не поднимается (недокументируемых endpoints не
  бывает, если документация включена).
- **Escape hatch**: явный `jsonSchema` в декларации перекрывает конвертацию.
- Источники сверх JSON Schema — из деклараций: `summary`, `tags`, examples;
  `errors:` → `responses` (`UnknownError` — default-ответ,
  [errors.md](./errors.md)); формы io → media types
  ([endpoints.md](./endpoints.md)); размещение полей — bind-карта
  (`parameter` vs `requestBody`). `stream`/`events` — AsyncAPI тем же
  механизмом.
