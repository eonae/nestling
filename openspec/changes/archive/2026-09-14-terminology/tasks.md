## 1. Подготовка

- [x] 1.1 Написать временный скрипт замен по таблице из `design.md`
  (решение 1). Строка замены передаётся функцией — `replace(re, () => text)`;
  «юнит-тест», «Unit-тест» и `unit test` исключены отрицательным просмотром
  вперёд; после прохода `wc -l` каждого файла сверяется с `git show HEAD:<путь>`
- [x] 1.2 Записать счётчики «до» в рабочую заметку: `assemble|Assemble|ASSEMBLE`,
  `*Unit*`, «юнит», «юнит-тест» — по `packages/`, `examples/`, `docs/`,
  `openspec/specs/`. Архивы (`openspec/changes/archive/`, `docs/history/`)
  из счёта исключены

## 2. Код: `assemble` → `build`

- [x] 2.1 `@nestlingjs/app`: метод декларации `build(args?)`, типы `BuildArgs`
  и `BuiltApp`, фаза `'BUILD'`, тексты отказов «on ASSEMBLE» → «on BUILD»;
  экспорты `src/index.ts` и `src/testing/index.ts`
- [x] 2.2 `@nestlingjs/testing`: `assembleTest` → `buildTest`; файлы
  `src/assemble-test.ts` и его спек переименованы в `build-test.ts`
- [x] 2.3 `@nestlingjs/transport.http`: `assemblePayload` → `buildPayload`
  в `binding.ts`, `transport.ts`, спеке и экспорте `index.ts`
- [x] 2.4 Остальные пакеты: `openapi`, `subscriptions`, `outbox`, `inbox`,
  `mcp`, `drizzle.pg`, `container`, `transport.cli`, `transport.nats`,
  `client`, `operations`, `eslint-plugin`, `agent-skill`; `mcp/src/assembly.spec.ts`
  → `build.spec.ts`
- [x] 2.5 Примеры: `app-with-http`, `container`, `simple-cli`,
  `simple-http-server`, `split-nats`, `users-service`

## 3. Код: `*Unit*` → `*Step*`

- [x] 3.1 `@nestlingjs/app`: `PreStepFn`, `OkStepFn`, `CatchStepFn`,
  `AfterStepFn`, `FinallyStepFn`, `AnyStepFn`, `StepFnOf`, `StepResolver`,
  `StepInstance`, `StepEntry`, `StepLike`, `DeferredPreStepFn`,
  `DeferredStep`, `deferStep`; файл `src/pipeline/core/types/unit.ts` →
  `step.ts`, правки в `pipeline.ts`, `deferred.ts`, `context/variable.ts`,
  `middlewares/*`, `ports/profile.ts`
- [x] 3.2 `@nestlingjs/testing`: `testUnit` → `testBundle`,
  `TestUnitOptions` → `TestBundleOptions`, параметр `unit` → `bundle`; файлы
  `src/unit.ts` и `src/unit.spec.ts` → `bundle.ts` и `bundle.spec.ts`.
  Функция поднимает фичу или плагин, а не шаг: общее правило `Unit` → `Step`
  здесь не работает
- [x] 3.3 `@nestlingjs/transport.http`: `src/units.ts` и `src/units.spec.ts` →
  `steps.ts` и `steps.spec.ts`, экспорт `units` → `steps`
- [x] 3.4 `@nestlingjs/inbox` (`InboxClaimUnit` → `InboxClaimStep`),
  `subscriptions`, `drizzle.pg`, `common.misc`
- [x] 3.5 Фикстура `packages/nestling.app/type-tests/fixtures/unresolved-class-unit.ts`
  → `unresolved-class-step.ts`; заголовки `describe`/`it` и комментарии спеков
- [x] 3.6 Пример `examples/simple-http-server/src/common/units.ts` → `steps.ts`
- [x] 3.7 Рантайм-тесты пайплайна прогнаны и зелёные: `yarn test` в
  `@nestlingjs/app` — переименование не должно опираться только на
  type-тесты

## 4. Ворота кода

- [x] 4.1 `yarn verify` зелёный
- [x] 4.2 Счётчик «после» по `packages/` и `examples/`: `assemble` и `*Unit*`
  дают ноль; исключения — `yarn build`, `tsconfig.build.json`, «юнит-тест»,
  `BuiltContainer` и `ContainerBuilder.build()`, которые так назывались и раньше

