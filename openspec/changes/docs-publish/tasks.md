## 1. Генератор учится языкам

- [x] 1.1 `scripts/site/sections.mjs`: список `LANGUAGES` (`en` без префикса и по умолчанию, `ru` с префиксом `ru`), резолвер пути источника по языку (`docs/<путь>` ↔ `docs/en/<путь>`, `README.ru.md` ↔ `README.md`)
- [x] 1.2 `scripts/site/sections.mjs`: убрать из `SECTIONS` страницы `docs/decisions/roadmap.md` и `docs/decisions/deferred.md`
- [x] 1.3 `build.mjs`: `readModel(lang)` — модель одного языка, префикс языка в начале `page.route`
- [x] 1.4 `build.mjs`: печать дерева, `nestling-docs.html` и `search-index.json` на каждый язык; общие `favicon.svg`, `robots.txt`, `404.html`, `.nojekyll` — один раз
- [x] 1.5 `build.mjs`: `sitemap.xml` с адресами обоих языков и `xhtml:link`; `canonical` и `alternate` с `hreflang` (включая `x-default` на английский) при заданном `--base`
- [x] 1.6 `layout.html` и `styles.css`: переключатель языка в шапке; `lang` страницы — язык её дерева
- [x] 1.7 `app.js`: адрес индекса поиска берётся от корня своего языка; переключатель ведёт на тот же раздел в другом языке
- [x] 1.8 `build.mjs`: `docs:dev` следит за обеими ветками источников и пересобирает оба языка

## 2. Каркас зеркала и словарь терминов

- [x] 2.1 `docs/en/glossary.md`: перевод глоссария; у каждого термина рядом стоит русский оригинал — это словарь для остального перевода
- [x] 2.2 `docs/en/index.md` — стартовая страница; `docs/en/guide/README.md`, `docs/en/recipes/README.md`, `docs/en/design/README.md` — оглавления папок
- [x] 2.3 `yarn docs:build` проходит: состав английского дерева полон, тексты глав ещё не переведены
- [x] 2.4 `docs/README.md`: правило раскладки языков одним экземпляром — где лежит пара, что паритету подлежит только публикуемое, что `decisions/` и `history/` остаются русскими

## 3. Правила и проверки английского текста

- [x] 3.1 `.claude/skills/docs-style/SKILL.md`: раздел о правилах английского текста; общий порядок изложения, термины из `docs/en/glossary.md`
- [x] 3.2 `.claude/skills/docs-style/scripts/lint.mjs`: второй список запрещённых слов, выбор списка по пути файла (`docs/en/**`, `packages/*/README.md`, корневой `README.md` — английские)
- [x] 3.3 `docs-audit`: инварианты `lang-parity` и `lang-outline` — пара у публикуемого файла, совпадение состава оглавлений
- [x] 3.4 `docs-audit`: инварианты `lang-link` (ссылка не пересекает границу языка) и `lang-cyrillic` (кириллица в английском файле вне блоков кода)
- [x] 3.5 `docs-audit`: инвариант `lang-glossary` — термин русского глоссария назван в английском
- [x] 3.6 `docs-audit`: плашка `verified against <примеры> (YYYY-MM-DD)` в английских главах и рецептах; `lang-stale` как WARN при отставании даты от русской пары
- [x] 3.7 `docs-audit`: существующие проверки README пакетов идут по обоим файлам пары, плашка ищет ссылки в папки своего языка

## 4. Перевод: страницы корня и рецепты

- [x] 4.1 `docs/en/guarantees.md`, `docs/en/from-nestjs.md`, `docs/en/conventions.md`
- [ ] 4.2 Рецепты, пачка 1: `alternatives.md`, `cli.md`, `config-sources.md`, `extending.md`
- [ ] 4.3 Рецепты, пачка 2: `ops.md`, `standalone.md`, `token-families.md`, `webhook.md`
- [ ] 4.4 Линтер и `docs:audit` по переведённому; ссылки внутри языка, плашки на месте

## 5. Перевод: путь

- [ ] 5.1 Главы 01–07: `01-first-service.md`, `02-composition.md`, `03-input.md`, `04-errors.md`, `05-handler-class.md`, `06-repository.md`, `07-config.md`
- [ ] 5.2 Главы 08–14: `08-testing.md`, `09-logging.md`, `10-auth.md`, `11-database.md`, `12-files-and-streams.md`, `13-openapi-and-client.md`, `14-features.md`
- [ ] 5.3 Главы 15–21: `15-events.md`, `16-durable-events.md`, `17-live-feed.md`, `18-testing-features.md`, `19-select.md`, `20-split.md`, `21-compatibility.md`
- [ ] 5.4 Карта понятий в `docs/en/guide/README.md` — именами из словаря
- [ ] 5.5 Комментарии внутри сниппетов английские, идентификаторы и структура кода совпадают с примерами; линтер и `docs:audit` по пути

