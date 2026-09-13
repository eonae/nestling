## 1. Ядро: `transports:` только транспорты

- [x] 1.1 `packages/nestling.app/src/transport/declaration.ts`: удалить тип
  `TransportEntry` и предикат `isTransport`; переписать JSDoc
  `ServerDeclaration` и поля `TransportDeclaration.server` — сервер попадает
  в сборку по ссылке, а не элементом списка
- [x] 1.2 `packages/nestling.app/src/index.ts`: убрать `TransportEntry` и
  `isTransport` из экспортов; `ServerDeclaration` и
  `makeServerDeclaration` остаются
- [x] 1.3 `packages/nestling.app/src/root/plan.ts`: типизировать
  `IntercomName`, `AppSpecCommon`, `AppSpec` и `NormalizedAppSpec` через
  `Branchable<TransportDeclaration>[]`; обновить JSDoc поля `transports:`
- [x] 1.4 `collectServers` в `plan.ts`: собирать серверы только из полей
  `server` транспортов; дедупликация по ссылке; в тексте ошибки про два
  разных объявления одного имени назвать `server({ name })`
- [x] 1.5 `normalizeSpec` в `plan.ts`: отвергать объявление сервера в
  `transports:` до `collectServers`; сообщение называет опцию `server`
  транспорта как замену
- [x] 1.6 `packages/nestling.app/src/root/composition.ts`: снять фильтрацию
  `isTransport`, обновить JSDoc поля `servers`
- [x] 1.7 `packages/nestling.app/src/root/app.ts`: обновить JSDoc
  `#serverDecls` — источник один, поле `server` транспорта

## 2. Ядро: тесты

- [x] 2.1 `packages/nestling.app/src/root/servers.spec.ts`: переписать под
  ссылку — регистрация сервера транспортом, один узел на сервер, названный
  двумя транспортами, два разных объявления одного имени
- [x] 2.2 Добавить тест: объявление сервера в `transports:` отвергается на
  ASSEMBLE, сообщение называет опцию `server`
- [x] 2.3 Добавить тест: сервер, на который никто не ссылается, узла не
  заводит и сокета не открывает
- [x] 2.4 Добавить тест: `transports: [http(), mcp()]` без общего сервера
  падает ошибкой имени `'default'`
- [x] 2.5 Прогнать `yarn workspace @nestlingjs/app test`

## 3. `@nestlingjs/transport.http`

- [x] 3.1 `src/server.ts`: переименовать фабрику `httpServer` → `server`;
  JSDoc и пример переписать под ссылку из транспорта
- [x] 3.2 `src/config.ts`: переименовать `httpServerKeys` → `serverKeys`,
  обновить примеры в JSDoc
- [x] 3.3 `src/index.ts`: обновить экспорты и комментарии разделов
- [x] 3.4 `src/transport.ts`: импортировать фабрику как
  `server as declareServer`, умолчание опции `server` — `declareServer({ name })`
- [x] 3.5 Спеки пакета (`server.spec.ts`, `provider.spec.ts`, интеграционные):
  новые имена; локальные переменные, затенявшие `server`, переименовать
- [x] 3.6 Прогнать `yarn workspace @nestlingjs/transport.http test`

## 4. `@nestlingjs/mcp` и `@nestlingjs/testing`

- [x] 4.1 `packages/nestling.mcp/src/transport.ts`: импорт
  `server as declareServer`, умолчание опции, JSDoc-пример без сервера в
  `transports:`
- [x] 4.2 `packages/nestling.mcp/src/app.integration.spec.ts` и
  `assembly.spec.ts`: новые имена, сервер не перечисляется
- [x] 4.3 `packages/nestling.testing/src/unit.ts`: поле `transports` на
  `TransportDeclaration`
- [x] 4.4 Прогнать тесты обоих пакетов

## 5. Примеры

- [x] 5.1 `examples/app-with-http/src/app.ts`: `const api = server()`,
  `transports: [http({ server: api }), mcp({ server: api, … })]`; комментарий
  про сокет переписать
- [x] 5.2 `examples/app-with-http/e2e/helpers/create-test-app.ts`:
  `serverKeys()`
- [x] 5.3 `examples/split-nats/src/app.ts`: `serverKeys()`
- [x] 5.4 Прогнать e2e примера `app-with-http`

## 6. Документация

- [x] 6.1 `packages/nestling.transport.http/README.ru.md` и `README.md`:
  таблица экспортов, примеры, плашка статуса
- [x] 6.2 `packages/nestling.mcp/README.ru.md` и `README.md`: пример без
  сервера в `transports:`, плашка статуса
- [x] 6.3 `docs/design/config.md` §«Секция транспорта» и
  `docs/en/design/config.md`: имя `serverKeys(name?)`
- [x] 6.4 `docs/guide/07-config.md` и `docs/en/guide/07-config.md`:
  `server({ name: 'admin' })`; обновить дату в плашке «сверено с кодом»
- [x] 6.5 `docs/recipes/mcp.md` и `docs/en/recipes/mcp.md`: `const api = server()`,
  список транспортов без сервера
- [x] 6.6 Сверить `docs/design/transports.md` §4.2 и §8 с реализацией:
  текст уже целевой, менять только разошедшееся
- [x] 6.7 Прогнать `node .claude/skills/docs-style/scripts/lint.mjs` по
  изменённым текстам — 0 запрещённых слов

## 7. Синхронизация решений

- [x] 7.1 `docs/decisions/roadmap.md`: строка 88 — статус, ссылка на архив и
  на изменённые спеки
- [x] 7.2 `docs/decisions/ideas.md`: запись [2026-09-13] «Сервер: `server()`,
  не перечисляется в `transports:`» — пометка «РЕАЛИЗОВАНО» по правилу 9
  `docs/README.md`; обновить оглавление
  (`node .claude/skills/docs-audit/scripts/ideas-toc.mjs`)

## 8. Definition of Done

- [x] 8.1 Все задачи выше отмечены
- [x] 8.2 `yarn verify` зелёный
- [x] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 8.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [x] 8.5 Запись `ideas.md`, по которой шёл change, несёт пометку
  «РЕАЛИЗОВАНО» с тем, что вышло целиком и чем реализация уточнила решение
- [x] 8.6 `yarn docs:audit` — 0 ERROR
- [x] 8.7 Затронутые `examples/*` мигрированы, главы гайда пересверены с
  обновлённой датой в плашке «сверено с кодом»
- [x] 8.8 `main` не тронут: слияние делает Merger после `/opsx:archive`
