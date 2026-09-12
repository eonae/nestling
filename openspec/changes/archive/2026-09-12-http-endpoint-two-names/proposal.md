## Why

Хендлер вернул отказ, которого нет в `errors:` операции, и компилятор не
назвал ни отказ, ни строку, которую надо чинить. Это пункт B1 первого
внешнего прогона
([d/14](../../../docs/history/discussions/14-first-external-run.md)) и
решение
[ideas.md [2026-09-12]](../../../docs/decisions/ideas.md) «Две декларации
HTTP вместо четырёх перегрузок `httpEndpoint`».

Замер на фикстуре из реальных типов (tsc 5.7.3, `type-tests` транспорта)
показал картину хуже отчёта. Декларация формы с операцией, где пайплайн
верен, а хендлер возвращает незаявленный отказ, даёт **две** диагностики
по тринадцать строк: на строке `operation:` и на строке `pipeline:`.
На строке `handler:` — ни одной. Код отказа
`payment_required:card_declined` в тексте не назван; последняя строка
обеих диагностик — `Type 'unknown' is not assignable to type
'{ email: string; }'`.

Причина — четыре перегрузки у одного имени. TypeScript печатает подробности
каждой перегрузки, пока их не больше трёх, и только последнюю, когда их
больше. Последняя перегрузка `httpEndpoint` — анонимная форма с
класс-хендлером, у которой `PF` равно `never`, а `input` неизвестен.
Отсюда и ложная строка на `pipeline:`, и `unknown` вместо схемы входа.

Прототип из двух перегрузок под отдельным именем на той же фикстуре даёт
**одну** диагностику, на строке `handler:`, и её последняя строка
называет код: `Type '"payment_required:card_declined"' is not assignable
to type '"internal_error"'`.

## What Changes

- **BREAKING. Форма с операцией получает своё имя:
  `httpEndpoint.implement(Operation, { pipeline?, detached?, on? })`.**
  Операция идёт первым аргументом, как у `implement(Operation, { … })` в
  `@nestlingjs/app`. Ключ `operation` из словаря `httpEndpoint`
  исчезает, у каждого имени остаётся по две перегрузки: хендлер-функция и
  хендлер-класс.
- **Словарь формы с операцией перестаёт запрещать поля — он их просто не
  имеет.** Сегодня `HttpOperationDictionary` несёт девять полей `never`
  (`method`, `path`, `bind`, `rawBody`, `sse`, `input`, `output`,
  `errors`, `doc`). Они удаляются вместе с ключом `operation`: словарь
  реализации называет только `pipeline`, `detached` и `on`.
  Рантайм-проверка `assertOperationOwned` остаётся — она ловит
  переобъявление у JS-потребителя, которому типы не помогают.
- **Незаявленный отказ назван в типе.** Брендированный тип-ошибки
  `UndeclaredFailError` несёт поля `__error`, `returned` (коды сверх
  объявленных) и `declared` (коды из `errors:`) — по образцу
  `DependencyLengthError` в `@nestlingjs/container`. Место брендирования у
  двух форм хендлера разное, потому что работает оно только так:
  у класса — в слоте `handler`, у функции — в возвращаемом типе. Замер и
  причина — в `design.md`.
- **Скилл получает `references/diagnostics.md`** — таблицу «что напечатал
  компилятор или ASSEMBLE → что это значит → что чинить» (пункт A4
  прогона). Справочник пишется здесь, потому что тексты диагностик после
  этого change'а устоялись.
- **Статические конструкторы по HTTP-методу заводятся отдельной строкой
  плана.** Запись [deferred [2026-09-03]](../../../docs/decisions/deferred.md)
  «Конструктор HTTP-декларации с методом в имени» получает пометку о
  сработавшем триггере, roadmap — строку 71 `http-method-constructors`.

## Capabilities

### New Capabilities

- `undeclared-fail-diagnostics`: как компилятор называет отказ, который
  хендлер возвращает сверх `errors:`; форма брендированного типа, разные
  позиции брендирования у функции и класса, отсечка от протечки текста в
  чужую диагностику.

### Modified Capabilities

- `endpoint-declarations`: у транспорта HTTP два конструктора вместо
  одного — `httpEndpoint({ method, path, … })` для анонимной формы и
  `httpEndpoint.implement(Operation, { … })` для реализации операции.
