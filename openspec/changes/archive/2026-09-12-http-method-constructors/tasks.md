## 1. Конструкторы транспортов

- [x] 1.1 `packages/nestling.transport.http/src/helpers.ts`: интерфейс
  `HttpMethodConstructor` с двумя сигнатурами вызова — форма с функцией
  первой, форма с классом второй; путь первым параметром, словарь вторым
- [x] 1.2 Там же: `HttpEndpointDictionary` теряет поля `method` и `path`,
  параметр `Path` остаётся и приходит из первого аргумента
- [x] 1.3 Там же: фабрика `makeMethodConstructor(method)` строит `pattern`
  как `` `${method} ${path}` `` и передаёт метод в `computeHttpBinding`
- [x] 1.4 Там же: `httpEndpoint` становится значением-объектом с шестью
  конструкторами (`get`, `head`, `post`, `put`, `patch`, `delete`) и
  `implement`; вызов самого `httpEndpoint` перестаёт компилироваться
- [x] 1.5 Там же: тексты ошибок и аргумент `where` называют вызванный
  конструктор — `httpEndpoint.get('/users', { … })`
- [x] 1.6 Там же: JSDoc обоих конструкторов и примеры в нём переписаны под
  новую форму
- [x] 1.7 `packages/nestling.transport.cli/src/cli-endpoint.ts`: имя
  команды первым аргументом, `CliEndpointDictionary` теряет поле
  `command`, текст ошибки пустой команды называет
  `cliEndpoint('<command>', { … })`. Файл назывался `src/index.ts`, пока
  change `cli-input-prompt` не разнёс модуль на четыре
- [x] 1.8 `packages/nestling.transport.http/src/probes.ts`: пробы
  объявлены `httpEndpoint.get(liveness, { … })`
- [x] 1.9 Спеки обоих пакетов: `helpers.spec.ts`, `provider.spec.ts`,
  `operation-endpoint.spec.ts`, `binding.spec.ts`, интеграционные спеки
  HTTP, `cli-endpoint.spec.ts`, `streaming.spec.ts`
- [x] 1.10 Рантайм-тест на каждый из шести конструкторов: `pattern` несёт
  свой метод, и `bind` считается по нему

## 2. Правило ESLint

- [x] 2.1 `packages/nestling.eslint-plugin/src/endpoint-has-layer.ts`:
  callee принимается и идентификатором, и обращением к его свойству
- [x] 2.2 Там же: словарь берётся из последнего аргумента вызова, если это
  объектный литерал
- [x] 2.3 Там же: `underPattern` сверяется с первым аргументом вызова,
  когда тот — строковый литерал, и молчит в остальных случаях
- [x] 2.4 `endpoint-has-layer.spec.ts`: случаи на `httpEndpoint.get`,
  `httpEndpoint.implement`, `cliEndpoint('users:list', { … })` и на фильтр
  по пути при форме с операцией
- [x] 2.5 `packages/nestling.eslint-plugin/README.md`: примеры настройки и
  срабатывания под новую форму

## 3. Бенч типов и бюджет

- [x] 3.1 `packages/nestling.app/type-tests/bench/generate.ts`: шаблон
  декларации генерирует `httpEndpoint.get(path, { … })`
- [x] 3.2 Пересобрать `type-tests/.generated/graph.ts` генератором
- [x] 3.3 `yarn workspace @nestlingjs/app type-budget`: замер в порогах
  `BUDGET.md`; при сдвиге порога — строка в таблице замеров с датой,
  версией TypeScript и причиной

## 4. Скрипт миграции и места вызова

- [x] 4.1 Разовый скрипт миграции: разбор `ts.createSourceFile`, поиск
  вызовов `httpEndpoint` и `cliEndpoint` с объектным литералом, вынос
  адреса в первый аргумент, смена имени вызываемого
