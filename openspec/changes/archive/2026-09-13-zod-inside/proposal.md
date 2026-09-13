## Why

Четыре пакета держат по копии одного и того же приёма: `inbox`, `outbox` и
`drizzle.pg` — хелперы `int` и `flag`, `subscriptions` — конструктор
рекорда. Все четыре написаны литералами `StandardSchemaV1` с вендором
`nestling`: без чейнинга, с границей позиционным аргументом и с листом,
который не понимает ни один конвертер. Шапка каждого файла объясняет, что
пакету не нужен ни zod, ни valibot.

Выигрыш от такой нейтральности есть только там, где схему пишет
пользователь. Там, где схему пишем мы, платится четыре копии, отсутствие
чейнинга и непрозрачный лист в снимке конфига. При этом `transport.http`
уже держит секцию сервера на zod в `dependencies`, `@nestlingjs/models`
написан на zod и его не импортирует никто, а `zodConverter()` называется
явно в каждом `openapi()`, `mcp()` и `cli()` даже в приложении целиком на
zod.

Решение зафиксировано записью
[ideas.md [2026-09-13]](../../../docs/decisions/ideas.md) «Схемы: Standard
Schema на границе, zod внутри; один пакет `schema.zod`» по
[d/15](../../../docs/history/discussions/15-code-feedback.md) пп. 3, 7, 8,
12, 14, 15. Строка 89 [roadmap](../../../docs/decisions/roadmap.md).
Целевое состояние уже описано в
[design/schemas.md](../../../docs/design/schemas.md) §1–§2.1.

## What Changes

- **Пользователю — выбор схемы, себе — zod.** Публичная граница остаётся на
  Standard Schema: приложение пишет схемы на чём хочет, ядро вызывает
  `~standard.validate` и по вендору не ветвится. Ни один публичный тип,
  параметр или возвращаемое значение не называет zod. Зависимость пакета
  фреймворка от zod — выбор реализации, а не требование к приложению.
- **Один пакет `@nestlingjs/schema.zod`** — всё, что фреймворк делает с zod:
  конвертер `zodConverter()`, билдеры полей секций и модели `fromType`,
  `fromScratch`, `makeModel`.
- **BREAKING**: пакет `@nestlingjs/models` удаляется, три его имени
  переезжают в `schema.zod`. Ни одного импортёра у них нет.
- **BREAKING**: билдеры полей возвращают открытое значение zod, а не
  готовую схему. `int()` это `z.coerce.number().int()`, `flag()` —
  `z.union([z.boolean(), z.stringbool()])`, `str()` — непустая строка.
  Границу и умолчание дописывает вызывающий: `int().min(1).default(500)`.
  Прежние сигнатуры `int(fallback, min)` и `flag(fallback)` исчезают.
- **BREAKING**: четыре `schema.ts` удаляются — в `@nestlingjs/inbox`,
  `@nestlingjs/outbox`, `@nestlingjs/drizzle.pg` и
  `@nestlingjs/subscriptions`. Секции конфига и рекорды фактов этих пакетов
  написаны на zod. Аннотация `jsonSchema()` вокруг рекорда больше не нужна:
  лист конвертируется штатно.
- **BREAKING**: секции ядра в `@nestlingjs/app` — логгер, пробы, порты —
  тоже на zod. Рукописные `enumeration`, `milliseconds` и `dispatchSchema`
  удаляются, `@nestlingjs/app` объявляет `zod` зависимостью. Перечисление
  становится `z.enum([...]).default(...)`, и текст отказа приходит от
  валидатора, а не собирается руками.
- **BREAKING**: конвертер zod — умолчание. `@nestlingjs/openapi`,
  `@nestlingjs/mcp` и `@nestlingjs/transport.cli` зависят от `schema.zod`
  напрямую и берут `zodConverter()` без строки в опциях. Поле `converters`
  остаётся способом добавить конвертер другого вендора или заменить
  конвертер zod. Правило «конвертер называется явно одной строкой»
  отменяется вместе с шапкой, которая его несла.
- **BREAKING**: документ OpenAPI строит объявленный плагин —
  `appOpenapi.document(app.discover(args))`. Опции у него уже есть, поэтому
  `info` записан ровно в одном месте. Публичная функция
  `buildOpenApiDocument(endpoints, options)` исчезает вместе с общим
  экспортом `openapiOptions` примера и вторым списком конвертеров у
  `mcp({ … })`.
- `describeConfig({ converters: [zodConverter()] })` даёт JSON Schema для
  секций фреймворка: раньше они приходили исходом `unconvertible`, потому
  что вендора `nestling` конвертер не знает. Список конвертеров остаётся
  данными вызывающего ([config.md §8](../../../docs/design/config.md)):
  умолчания у снимка нет, и без `converters` он прежний.
