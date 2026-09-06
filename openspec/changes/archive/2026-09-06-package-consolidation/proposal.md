# package-consolidation

## Why

Приложение на Nestling импортирует из восьми пакетов ядра: `app`,
`container`, `operations`, `pipeline`, `config`, `ports`, `transport` и
транспорт по выбору. Выбора за этим числом нет. `@nestling/pipeline`
зависит от `container`, `operations` и `streams`; `config`, `ports` и
`transport` зависят от `pipeline`; `app` зависит от всех перечисленных.
Поставить часть нельзя — их ставят вместе, поэтому восемь имён дают
читателю восемь решений там, где решение одно.

Целевая раскладка зафиксирована записью
[ideas.md [2026-09-05] «Раскладка монорепы»](../../../docs/decisions/ideas.md):
ядро собирается в три пакета — `container`, `operations`, `app`. Это
третий change серии из трёх. Первые два (`examples-out`,
`packaging-cleanup`) уже сделаны и убрали из `packages/` примеры и
расхождения манифестов, поэтому слияние идёт по проверенному дереву.

## What Changes

- **BREAKING** `@nestling/streams` сливается в `@nestling/operations`
  каталогом `src/streams`. Пакет `@nestling/streams` удаляется:
  `Topic`, комбинаторы item-цепочек и утилиты `AbortSignal`
  импортируются из `@nestling/operations`. Граница пакета сохраняется:
  у `streams` нет внешних зависимостей и импортов `node:*`, поэтому
  замыкание `@nestling/operations` остаётся пригодным для фронтовой
  сборки.
- **BREAKING** `@nestling/pipeline`, `@nestling/config`,
  `@nestling/ports` и `@nestling/transport` сливаются в
  `@nestling/app` каталогами `src/pipeline`, `src/config`, `src/ports`
  и `src/transport`. Четыре пакета удаляются, их публичные символы
  экспортируются из `@nestling/app`.
- Реэкспортных обёрток, алиасов и пустых пакетов-заглушек не остаётся:
  пять имён (`@nestling/pipeline`, `@nestling/config`,
  `@nestling/ports`, `@nestling/transport`, `@nestling/streams`)
  перестают резолвиться.
- Направление зависимостей внутри `@nestling/app` закрепляется правилом
  ESLint по зонам каталогов: `pipeline` не импортирует `config`,
  `ports`, `transport` и корень пакета; `transport` не импортирует
  `ports` и корень. Это ответ на открытый вопрос записи «правило или
  тест границы». Границы пакетов, которые проверяют замыкание импортов
  собранного `dist` (`operations`, `client`, `app`, `openapi`),
  остаются тестами.
- Пакеты-сателлиты (`transport.http`, `transport.cli`, `transport.nats`,
  `openapi`, `openapi.zod`, `testing`, `subscriptions`) переписывают
  импорты и манифесты на три имени вместо восьми.
- Проверки типов `packages/nestling.pipeline/type-tests` и цель
  `type-budget` переезжают в `packages/nestling.app`.
- Счёт по графу: 22 каталога `packages/` становятся 17, 63 ребра — 29,
  восемь уровней глубины — шесть.

## Capabilities

### New Capabilities

- `core-package-layout`: из чего состоит ядро и что гарантирует его
  раскладка — три пакета (`container`, `operations`, `app`), состав
  каждого, отсутствие реэкспортных обёрток на месте слитых пакетов,
  направление зависимостей внутри `@nestling/app` и правило, которым
  оно держится.

### Modified Capabilities

Требования меняются по существу — дом экспорта или ограничение на
зависимость названы в формулировке:

- `contracts-package-boundary`: реэкспорт `Ok`/`Fail`/`makeFail` и форм
  io переходит с `@nestling/pipeline` на `@nestling/app`; запрет
  реэкспорта конструкторов операций формулируется про `@nestling/app`;
  список запрещённых в замыкании имён теряет исчезнувшие пакеты и
  получает `@nestling/app`; дом декларативного слоя прежний, но шире на
  `streams`.
- `event-sources-topic`: `Topic<T>` поставляется `@nestling/operations`,
  а не отдельным пакетом; требование «без внешних зависимостей и без
  `@nestling/pipeline` в замыкании» держится границей пакета операций.
- `standard-schema-validation`: реэкспорт `validateSync` переходит на
  `@nestling/app`; перечень пакетов ядра сокращается; довод про цикл
  `config → pipeline` заменяется на порядок каталогов внутри пакета.
- `endpoint-declarations`: `makeEndpoint` экспортируется из
  `@nestling/app`; требование «`pipeline` не зависит от `transport`»
  становится требованием к направлению между каталогами одного пакета.
- `message-bus`: `IMessageBus` и `InProcessBus` экспортируются из
  `@nestling/app`, `Topic` — из `@nestling/operations`.
- `subscription-registry`: перечень пакетов ядра, которые сателлит не
  изменяет, сокращается до трёх.
- `dispatch-guarantee`: `Dispatch` и `makeDispatch` экспортируются из
  `@nestling/app`.
- `packages-layout`: сценарии называют исчезнувшие имена пакетов;
  формулировки требований не меняются.

Требования меняются только именем пакета в формулировке или сценарии:
`assembly-policies`, `async-context-vars`, `config-reloadable`,
`config-secrets`, `config-sections`, `context-readers`,
`contract-compatibility`, `contract-declarations`,
`contract-implementations`, `domain-fail-definitions`,
`endpoint-discovery`, `endpoint-input-validation`,
`endpoint-type-diagnostics`, `http-input-binding`, `lifecycle-phases`,
`nats-transport`, `pipeline-phase-model`, `pipeline-type-diagnostics`,
`policy-predicates`, `port-deadline`, `port-idempotency`.

## Non-goals

- Поведение фреймворка не меняется. Ни один экспорт не появляется и не
  исчезает по существу, сигнатуры остаются прежними — меняется дом
  символа.
- Внутренняя структура сливаемых пакетов не переписывается. Каталоги
  переносятся как есть, файлы не делятся и не объединяются.
- Три пакета `@common/*` остаются под своими именами и в своих
  каталогах. Решение принято записью «Раскладка монорепы», п. 2.
- `@nestling/models` и `@nestling/subscriptions` остаются отдельными
  пакетами.
- Публикация в реестр под чужим скоупом `@common` здесь не решается.
  Вопрос открыт до первой публикации.
- Правило `@nestling/import-through-barrel` не меняется и не
  переводится с `warn` на `error`.

## Impact

- Код фреймворка: удаляются пять каталогов `packages/`, их содержимое
  переносится в два. Импорты правятся в семи пакетах-сателлитах и в
  самих сливаемых каталогах. Тест границы `@nestling/operations`
  получает новый список разрешённых импортов.
- Публичный API: пять имён пакетов перестают резолвиться. Приложение
  импортирует из `@nestling/app`, `@nestling/container`,
  `@nestling/operations` и транспорта по выбору.
- Примеры: шесть примеров в `examples/` правят импорты и манифесты.
- Документация: таблицы пакетов в `docs/README.md`, `README.md` и
  `README.ru.md`; девять глав гайда; design-доки, называющие пакеты;
  README сливаемых пакетов складываются в README `@nestling/app` и
  `@nestling/operations`.
- Спеки: 29 файлов в `openspec/specs/` называют исчезающие пакеты.
- Инструменты: `nx` теряет пять проектов, цель `type-budget` меняет
  владельца. `scripts/smoke.mjs`, `jest.config.base.js` и
  `.config/eslint.config.js` правки не требуют — они обходят
  `packages/*` без списка имён.
