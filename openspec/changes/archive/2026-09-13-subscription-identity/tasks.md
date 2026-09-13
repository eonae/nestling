## 1. Ядро: публичный предикат формы переменной

- [x] 1.1 Экспортировать `isContextVar` из корневого barrel
  `packages/nestling.app/src/index.ts` рядом с `contextVar`,
  `AnyContextVar` и `ReadonlyContextVar`
- [x] 1.2 Рантайм-тест предиката в `variable.spec.ts` (или соседнем спеке
  контекстных переменных): переменная против функции, `Signal` как
  read-only переменная
- [x] 1.3 JSDoc предиката: зачем он публичен — опция потребителя принимает
  переменную либо функцию

## 2. Пакет подписок: типы источников

- [x] 2.1 В `registry.ts` заменить `IdentityExtractor`/`LabelsExtractor` на
  `IdentitySource` (`IdentityVar | IdentityFn`) и `LabelsSource`;
  функции типизировать `ExtendableContext<EmptyInput>`
- [x] 2.2 `SubscriptionContext` оставить внутренней формой реестра
  (`ExtendableContext<AnyInput>`): наружу она больше не нужна — снять
  экспорт, если на неё нет других потребителей
- [x] 2.3 Хелпер `computed(vars, compute)` отдельным файлом
  `src/computed.ts`: `VarValues<V>` кортежным mapped type, чтение значений
  по ключам переменных, результат — функция от контекста
- [x] 2.4 Экспортировать `computed`, `IdentitySource`, `IdentityVar`,
  `IdentityFn`, `LabelsSource` из `src/index.ts`

## 3. Реестр: нормализация и чтение значения

- [x] 3.1 Нормализовать опции в конструкторе `SubscriptionRegistry`:
  переменная → читалка по ключу, функция → она сама; `open()` зовёт
  готовую функцию
- [x] 3.2 Нестроковое и отсутствующее значение переменной дают подписку без
  `identity`; комментарий объясняет, почему здесь нет броска
- [x] 3.3 JSDoc `module.ts`: пример в форме `identity: RequestId` без
  приведения, упоминание политики `everyEndpoint(…).hasVar(…)`

## 4. Тесты пакета

- [x] 4.1 `registry.spec.ts`: переменная называет подписанта; переменная не
  объявлена пайплайном; нестроковое значение; фильтр `list({ identity })`
  на записях, собранных переменной
- [x] 4.2 `registry.spec.ts`: `computed` из двух переменных, `computed` с
  отсутствующим значением, `computed` в `labels` вместе с `ctx.endpoint`
- [x] 4.3 Тест «форма опции разобрана один раз»: реестр с переменной,
  много `open()` — счётчик обращений к форме не растёт (или проверка
  через нормализованную читалку)
- [x] 4.4 `module.spec.ts`: плагин с `identity: RequestId` в собранном
  приложении даёт снимок с `identity`
- [x] 4.5 Type-тест `*.type-test.ts`: чтение `ctx.input.userId` в голой
  функции не компилируется; значения `computed` типизированы
  объявлениями переменных
- [x] 4.6 `boundary.spec.ts` зелёный: импортируемые из `@nestlingjs/app`
  имена не пересекаются со списком запрещённых

## 5. Пример

- [x] 5.1 `examples/microservice/src/ops/ops.plugin.ts`: `identity: RequestId`,
  приведение удалено; JSDoc плагина объясняет связь с политикой `hasVar`,
  которая уже стоит в `app.ts`
- [x] 5.2 `yarn build` и `yarn typecheck` примера зелёные

## 6. Документация

- [x] 6.1 README пакета `packages/nestling.subscriptions/README.ru.md` и
  `README.md`: минимальный пример в форме переменной, `computed` в списке
  экспортов, плашка статуса свежая
- [x] 6.2 `docs/design/streaming.md` §4.1 и `docs/en/design/streaming.md`:
  источник `identity` — переменная, приведение убрано
- [x] 6.3 `docs/guide/14-features.md` и английская пара: пример и абзац об
  опциях переписаны, плашка «сверено с кодом» с новой датой и коммитом
- [x] 6.4 `docs/recipes/ops.md` и английская пара: пример, абзац об опциях,
  строка о политике `hasVar`; плашка обновлена
- [x] 6.5 `docs/recipes/extending.md` и английская пара: пример корня с
  `identity: RequestId`; плашка обновлена
- [x] 6.6 Линтер стиля: `node .claude/skills/docs-style/scripts/lint.mjs
  <изменённые тексты>` → 0 запрещённых слов

## 7. Definition of Done

- [x] 7.1 Все задачи выше отмечены
- [x] 7.2 `yarn verify` зелёный (build + typecheck + lint + test +
  type-budget по всем пакетам)
- [x] 7.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 7.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [x] 7.5 Запись `ideas.md` «[2026-09-13] Разбор фидбэка по коду d/15»
  несёт пометку «РЕАЛИЗОВАНО» по п. 10: что вышло целиком, что уехало
  дальше, чем реализация уточнила решение
- [x] 7.6 `yarn docs:audit` → 0 ERROR
- [x] 7.7 Затронутые `examples/*` мигрированы, главы гайда и рецепты
  пересверены с обновлённой датой в плашке «сверено с кодом»
- [x] 7.8 `main` не тронут — слияние делает Merger после `/opsx:archive`