## 5. Документация

- [x] 5.1 `docs/glossary.md` и `docs/en/glossary.md`: термин «шаг» (step),
  «юнит»/`unit` в колонке запрещённых синонимов, «pre-шаг» (`pre-step`),
  «токен семейства» с английской парой `member of a family`, `build`,
  `BuildArgs`, `BuiltApp`, фаза `1 BUILD`
- [x] 5.2 `docs/design/*.md` — обе языковые половины
- [x] 5.3 22 главы `docs/guide/` и их английские пары; дата в плашке
  «сверено с кодом» обновлена
- [x] 5.4 `docs/recipes/`, `docs/guarantees.md`, `docs/conventions.md`,
  `docs/index.md`, `docs/from-nestjs.md` и их английские пары
- [x] 5.5 README пакетов обеими половинами (`README.md` и `README.ru.md`),
  корневой `README.md`, плашки статуса
- [x] 5.6 `@nestlingjs/agent-skill`: текст скилла, сниппеты
  `snippets/handler-unit.ts` → `handler-step.ts` и `snippets/assemble-test.ts`
  → `build-test.ts`, проверка сниппетов зелёная
- [x] 5.7 Линтер стиля: правило на «юнит» с исключением «-тест» и на
  английское `unit`, подсказка называет «шаг»/step; хинты внутри
  `lint.mjs`, где сами упоминают юниты; строки в таблице замен
  `.claude/skills/docs-style/SKILL.md`
- [x] 5.8 Правило на голое «токен» пропускает оборот «токен семейства» в
  любом падеже: без этого новый термин не проходит собственный линтер
- [x] 5.10 «Член» в значении токена семейства вычищен и там, где слово
  «семейства» не стоит рядом: `docs/`, JSDoc и комментарии кода, README
  пакетов, `openspec/specs/`. Где семейство названо в том же предложении —
  «DI-токен», иначе «токен семейства». Не трогаются другие значения слова:
  член группы очереди NATS, член объекта в правиле ESLint
- [x] 5.9 `node .claude/skills/docs-style/scripts/lint.mjs` без аргументов —
  0 запрещённых слов

## 6. Спеки

- [x] 6.1 `git mv` четырёх capability: `pipeline-unit-forms` →
  `pipeline-step-forms`, `transport-pipeline-units` →
  `transport-pipeline-steps`, `synchronous-assembly` → `synchronous-build`,
  `assembly-policies` → `build-policies`
- [x] 6.2 Словарный проход по `openspec/specs/**`, включая разделы
  `## Purpose` и перекрёстные ссылки на переименованные capability
- [x] 6.3 `openspec validate terminology` — валиден; дельты этого change'а
  и main-спеки говорят одними словами. Блоки `## RENAMED Requirements`
  сняты: заголовки в main-спеках уже новые, и `openspec archive` на них
  падает. Слияние прогнано на копии `openspec/`

## 7. Ворота документации

- [x] 7.1 `yarn docs:audit` — 0 ERROR, включая `lang-parity`
- [x] 7.2 Счётчик «после» по `docs/` и `openspec/specs/`: старые формы дают
  ноль; счётчик «юнит-теста» совпадает с записанным в 1.2

## 8. Завершение

- [x] 8.1 Временный скрипт замен удалён из репозитория
- [x] 8.2 Пометка «СУПЕРСИД» в части имени `assemble` проставлена записям
  `docs/decisions/ideas.md` [2026-09-03] «Декларация приложения» и
  [2026-09-06] «Переключатели состава»
- [x] 8.3 Коммиты осмысленные: код, документация и спеки разделены

## 9. Definition of Done

- [x] 9.1 Все задачи выше отмечены
- [x] 9.2 `yarn verify` зелёный (build + typecheck + lint + test + type-budget
  по всем пакетам)
- [x] 9.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 9.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [x] 9.5 Запись `ideas.md [2026-09-13]` «Термины: шаг, токен семейства,
  `build`» несёт пометку «РЕАЛИЗОВАНО» с тем, что вышло целиком, что уехало
  дальше и чем реализация уточнила решение
- [x] 9.6 `yarn docs:audit` — 0 ERROR
- [x] 9.7 Затронутые `examples/*` мигрированы, главы гайда пересверены с
  обновлённой датой в плашке «сверено с кодом»
- [x] 9.8 `main` не тронут: слияние делает Merger после `/opsx:archive`
