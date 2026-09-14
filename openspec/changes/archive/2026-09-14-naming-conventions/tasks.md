## 1. Пакеты: фабрики плагинов

- [x] 1.1 `@nestlingjs/openapi`: `openapi` → `makeOpenapi` в `src/module.ts`,
      `src/index.ts`, спеках и JSDoc
- [x] 1.2 `@nestlingjs/inbox`: `inbox` → `makeInbox`; фикстура
      `src/__fixtures__/app.ts` заодно называет экземпляр `inbox`
- [x] 1.3 `@nestlingjs/outbox`: `outbox` → `makeOutbox`; слой `outboxed` имя
      сохраняет
- [x] 1.4 `@nestlingjs/subscriptions`: `subscriptions` → `makeSubscriptions`;
      слой `tracked` и класс-шаги имена сохраняют
- [x] 1.5 `@nestlingjs/drizzle.pg`: `drizzlePg` → `makeDrizzlePg`,
      `pgOutboxStore` → `makePgOutboxStore`, `pgInboxStore` →
      `makePgInboxStore` (включая подпуть `./outbox`)
- [x] 1.6 `@nestlingjs/transport.http`: `httpProbes` → `makeHttpProbes`;
      `http()`, `server()` и `serverKeys()` не трогаются
- [x] 1.7 Спеки, type-tests и фикстуры затронутых пакетов: имена в коде и в
      текстах ожиданий
- [x] 1.8 README обоих языков шести пакетов: разделы «Минимальный пример» и
      «Экспорты», плашки статуса
- [x] 1.9 `yarn verify` по затронутым пакетам

## 2. Примеры

- [x] 2.1 `microservice`: `appOpenapi` → `openapi`, `appSubscriptions` →
      `subscriptions`, вызовы фабрик через `make*`
- [x] 2.2 `microservice`: слой `observability` → `traced`, слой `observed` →
      `signed`; `authed` и `transactional` остаются; политики в `app.ts`
      называют слой строкой — строка идёт следом
- [x] 2.3 `microservice`: переключатель `Docs` → `DocsEnabled`, строковое имя
      `'docs'` остаётся
- [x] 2.4 `modular-app`: `appInbox` → `inbox`, `appOutbox` → `outbox`, слой
      `base` → `traced`, вызовы фабрик через `make*`; `Mail` остаётся
- [x] 2.5 Спеки, e2e и скрипты примеров (`openapi.ts`, `graph.ts`,
      `create-test-app.ts`), README примеров
- [x] 2.6 `yarn verify` по примерам

## 3. Скилл агента

- [x] 3.1 `packages/nestling.agent-skill/snippets/*`: слой `observability` →
      `traced`, плагин `appPipeline` — существительным, вызовы фабрик
- [x] 3.2 `skill/SKILL.md` и `skill/references/*`: имена в примерах кода
- [x] 3.3 Проверка сниппетов (`agent-skill-snippet-check`) зелёная

## 4. Правила и дизайн

- [x] 4.1 `docs/conventions.md`: раздел «Плагины» переписан — экземпляр
      существительным без префикса и суффикса; добавлено правило о фабриках
      (`make*` у фабрики плагина, существительное у фабрики транспорта и
      сервера)
- [x] 4.2 `docs/conventions.md`: раздел «Пайплайн» переписан — слой
      причастием, с перечнем `traced`, `authed`, `transactional`, `signed`,
      `tracked`, `outboxed`
- [x] 4.3 `docs/en/conventions.md`: те же два раздела английской парой
- [x] 4.4 `docs/design/`: `pipeline.md`, `composition.md`, `persistence.md`,
      `streaming.md`, `transports.md`, `observability.md` — имена в примерах
      кода и в прозе
- [x] 4.5 Английские пары затронутых design-доков
- [x] 4.6 `docs/glossary.md` и `docs/en/glossary.md`: строки «слой» и
      «плагин» — нужна ли правка после смены правила

## 5. Гайды и рецепты

- [x] 5.1 Главы `docs/guide/`: 04, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20,
      22 и оглавление `README.md`
- [x] 5.2 Английские пары тех же глав
- [x] 5.3 Рецепты `docs/recipes/`: `README.md`, `alternatives.md`,
      `extending.md`, `mcp.md`, `ops.md`, `webhook.md` и английские пары
- [x] 5.4 Плашки «сверено с кодом» затронутых глав и рецептов — хэш
      обновляется доливкой после merge-коммита, как в change'ах с кодом
- [x] 5.5 `node .claude/skills/docs-style/scripts/lint.mjs` по всем
      изменённым текстам — 0 запрещённых слов

## 6. Спеки и журналы

- [x] 6.1 Дельты семи capability сверены с реализацией: имена в спеках и в
      коде совпадают
- [x] 6.1a Дельты ещё восьми capability, называвших старое имя в требовании
      или в сценарии: `http-transport-boundary`, `docs-package-readme`,
      `endpoint-discovery`, `pipeline-composition`, `policy-predicates`,
      `policy-eslint-feedback`, `agent-skill-content`,
      `agent-skill-snippet-check`
- [x] 6.2 `docs/decisions/ideas.md`: запись [2026-09-13] «Именование:
      суффиксы `Plugin` и `Layer`, переключатели предикатом» помечена
      superseded ссылкой на новую; новая запись [2026-09-14] несёт контекст,
      решение, отвергнутые варианты и пометку «РЕАЛИЗОВАНО»
- [x] 6.3 Оглавление `ideas.md` пересобрано
      (`node .claude/skills/docs-audit/scripts/ideas-toc.mjs`)
- [x] 6.4 `docs/decisions/deferred.md`: запись [2026-09-13] «Фабрики
      пакетов» получает пометку о сработавшем триггере с принятым решением
- [x] 6.5 `docs/decisions/roadmap.md`: строка 87 переходит в **done** с
      итогом

## 7. Закрытие

- [x] 7.1 `yarn verify` и `yarn docs:audit` зелёные
- [x] 7.2 `git rebase main` перед сдачей: проход задевает файлы, которые
      правят соседние ветки
- [x] 7.3 Коммиты осмысленные, ветка передана Merger'у сообщением

## 8. Definition of Done

- [x] 8.1 Все задачи выше отмечены
- [x] 8.2 `yarn verify` зелёный
- [x] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 8.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [x] 8.5 Запись `ideas.md`, по которой шёл change, несёт пометку
      «РЕАЛИЗОВАНО»
- [x] 8.6 `yarn docs:audit` — 0 ERROR
- [x] 8.7 Затронутые `examples/*` мигрированы, гайды пересверены с
      обновлённой датой в плашке «сверено с кодом»
- [x] 8.8 `main` не тронут — слияние делает Merger после `/opsx:archive`
