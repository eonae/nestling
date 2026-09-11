## 1. Приложение из сниппетов собирается в тесте

- [x] 1.1 Добавить в `packages/nestling.agent-skill/src/snippets.spec.ts` блок
  сборки: импорт `app` из `../snippets/app.js`, вызов `assembleTest(app, …)` под
  `await using`, `config: vars({ API_TOKEN: 'test-token' })` и подмена
  `[RootLogger$, spyLogger().logger]` — других подмен нет
- [x] 1.2 Убедиться, что тест падает ровно на том, ради чего написан: до правки
  сниппетов сообщение ASSEMBLE называет `GetUser` и `ListUsers` как endpoint'ы
  без объявленного слоя; записать текст сообщения в коммит
- [x] 1.3 Дать `snippets/get-user.endpoint.ts` поле `pipeline: observability`,
  импортировав слой из `./pipeline.js`
- [x] 1.4 Заменить в `snippets/list-users.endpoint.ts` собственный
  `makePipeline().pre(withRequestId())` на `pipeline: observability`; поправить
  JSDoc сниппета, чтобы он не обещал того, чего в коде больше нет
- [x] 1.5 Пересобрать блоки кода командой
  `yarn workspace @nestlingjs/agent-skill snippets` и сверить, что текст вокруг
  блоков в `references/endpoints.md` остался верным
- [x] 1.6 Прогнать `yarn workspace @nestlingjs/agent-skill test` — сборка
  проходит, в выводе нет записей логгера приложения

## 2. HTTP-форма ответа: `references/http.md`

- [x] 2.1 Написать сниппет `snippets/redirect.endpoint.ts`: `GET`-декларация с
  полем `redirect: 302`, хендлер возвращает `HttpResponse.redirect(location)`,
  слой `observability`
- [x] 2.2 Объявить его в `endpoints:` `UsersFeature` в
  `snippets/users.feature.ts` — endpoint входит в приложение и проверяется
  сборкой
- [x] 2.3 Написать сниппет с `HttpResponse.of(value, { headers, cookies })` и
  `Ok.created` либо показать обе формы в одном сниппете, если он остаётся
  читаемым
- [x] 2.4 Написать `skill/references/http.md`: редирект, заголовки и cookie,
  статусы успеха (`Ok.created`, `Ok.accepted`, `Ok.noContent`, поле `status:`
  в `doc:`), цена пропущенного `redirect:`; ≤ 200 строк
- [x] 2.5 Убрать из `references/endpoints.md` абзац об `HttpResponse` и
  поставить вместо него ссылку на `references/http.md`; проверить, что файл
  остался в потолке 200 строк

## 3. Настройка проекта: `references/setup.md`

- [ ] 3.1 Закрыть открытый вопрос 1 из `design.md`: собрать отдельный проект
  на актуальных zod v4 и TypeScript по `module: "nodenext"` и по
  `"esnext"` + `moduleResolution: "bundler"`; записать результат в комментарий
  задачи и выбрать тот, что компилируется без TS1542
- [ ] 3.2 Написать `skill/references/setup.md`: `tsconfig.json` выбранного
  варианта (`lib` с `esnext.disposable`, без `experimentalDecorators` и
  `emitDecoratorMetadata`, `.js` в относительных импортах), скрипты
  `package.json` (`build` через `tsc`, `dev` через `tsx watch src/main.ts`,
  `test`), конфиг `@nestlingjs/eslint-plugin` с обоими правилами, одна фраза о
  том, почему type stripping в Node не подходит; ≤ 200 строк
- [ ] 3.3 Проверить написанный `tsconfig.json` и скрипты на том же отдельном
  проекте: `build`, `dev` и `test` выполняются
- [ ] 3.4 Добавить `@nestlingjs/eslint-plugin` в `devDependencies` пакета
  скилла через `workspace:*`
- [ ] 3.5 Добавить в `src/skill.spec.ts` проверку: каждое имя вида
  `@nestlingjs/<rule>` в файлах скилла есть среди ключей экспорта плагина

## 4. `SKILL.md`: правила и пакеты

- [ ] 4.1 Добавить правило 6 в «Rules the compiler or ASSEMBLE catches»: корень
  с `hasLayer` обязывает каждый endpoint — включая форму с операцией и
  `implement` — объявить `pipeline:` либо `detached: '<reason>'`
- [ ] 4.2 Добавить в тот же список правило о поле `redirect:`
- [ ] 4.3 Дополнить таблицу «Where to look next» строками `references/setup.md`
  и `references/http.md`
- [ ] 4.4 Добавить в «Where to look next» вторую таблицу — шесть пакетов
  (`outbox`, `subscriptions`, `models`, `transport.cli`, `client`,
  `eslint-plugin`) с одним предложением «когда нужен» на каждый; для `outbox` и
  `client` назвать их первыми запросами после первого сервиса
- [ ] 4.5 Проверить, что заголовков второго уровня по-прежнему пять и файл
  в потолке 250 строк

## 5. `references/testing.md`: второй раннер

- [ ] 5.1 Написать сниппет `snippets/node-test.ts`: один тест на `node:test` и
  `node:assert/strict`, собирающий то же `app` через `assembleTest`
- [ ] 5.2 Добавить в `testing.md` блок с этим сниппетом после блока jest и
  строку запуска `node --test --conditions=testing`
- [ ] 5.3 Проверить потолок 200 строк

## 6. Спеки состава и конфигурация пакета

- [ ] 6.1 Обновить перечень `REFERENCES` в `src/skill.spec.ts` до десяти файлов
- [ ] 6.2 Прогнать `yarn workspace @nestlingjs/agent-skill test` и
  `yarn workspace @nestlingjs/agent-skill typecheck`
- [ ] 6.3 Проверить `yarn pack:check`: новые файлы скилла едут в тарбол,
  сниппеты — нет

## 7. Документация

- [ ] 7.1 Обновить `packages/nestling.agent-skill/README.md`: число файлов
  `references/` в разделе «Установка»
- [ ] 7.2 Поставить на записи `docs/decisions/ideas.md` [2026-09-12] «Скилл
  после первого внешнего прогона» пометку «РЕАЛИЗОВАНО» с тем, что вышло
  целиком, что уехало дальше и чем реализация уточнила решение (в том числе
  ответ на вопрос о `module` из задачи 3.1)
- [ ] 7.3 Обновить статус change'а 66 в `docs/decisions/roadmap.md`
- [ ] 7.4 Прогнать `node .claude/skills/docs-style/scripts/lint.mjs` по
  изменённым русским текстам — 0 запрещённых слов

## 8. Definition of Done

- [ ] 8.1 Все задачи выше отмечены
- [ ] 8.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` +
  `type-budget` по всем пакетам)
- [ ] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 8.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`, а
  запись `ideas.md`, по которой шёл change, несёт пометку «РЕАЛИЗОВАНО»
- [ ] 8.5 `yarn docs:audit` → 0 ERROR
- [ ] 8.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с
  обновлённой датой в плашке «сверено с кодом» (ожидается, что затронутых нет:
  change правит только пакет скилла — проверить и записать вывод)
- [ ] 8.7 Коммиты осмысленные, ветка `change/skill-setup` запушена