## 6. Перевод: design

- [ ] 6.1 Пачка 1: `principles.md`, `container.md`, `composition.md`, `pipeline.md`, `operations.md`, `endpoints.md`, `errors.md`
- [ ] 6.2 Пачка 2: `config.md`, `schemas.md`, `persistence.md`, `streaming.md`, `transports.md`, `testing.md`
- [ ] 6.3 Бейдж «целевое состояние V1» английского раздела приходит из `sections.mjs`; линтер и `docs:audit` по папке

## 7. README пакетов парами

- [ ] 7.1 Пачка 1 — `nestling.app`, `nestling.container`, `nestling.operations`, `nestling.client`, `nestling.models`, `nestling.testing`, `nestling.viz`: русский текст переезжает в `README.ru.md`, английский встаёт в `README.md`
- [ ] 7.2 Пачка 2 — `nestling.transport.http`, `nestling.transport.cli`, `nestling.transport.nats`, `nestling.openapi`, `nestling.schema.zod`, `nestling.subscriptions`, `nestling.eslint-plugin`
- [ ] 7.3 Пачка 3 — `nestling.outbox`, `nestling.inbox`, `nestling.drizzle.pg`, `nestling.agent-skill`, `common.graphs`, `common.misc`, `common.static-server`
- [ ] 7.4 Плашки ведут в `docs/en/`, перечни экспортов совпадают у пар, потолок 120 строк держат оба файла
- [ ] 7.5 `yarn pack:check`: тарбол по-прежнему уносит только `dist`, README реестра английский

## 8. Публикация

- [x] 8.1 `.github/workflows/docs.yml`: триггеры `push` тега `v*` и `workflow_dispatch`; права `pages: write` и `id-token: write`; `concurrency: pages` без отмены
- [x] 8.2 Шаги сборки и выкладки: `yarn docs:build --base https://eonae.github.io/nestling`, `upload-pages-artifact` с `docs/.site`, `deploy-pages` в окружении `github-pages`
- [x] 8.3 `.github/workflows/ci.yml`: шаги `yarn docs:audit` и `yarn docs:build` рядом с `yarn verify`
- [ ] 8.4 Пользователь включает Pages с источником «GitHub Actions» в настройках репозитория — единственное действие вне репозитория
- [ ] 8.5 Ручной запуск workflow проверяет выкладку до первого тега: сайт открывается по адресу, переключатель языка работает, поиск находит разделы своего языка

## 9. Документация change'а

- [x] 9.1 `scripts/site/README.md`: языки, раскладка источников, две формы вывода на язык, файлы публикации
- [x] 9.2 `README.md` и `README.ru.md` репозитория: ссылка на сайт, строка «Documentation and examples are in Russian» больше не нужна
- [x] 9.3 `CLAUDE.md`: правка документации идёт парами языков; линтер по обоим спискам
- [x] 9.4 `docs/decisions/ideas.md`: запись [2026-09-05] «Структура документации» получает пометку о закрытии волны 5 — что вышло целиком, что уехало дальше, чем реализация уточнила решение; открытые вопросы 1 и 2 закрыты
- [x] 9.5 `docs/decisions/roadmap.md`: строка 61 `docs-publish` — **done** со ссылкой на архив; заодно вторая таблица («После волны 6») приводится в соответствие с первой по строкам 71 и 72
- [x] 9.6 `docs/decisions/archlog.md`: абзац о публикации и двуязычии

## 10. Definition of Done

- [ ] 10.1 Все задачи выше отмечены
- [ ] 10.2 `yarn verify` зелёный
- [ ] 10.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 10.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`; запись `ideas.md`, по которой шёл change, несёт пометку «РЕАЛИЗОВАНО» с тем, что вышло целиком, что уехало дальше и чем реализация уточнила решение
- [ ] 10.5 `yarn docs:audit` — 0 ERROR
- [ ] 10.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с обновлённой датой в плашке «сверено с кодом»
- [ ] 10.7 `main` не тронут — слияние делает Merger после `/opsx:archive`