- Исход `unconvertible` остаётся — для схем приложения на другом вендоре и
  для `details` отказов ядра, объявленных аннотацией.

### Non-goals

- **Штатная команда генерации документа** (`nestling openapi [args]`,
  d/15 п. 12, вторая проблема). Скрипт примера становится тремя строками,
  но заготовкой фреймворка не становится: это отдельное решение про CLI
  фреймворка, которого пока нет.
- **Конвертер-умолчание у `describeConfig` и `check`.** Снимок конфига и
  структурная проверка продолжают принимать список конвертеров явно.
  Умолчание там сделало бы `@nestlingjs/app` зависимым от `schema.zod`,
  а `schema.zod` зависит от `@nestlingjs/app`.
- **Схемы ядра, которые не секции конфига.** `details` отказов ядра,
  переключатели `@nestlingjs/container` и пробы `transport.http` остаются
  рукописными с аннотацией `jsonSchema()`. Контейнер зависимостей не
  получает: у него их две и обе свои.
- **Переименования из change 86** (`build` вместо `assemble`, «шаг» вместо
  «юнита»). Этот change трогает те же файлы, но имена не меняет.
- **Совместимость.** Ни alias'ов, ни deprecated-обёрток, ни tombstone-версии
  `@nestlingjs/models` в реестре.

## Capabilities

### New Capabilities

- `schema-zod-package`: состав и границы `@nestlingjs/schema.zod` —
  конвертер вендора zod, билдеры полей секций открытыми значениями zod,
  модели со сверкой схемы с TypeScript-типом. Сюда же переходит то, что
  описывал удаляемый `@nestlingjs/models`.

### Modified Capabilities

- `standard-schema-validation`: требование «ядро не зависит от валидатора»
  уточняется до «публичный API не называет валидатора». Схемы, которые
  пишет сам фреймворк, написаны на zod; потребитель JSON Schema держит
  конвертер zod умолчанием.
- `openapi-document`: документ строит метод объявленного плагина от
  результата `app.discover()`; поверхностей пакета становится две;
  конвертер zod — умолчание, а не обязательная строка.
- `config-sections`: пустое значение ключа означает отсутствие значения —
  правило переезжает из четырёх рукописных хелперов в одну точку ядра, где
  сырое значение отдаётся схеме поля.
- `mcp-tool-declarations`: пустой `converters: []` перестаёт быть способом
  остаться без конвертера — умолчание есть; диагностика непереводимой схемы
  называет вендор, а не отсутствие списка.
- `cli-input-prompt`: недостающий вход собирается по схеме без объявления
  конвертера; указание на опцию `converters` уходит из диагностики.
- `agent-skill-content`: перечень пакетов скилла без `@nestlingjs/models`,
  с `@nestlingjs/schema.zod` в роли дома моделей и билдеров.

## Impact

**Пакеты.** Удаляется `packages/nestling.models`. Пополняется
`packages/nestling.schema.zod` (билдеры, модели, тесты, README обоих
языков). Удаляются `src/schema.ts` в `nestling.inbox`, `nestling.outbox`,
`nestling.drizzle.pg`, `nestling.subscriptions`. Правятся секции конфига в
`nestling.app` (`logger/config.ts`, `health/config.ts`, `ports/config.ts`).

**Зависимости.** `zod` появляется у `@nestlingjs/app`, `@nestlingjs/inbox`,
`@nestlingjs/outbox`, `@nestlingjs/drizzle.pg`, `@nestlingjs/subscriptions`;
`@nestlingjs/schema.zod` — у `@nestlingjs/openapi`, `@nestlingjs/mcp`,
`@nestlingjs/transport.cli`. Правило `dependency-list` из
`@nestlingjs/eslint-plugin` и `yarn verify` ловят расхождение манифеста с
импортами.

**API.** Исчезают `buildOpenApiDocument` и имя `@nestlingjs/models`.
Меняются возвращаемое значение `openapi()`, опции `openapi()`, `mcp()`,
`cli()` и сигнатуры билдеров полей. `@nestlingjs/app` не меняется вовсе:
`EndpointDiscovery` остаётся прежним.

**Примеры и документация.** `examples/app-with-http` (`app.ts`,
`openapi.ts`), `examples/simple-cli`; главы гайда про OpenAPI и клиент,
рецепт MCP, `docs/README.md` (таблица пакетов), `design/schemas.md` и
`design/config.md`, README семи пакетов на обоих языках.