- `contract-http-binding`: операция с секцией `http:` реализуется
  `httpEndpoint.implement`; карта размещения по-прежнему берётся с
  операции и не пересчитывается.
- `http-input-binding`: правило «карта берётся с операции» записано через
  новое имя.
- `http-handler-form`: конверт `HttpResponse` и `meta.http` не принимает
  `httpEndpoint.implement`; правило о переносимости хендлера операции
  записано через новое имя.
- `layer-declared-fails`: сверка отказов слоя со списком операции
  происходит в слоте `pipeline` конструктора `httpEndpoint.implement`.
- `declaration-doc-metadata`: `doc` принадлежит операции; в словаре
  `httpEndpoint.implement` поля нет вовсе, а рантайм по-прежнему отвергает
  его у JS-потребителя.
- `transport-pipeline-units`: правило «пайплайн с транспортным стартовым
  контекстом принимают обе формы» записано через новое имя.
- `openapi-document`: документ строится по декларации, созданной
  `httpEndpoint.implement`.
- `endpoint-type-diagnostics`: набор фикстур покрывает обе формы обоих
  конструкторов; фикстуры формы с операцией переезжают на новое имя.
- `agent-skill-content`: `references/` содержит одиннадцать файлов —
  добавляется `diagnostics.md`.

## Non-goals

- **`httpEndpoint.get(path, { … })` и остальные семь статиков по
  HTTP-методу.** Это change 71: мотив у него синтаксический, а миграция
  трогает ~305 мест против 39 здесь. Множества мест не пересекаются, и ни
  один call site не переезжает дважды.
- **Форма с операцией у `cliEndpoint`.** Её нет и сейчас; операция без
  секции `http:` реализуется `implement` на шине.
- **Правила размещения полей, `bind`, редирект, формы io.** Меняется имя
  конструктора и текст диагностик, а не модель декларации.
- **Диагностика несошедшегося `bind` и неверной формы `output`.**
  Брендируется одно — множество отказов; остальные тексты остаются
  такими, какими их печатает компилятор, и закрепляются снапшотами.
- **Правило линтера `dependency-list`.** Это change 70, и он идёт после
  этого.

## Impact

- **Код:** `packages/nestling.transport.http/src/helpers.ts` (два
  конструктора вместо четырёх перегрузок, удаление полей `never`),
  `packages/nestling.transport.http/src/index.ts`
  (состав экспортов), `packages/nestling.operations/src/operation.ts`
  (брендированный тип рядом с `ValidateOperationFails`),
  `packages/nestling.app/src/pipeline/core/types/endpoint.ts` (слот
  `handler` формы-функции).
- **Тесты:** `type-tests` транспорта HTTP — новые фикстуры и снапшоты;
  `operation-endpoint.spec.ts`, `handler-form.type-test.ts`,
  `client.integration.spec.ts`, `streaming.integration.spec.ts`,
  `document.spec.ts` пакета `@nestlingjs/openapi` — переезд на новое имя
  (39 мест).
- **Примеры:** `examples/users-service`, `examples/app-with-http` —
  четыре декларации формы с операцией.
- **Скилл:** `packages/nestling.agent-skill` — два сниппета, три
  `references/`, `SKILL.md` (таблица «куда смотреть дальше»), новый
  `references/diagnostics.md`, проверка сборки сниппетов.
- **Документация:** главы гайда 12, 13, 14, 27, `docs/glossary.md`,
  `docs/design/endpoints.md`, `docs/design/operations.md`,
  `docs/design/transports.md`, README пакетов
  `@nestlingjs/transport.http` и `@nestlingjs/agent-skill`.
- **План:** `docs/decisions/roadmap.md` (строка 71),
  `docs/decisions/deferred.md` (пометка о триггере),
  `docs/decisions/ideas.md` (пометка «РЕАЛИЗОВАНО» и уточнение решения 2:
  брендирование у функции живёт в возвращаемом типе, а не в слоте).
- **Совместимость:** ломающее изменение публичного API транспорта HTTP.
  Обновление механическое: `httpEndpoint({ operation: Op, …rest })` →
  `httpEndpoint.implement(Op, { …rest })`.
