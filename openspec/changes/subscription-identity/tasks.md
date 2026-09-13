## 1. Ядро: публичный предикат формы переменной

- [ ] 1.1 Экспортировать `isContextVar` из корневого barrel
  `packages/nestling.app/src/index.ts` рядом с `contextVar`,
  `AnyContextVar` и `ReadonlyContextVar`
- [ ] 1.2 Рантайм-тест предиката в `variable.spec.ts` (или соседнем спеке
  контекстных переменных): переменная против функции, `Signal` как
  read-only переменная
- [ ] 1.3 JSDoc предиката: зачем он публичен — опция потребителя принимает
  переменную либо функцию

## 2. Пакет подписок: типы источников

- [ ] 2.1 В `registry.ts` заменить `IdentityExtractor`/`LabelsExtractor` на
  `IdentitySource` (`IdentityVar | IdentityFn`) и `LabelsSource`;
  функции типизировать `ExtendableContext<EmptyInput>`
- [ ] 2.2 `SubscriptionContext` оставить внутренней формой реестра
  (`ExtendableContext<AnyInput>`): наружу она больше не нужна — снять
  экспорт, если на неё нет других потребителей
- [ ] 2.3 Хелпер `computed(vars, compute)` отдельным файлом
  `src/computed.ts`: `VarValues<V>` кортежным mapped type, чтение значений
  по ключам переменных, результат — функция от контекста
- [ ] 2.4 Экспортировать `computed`, `IdentitySource`, `IdentityVar`,
  `IdentityFn`, `LabelsSource` из `src/index.ts`

## 3. Реестр: нормализация и чтение значения

- [ ] 3.1 Нормализовать опции в конструкторе `SubscriptionRegistry`:
  переменная → читалка по ключу, функция → она сама; `open()` зовёт
  готовую функцию
- [ ] 3.2 Нестроковое и отсутствующее значение переменной дают подписку без
  `identity`; комментарий объясняет, почему здесь нет броска
- [ ] 3.3 JSDoc `module.ts`: пример в форме `identity: RequestId` без
  приведения, упоминание политики `everyEndpoint(…).hasVar(…)`

## 4. Тесты пакета

- [ ] 4.1 `registry.spec.ts`: переменная называет подписанта; переменная не
  объявлена пайплайном; нестроковое значение; фильтр `list({ identity })`
  на записях, собранных переменной
- [ ] 4.2 `registry.spec.ts`: `computed` из двух переменных, `computed` с
  отсутствующим значением, `computed` в `labels` вместе с `ctx.endpoint`
- [ ] 4.3 Тест «форма опции разобрана один раз»: реестр с переменной,
  много `open()` — счётчик обращений к форме не растёт (или проверка
  через нормализованную читалку)
- [ ] 4.4 `module.spec.ts`: плагин с `identity: RequestId` в собранном
  приложении даёт снимок с `identity`
- [ ] 4.5 Type-тест `*.type-test.ts`: чтение `ctx.input.userId` в голой
  функции не компилируется; значения `computed` типизированы
  объявлениями переменных
- [ ] 4.6 `boundary.spec.ts` зелёный: импортируемые из `@nestlingjs/app`
  имена не пересекаются со списком запрещённых

## 5. Пример

- [ ] 5.1 `examples/microservice/src/ops/ops.plugin.ts`: `identity: RequestId`,
  приведение удалено; JSDoc плагина объясняет связь с политикой `hasVar`,
  которая уже стоит в `app.ts`
- [ ] 5.2 `yarn build` и `yarn typecheck` примера зелёные

## 6. Документация

- [ ] 6.1 README пакета `packages/nestling.subscriptions/README.ru.md` и
  `README.md`: минимальный пример в форме переменной, `computed` в списке
  экспортов, плашка статуса свежая
- [ ] 6.2 `docs/design/streaming.md` §4.1 и `docs/en/design/streaming.md`:
  источник `identity` — переменная, приведение убрано
- [ ] 6.3 `docs/guide/14-features.md` и английская пара: пример и абзац об
  опциях переписаны, плашка «сверено с кодом» с новой датой и коммитом
- [ ] 6.4 `docs/recipes/ops.md` и английская пара: пример, абзац об опциях,
  строка о политике `hasVar`; плашка обновлена
- [ ] 6.5 `docs/recipes/extending.md` и английская пара: пример корня с
  `identity: RequestId`; плашка обновлена
- [ ] 6.6 Линтер стиля: `node .claude/skills/docs-style/scripts/lint.mjs
  <изменённые тексты>` → 0 запрещённых слов

## 7. Definition of Done

- [ ] 7.1 Все задачи выше отмечены
- [ ] 7.2 `yarn verify` зелёный (build + typecheck + lint + test +
  type-budget по всем пакетам)
- [ ] 7.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 7.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [ ] 7.5 Запись `ideas.md` «[2026-09-13] Разбор фидбэка по коду d/15»
  несёт пометку «РЕАЛИЗОВАНО» по п. 10: что вышло целиком, что уехало
  дальше, чем реализация уточнила решение
- [ ] 7.6 `yarn docs:audit` → 0 ERROR
- [ ] 7.7 Затронутые `examples/*` мигрированы, главы гайда и рецепты
  пересверены с обновлённой датой в плашке «сверено с кодом»
- [ ] 7.8 `main` не тронут — слияние делает Merger после `/opsx:archive`
