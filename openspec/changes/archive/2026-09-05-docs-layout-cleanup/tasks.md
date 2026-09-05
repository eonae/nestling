## 1. Генератор и тема

- [x] 1.1 `git mv scripts/preview/build.mjs scripts/site/build.mjs`;
      `git mv docs/preview/src/layout.html scripts/site/layout.html`;
      `git mv docs/preview/styles.css scripts/site/styles.css`;
      `git mv docs/preview/app.js scripts/site/app.js`
- [x] 1.2 Объединить `docs/preview/README.md` и `docs/preview/src/README.md`
      в один `scripts/site/README.md`: что делает генератор, разметка глав,
      как добавить страницу. Дубли между двумя файлами убрать
- [x] 1.3 `git rm docs/preview/*.html` — 30 отслеживаемых файлов; удалить
      каталог `docs/preview/` целиком
- [x] 1.4 В `scripts/site/build.mjs` заменить константы путей: вывод в
      `docs/.site/`, каркас и тема — из каталога скрипта. Обновить шапку
      файла и тексты ошибок: они называют новые каталоги и `yarn docs:build`
- [x] 1.5 Добавить копирование `styles.css` и `app.js` в каталог вывода
      (D2 в `design.md`): без него страница из `docs/.site/` открывается без
      оформления
- [x] 1.6 Создать каталог вывода, если его нет: после `git clone` его не
      существует

## 2. Каталог вывода и команды

- [x] 2.1 `.gitignore`: строка `docs/.site/`
- [x] 2.2 `package.json`: `docs:preview` переименовать в `docs:build`,
      `docs:preview:watch` — в `docs:dev`; обе указывают на
      `scripts/site/build.mjs`. Алиасов старых имён не оставлять
- [x] 2.3 `yarn docs:build` собирается без ошибок; `git status --short` не
      показывает файлов `docs/.site/`
- [x] 2.4 Открыть `docs/.site/index.html` и страницу главы в браузере:
      оформление, подсветка, сайдбар, пейджер и ссылка `../design/…`
      работают
- [x] 2.5 `yarn docs:dev` пересобирает страницу при правке главы и при
      правке файла в `scripts/site/`

## 3. Правила ведения — один экземпляр

- [x] 3.1 `docs/README.md`: карта папок без `preview/`, с упоминанием
      `scripts/site/` и `docs/.site/`; раздел «Правила ведения» остаётся
      единственным экземпляром правил в репозитории
- [x] 3.2 `CLAUDE.md`: раздел «Обязанность держать доки в синхроне»
      заменить на фразу-инвариант «папка определяет статус документа» и
      ссылку на `docs/README.md`. Оставить в `CLAUDE.md` то, что относится
      к работе агента: workflow changes, Definition of Done, скиллы
      `/docs-style` и `/docs-audit`. Карту `docs/` не дублировать
- [x] 3.3 `docs/design/README.md`: удалить раздел «Три правила», оставить
      карту доков папки и ссылку на правила в `docs/README.md`
- [x] 3.4 `.claude/skills/docs-style/scripts/lint.mjs`: заменить
      `docs/preview/src` в списке путей на `scripts/site`

## 4. Корневые README

- [x] 4.1 `README.md`: удалить таблицы Guide, Examples и Packages, заменив
      их ссылками на `docs/README.md` и оглавление гайда. Оставить
      описание, принципы, quick start, разделы Development, Contributing,
      License
- [x] 4.2 `README.ru.md`: те же правки; обе версии остаются одинаковыми по
      составу разделов
- [x] 4.3 Проверить, что ни один удалённый факт не пропал: список пакетов
      остаётся в `docs/README.md`, список примеров — в оглавлении гайда

## 5. Приложение В

- [x] 5.1 Удалить `docs/guide/appendix-c-coverage.md`
- [x] 5.2 `docs/guide/README.md`: убрать строку приложения В из таблицы
      «Приложения» и упоминание приложения В в разделе «Карта понятий»
- [x] 5.3 Найти и починить ссылки на приложение В в других файлах
      (`git grep -n 'appendix-c'`), кроме `docs/history/`

## 6. Проверка в docs:audit

- [x] 6.1 `.claude/skills/docs-audit/scripts/check.mjs`: новая проверка —
      ни один файл каталога вывода сайта не отслеживается git; ERROR с
      именем файла
- [x] 6.2 Обновить `.claude/skills/docs-audit/SKILL.md`: описание новой
      проверки и новые имена команд
- [x] 6.3 `git grep -n 'docs/preview\|docs:preview'` не находит вхождений
      вне `docs/history/`, `docs/decisions/` и `scripts/waves/`: первые две
      папки append-only и immutable, манифесты волн описывают уже
      заархивированные change'и

## 7. Журнал и план

- [x] 7.1 Запись в `docs/decisions/ideas.md`: структура документации из
      пяти жанров, план из пяти волн, решение оставить свой генератор.
      Контекст, решение, отвергнутые варианты, ссылка на дискуссию
      [d/11](../../../docs/history/discussions/11-docs-structure-and-site.md)
- [x] 7.2 `docs/decisions/roadmap.md`: строка change'а в таблице «После
      волны 6» и упоминание следующих четырёх волн уборки документации

## 8. Definition of Done

- [x] 8.1 Все задачи разделов 1–7 отмечены
- [x] 8.2 `yarn verify` зелёный
- [x] 8.3 README затронутых пакетов обновлены, включая плашки статуса — в
      этом change пакеты не затронуты, отметить как неприменимое
- [x] 8.4 `design/` и `decisions/` синхронизированы по правилам
      `CLAUDE.md`
- [x] 8.5 `yarn docs:audit` — 0 ERROR
- [x] 8.6 Затронутые `packages/examples.*` мигрированы, главы гайда
      пересверены с обновлённой датой в плашке «сверено с кодом» — в этом
      change примеры и текст глав не затронуты, отметить как неприменимое
- [x] 8.7 `node .claude/skills/docs-style/scripts/lint.mjs` по изменённым
      текстам — 0 запрещённых слов
- [x] 8.8 Коммиты осмысленные, ветка `change/docs-layout-cleanup` запушена