- [x] 4.2 Скрипт обрабатывает блоки ```` ```typescript ```` в Markdown тем
  же разбором
- [x] 4.3 Скрипт не заходит в `docs/history/` (immutable) и
  `docs/decisions/` (append-only)
- [x] 4.4 Прогон по `packages/*`: `@nestlingjs/openapi`,
  `@nestlingjs/testing`, `@nestlingjs/app` (фикстуры и JSDoc),
  `@nestlingjs/operations` (JSDoc `http/binding.ts`, `http/section.ts`),
  `@nestlingjs/subscriptions`
- [x] 4.5 Прогон по `examples/*`: `app-with-http`, `users-service`,
  `simple-http-server`, `simple-cli`
- [x] 4.6 `yarn lint:fix` восстанавливает форматирование после скрипта
- [x] 4.7 Скрипт удалён из репозитория после прогона: он одноразовый

## 5. Диагностики и фикстуры

- [x] 5.1 `packages/nestling.transport.http/type-tests/fixtures/`: все
  фикстуры переведены на новую форму
- [x] 5.2 Новая фикстура на удалённую форму: вызов `httpEndpoint` со
  словарём, содержащим `method` и `path`
- [x] 5.3 `type-tests/valid/`: верные декларации каждой формы
  компилируются без диагностик
- [x] 5.4 `diagnostics.spec.ts`: снапшоты пересняты, дифы просмотрены —
  диагностика на свойстве объекта по-прежнему называет обе формы
  `handler`
- [x] 5.5 Если текст диагностики стал менее понятным — запасной вариант из
  `design.md`: шесть пар перегрузок функциями, присвоенных свойствам.
  Не понадобился: диагностика по-прежнему называет обе сигнатуры
  («Overload 1 of 2» и «Overload 2 of 2»), снапшоты это фиксируют

## 6. Документация

- [x] 6.1 `docs/design/endpoints.md`, `docs/design/composition.md`,
  `docs/design/streaming.md`, `docs/design/transports.md`: форма
  конструкторов
- [x] 6.2 `docs/glossary.md`, `docs/from-nestjs.md`
- [x] 6.3 Главы гайда: 01, 03, 04, 05, 06, 07, 09, 10, 12, 13, 17 —
  примеры и дата в плашке «сверено с кодом»
- [x] 6.4 Рецепты: `cli.md`, `ops.md`, `standalone.md`, `webhook.md` —
  примеры и дата в плашке
- [x] 6.5 README пакетов: `transport.http`, `transport.cli`,
  `subscriptions`, `eslint-plugin` — включая плашки статуса
- [x] 6.6 Скилл `@nestlingjs/agent-skill`: `SKILL.md`,
  `references/endpoints.md`, `references/http.md`,
  `references/from-nest.md`, сниппеты `snippets/*.ts`
- [x] 6.7 `yarn docs:audit` — 0 ERROR
- [x] 6.8 Линтер стиля: `node .claude/skills/docs-style/scripts/lint.mjs`
  по затронутым текстам — 0 запрещённых слов

## 7. План работ

- [x] 7.1 `docs/decisions/roadmap.md`: строка **72** получает статус
  **done** и ссылку на архив. Ссылку ставит сессия `/opsx:archive`: до
  переноса папки `yarn docs:audit` считает её битой
- [x] 7.2 `docs/decisions/deferred.md`: запись [2026-09-03] «Конструктор
  HTTP-декларации с методом в имени» получает пометку «РЕАЛИЗОВАНО» с
  тем, что вышло целиком, и с решением по симметрии CLI
- [x] 7.3 `docs/decisions/archlog.md`: абзац о заархивированном change'е

## 8. Definition of Done

- [x] 8.1 Все задачи выше отмечены
- [x] 8.2 `yarn verify` зелёный (`build`, `typecheck`, `lint`, `test`,
  `type-budget` по всем пакетам)
- [x] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 8.4 `design/` и `decisions/` синхронизированы по правилам
  `CLAUDE.md`
- [x] 8.5 Запись, по которой шёл change, несёт пометку «РЕАЛИЗОВАНО» с
  тем, что вышло целиком, что уехало дальше и чем реализация уточнила
  решение. Своей записи в `ideas.md` у change'а нет: он идёт по
  `deferred.md` [2026-09-03], и пометка ставится там
- [x] 8.6 `yarn docs:audit` — 0 ERROR
- [x] 8.7 Затронутые `examples/*` мигрированы, главы гайда пересверены с
  обновлённой датой в плашке «сверено с кодом»
- [x] 8.8 Коммиты осмысленные, `main` не тронут: слияние делает Merger
  после `/opsx:archive`
