## 1. Второй прогон конвертера

- [x] 1.1 Добавить в `packages/nestling.openapi/src/input.ts` предикат
  `takesParameters(binding)`: правило `rest === 'query'` либо хотя бы одна
  пометка с `in !== 'body'`
- [x] 1.2 В `planInput` конвертировать тот же лист вторым прогоном с
  `io: 'output'` и прочитать результат через `readObjectSchema` — только
  когда разбор входа удался и `takesParameters(binding)` истинно
- [x] 1.3 Отдать второму прогону отдельную копилку диагностик
  (`{ ...context, diagnostics: new Diagnostics() }`), чтобы отказ
  конвертера в направлении `output` не попадал в диагностики построения
- [x] 1.4 Передать разобранный объект в `planParameters` новым аргументом
  рядом с `object` и описать в шапке файла, зачем прогонов два

## 2. Правило выбора формы свойства

- [x] 2.1 Написать в `input.ts` выбор схемы параметра: свойство
  разобранной формы, если свойство входной формы — объект JSON Schema с
  `type: 'string'`, а свойство разобранной формы — объект JSON Schema с
  `type` из набора `'boolean'`, `'number'`, `'integer'`; иначе свойство
  входной формы
- [x] 2.2 Применить выбор во всех трёх путях `planParameters`: пометка
  `path`, пометка `query` (включая `items` схемы-массива у
  `multiple: true`) и правило `rest: 'query'`
- [x] 2.3 Оставить `required` параметра, набор `taken` и вычитание
  вынесенных полей из `requestBody` считанными по входной форме

## 3. Рантайм-тесты пакета

- [x] 3.1 `document.spec.ts`: `z.stringbool()` с пометкой `query()` даёт
  параметр `type: 'boolean'`, а `requestBody` описывает остальные поля
  входной формой
- [x] 3.2 `document.spec.ts`: path-параметр
  `z.string().pipe(z.coerce.number().int())` даёт `type: 'integer'` и
  сохраняет `required: true`
- [x] 3.3 `document.spec.ts`: `z.coerce.number()` и `z.string()`
  параметр не меняют
- [x] 3.4 `document.spec.ts`: поле с `transform` рядом с `stringbool`
  оставляет параметры входной формой, построение проходит и диагностик не
  даёт
- [x] 3.5 `document.spec.ts`: `z.stringbool()` с пометкой `body()`
  остаётся `type: 'string'` в схеме `requestBody`
- [x] 3.6 `document.spec.ts`: выбранное свойство приносит `description` и
  `default` разобранной формы

## 4. Пример

- [x] 4.1 `examples/app-with-http/src/app.spec.ts`: параметр `dryRun`
  документа несёт `type: 'boolean'` (сейчас проверяется только
  размещение)
- [x] 4.2 Прогнать `yarn workspace @examples/app-with-http openapi` и
  сверить документ: `dryRun` булев, схема тела `POST /users` не
  изменилась

## 5. Документация

- [x] 5.1 `docs/design/schemas.md` §2.1: в пункт про bind-карту добавить
  правило выбора формы параметра и условие второго прогона
- [x] 5.2 `docs/guide/12-openapi-and-client.md`: сказать, что query-поле
  со схемой `z.stringbool()` попадает в документ булевым параметром;
  обновить дату в плашке «сверено с кодом» после сверки сниппетов
- [x] 5.3 Сверить README `@nestlingjs/openapi` и
  `@nestlingjs/openapi.zod`: правило описывает design-док, и ни один
  README не должен утверждать обратного
- [x] 5.4 Прогнать `node .claude/skills/docs-style/scripts/lint.mjs` по
  затронутым файлам — 0 запрещённых слов

## 6. Журналы решений

- [x] 6.1 Поставить на записи `docs/decisions/ideas.md` [2026-09-12]
  «Документ OpenAPI: параметр в разобранной форме, если она скалярная»
  пометку «РЕАЛИЗОВАНО» с тем, что вышло целиком, что уехало дальше и чем
  реализация уточнила решение (второй прогон живёт в `planInput`, а не в
  `planParameters`; одно поле с `transform` отменяет правило для всех
  параметров endpoint'а)
- [x] 6.2 Обновить статус change'а 69 в `docs/decisions/roadmap.md`

## 7. Definition of Done

- [x] 7.1 Все задачи выше отмечены
- [x] 7.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` +
  `type-budget` по всем пакетам)
- [x] 7.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 7.4 `design/` и `decisions/` синхронизированы по правилам
  `CLAUDE.md`, а запись `ideas.md`, по которой шёл change, несёт пометку
  «РЕАЛИЗОВАНО»
- [x] 7.5 `yarn docs:audit` → 0 ERROR
- [x] 7.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с
  обновлённой датой в плашке «сверено с кодом» (ожидается: пример
  `app-with-http` — только проверка в спеке, из глав затронута 12)
- [ ] 7.7 Коммиты осмысленные, ветка `change/openapi-query-parsed-form`
  запушена
