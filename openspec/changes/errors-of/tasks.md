## 1. Хелпер `errorsOf`

- [x] 1.1 Добавить `errorsOf` в `packages/nestling.operations/src/operation.ts`
      рядом с `InputFormOf`/`OutputFormOf`/`OperationFailsOf`: сигнатура
      `errorsOf<E extends readonly AnyFailDefinition[]>(operation: Operation<any, any, E, 'request' | 'command'>): E`,
      тело — `operation.errors ?? ([] as unknown as E)`. Ограничение
      четвёртого параметра `'request' | 'command'` — единственный способ
      отклонить `EventOperation`, отдельной рантайм-проверки вида не
      заводить (design.md, «Отсутствие рантайм-валидации аргумента»)
- [x] 1.2 JSDoc над `errorsOf` по `/docs-style`: что делает — одно
      предложение, без пересказа сигнатуры
- [x] 1.3 Экспортировать `errorsOf` из `packages/nestling.operations/src/index.ts`
      в группе `./operation.js` рядом с `makeCommand`/`makeEvent`/`makeRequest`

## 2. Тесты

- [x] 2.1 Рантайм-тест в `operation.spec.ts`: `errorsOf(Operation)` с
      объявленными `errors:` отдаёт тот же массив (`toEqual` + проверка
      `===` на элементе, как в сценарии спеки `errors-of`); операция без
      `errors:` даёт `errorsOf(operation)` равным `[]`
- [x] 2.2 Type-test фикстура `packages/nestling.operations/src/errors-of.type-test.ts`
      (формат — как `families.type-test.ts`): позитивный случай —
      `errors: [...errorsOf(ClaimQuota), Own]` типизирует хендлер union'ом
      обоих отказов; негативный — `errorsOf` от `makeEvent(...)` помечен
      `@ts-expect-error`
- [x] 2.3 `yarn test` и `yarn typecheck` пакета `nestling.operations` зелёные

## 3. Пример `app-with-http`

- [x] 3.1 `examples/app-with-http/src/api/operations.ts`: `errors:` операции
      `CreateUser` — `[EmailTaken, ...errorsOf(ClaimQuota), Unauthorized]`;
      прямой импорт `QuotaExceeded` из `../operations.js` убрать, если после
      правки он в файле больше не используется
- [x] 3.2 Комментарий над `CreateUser` (`operations.ts:38-40`, «`errors:`
      перечисляет отказ хендлера, отказ соседней фичи и отказ слоя
      `authed`») сверить с новым видом записи и поправить при расхождении
- [x] 3.3 `yarn test` примера `app-with-http` зелёный (`app.spec.ts`
      проверяет `QuotaExceeded` в ответе — поведение не меняется, только
      объявление)

## 4. Документация

- [x] 4.1 `docs/design/operations.md` §1: короткое упоминание `errorsOf`
      рядом с описанием `errors:` в декларации операции
- [x] 4.2 `docs/en/design/operations.md` §1: тот же абзац на английском
      (`lang-parity`)
- [x] 4.3 `packages/nestling.operations/README.md`: `errorsOf` в списке
      экспортов группы **Operation**, по алфавиту рядом с `EmitMeta`/`Emitter`
- [x] 4.4 `packages/nestling.operations/README.ru.md`: тот же список на
      русском
- [x] 4.5 `node .claude/skills/docs-style/scripts/lint.mjs` по всем
      изменённым текстовым файлам — 0 запрещённых слов

## 5. Решение зафиксировано

- [x] 5.1 В `docs/decisions/ideas.md`, запись `[2026-09-12]` «Разбор
      обзоров d/10 и d/13», добавить блок «РЕАЛИЗОВАНО \<дата\>, пункт 1» —
      change `errors-of` (#76 roadmap): что вышло целиком, чем реализация
      уточнила решение (если уточнила)

## 6. Definition of Done

- [ ] 6.1 Все задачи выше отмечены
- [ ] 6.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` +
      `type-budget` по всем пакетам)
- [ ] 6.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 6.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md;
      запись `ideas.md`, по которой шёл change, несёт пометку «РЕАЛИЗОВАНО»
- [ ] 6.5 `yarn docs:audit` → 0 ERROR
- [ ] 6.6 Затронутые `examples/*` мигрированы, главы гайда, ссылающиеся на
      `errors:` операций, пересверены с обновлённой датой в плашке
      «сверено с кодом» (если хоть одна такая ссылается на пример)
- [ ] 6.7 Коммиты осмысленные, `main` не тронут — слияние делает Merger
      после `/opsx:archive`
