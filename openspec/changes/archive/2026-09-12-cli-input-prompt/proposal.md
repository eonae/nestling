## Why

Команда CLI, которой не передали обязательный флаг, отвечает отказом
`bad_request` и предлагает читать схему. Целевой дизайн описывает другое
поведение: политика биндинга `missing: 'prompt'` достраивает недостающий
вход вопросами в терминале
([design/endpoints.md](../../../docs/design/endpoints.md) §6,
[design/transports.md](../../../docs/design/transports.md) §5, запись
[ideas.md [2026-07-13]](../../../docs/decisions/ideas.md) «Контракт
первичен», п. 7). Кода нет с момента change'а `endpoint-model`: обещание
живёт комментарием в `packages/nestling.transport.cli/src/index.ts` и
строкой 56 в [roadmap](../../../docs/decisions/roadmap.md).

Вопросы выводятся из схемы, а Standard Schema интроспекции не даёт. Формы
полей читаются из JSON Schema — её отдаёт `SchemaDocConverter`, тот же
механизм, которым пользуется генератор OpenAPI. Конвертер zod при этом
лежит в пакете `@nestlingjs/openapi.zod`, хотя OpenAPI ему не нужен:
CLI-утилите пришлось бы ставить пакет с чужим именем.

## What Changes

- `cliEndpoint` принимает поле `missing: 'error' | 'prompt'`. Умолчание —
  `'error'`: поведение команды без поля не меняется.
- `cli()` принимает `converters`, `interactive`, `input` и `output`.
- Транспорт на `serve` строит план вопросов для каждой команды с
  `missing: 'prompt'`: JSON Schema формы `input` в направлении `io: 'input'`
  даёт перечень обязательных полей и форму каждого. Отсутствие конвертера
  для вендора схемы роняет `serve` с именем команды.
- Вопрос выводится из формы поля: `enum` — выбор из списка, `boolean` —
  подтверждение, скаляр — ввод строки. `description` становится подсказкой,
  `default` — значением по «Enter».
- Спрашиваются только отсутствующие обязательные поля верхнего уровня
  скалярной формы. Массив и вложенный объект не спрашиваются: такое поле
  остаётся пустым и даёт отказ валидации, как сегодня.
- Ответ подставляется в той же форме, в какой его дал бы флаг: строка, а
  для `boolean` — `true` или `false`.
- Неинтерактивная среда вопросы отключает: `stdin` не терминал или задана
  переменная `CI`. Команда отвечает отказом валидации, как сегодня. Опция
  `interactive` решает явно и перекрывает определение по среде.
- Команда с формой входа `stream` и `missing: 'prompt'` роняет `serve`:
  вопросы и поток читают один `stdin`.
- **BREAKING**: пакет `@nestlingjs/openapi.zod` переименован в
  `@nestlingjs/schema.zod`, каталог — `packages/nestling.schema.zod`.
  Экспорты не меняются: `zodConverter` и `ZodConverterOptions`.

## Non-goals

- Справка по команде, подкоманды и индикатор выполнения: граница пакета
  остаётся прежней.
- Диалог посреди выполнения команды. Он выражается парой операций
  plan/apply и не требует кода в транспорте.
- Скрытый ввод: пароль в терминале печатается как есть.
- Вопросы по вложенным объектам и массивам.
- Конвертер для валидатора, отличного от zod.
- Сбор недостающего входа в других транспортах: политика принадлежит
  CLI-биндингу.

## Capabilities

### New Capabilities

- `cli-input-prompt`: политика сбора недостающего входа командной строки —
  объявление в декларации, план вопросов из JSON Schema, формы вопросов,
  форма ответа, отключение вне терминала, запрет вместе с потоковым входом.

### Modified Capabilities

- `openapi-document`: требование о конвертере называет пакет
  `@nestlingjs/schema.zod` вместо `@nestlingjs/openapi.zod`.

## Impact

Код:

- `packages/nestling.transport.cli` — политика, план вопросов, опции
  транспорта, потоки ввода и вывода вместо `process.stdin` и `console`.
- `packages/nestling.openapi.zod` → `packages/nestling.schema.zod` —
  переименование пакета и каталога.
- `packages/nestling.openapi` — имя пакета в `devDependencies`, в тестах и
  в тексте ошибки про отсутствующий конвертер.
- `examples/app-with-http`, `examples/users-service` — имя пакета.
- `examples/simple-cli` — команда с политикой `missing: 'prompt'`.

Документация:

- `docs/design/transports.md` §5 и `docs/design/endpoints.md` §6 — снять
  отметку о неготовности политики.
- `docs/recipes/cli.md` — раздел о недостающем входе.
- `docs/guide/13-openapi-and-client.md`, `docs/design/schemas.md`,
  `docs/recipes/config-sources.md`, `docs/README.md` — имя пакета.
- `docs/decisions/ideas.md` — пометка «РЕАЛИЗОВАНО» у записи
  [2026-07-13] «Контракт первичен»; `roadmap.md` и `archlog.md`.

Спеки: `openspec/specs/openapi-document/spec.md`.
