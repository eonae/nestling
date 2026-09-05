# examples-out

## Why

`packages/` смешивает две разные вещи: двадцать три пакета фреймворка,
которые публикуются в npm, и шесть примеров, которые существуют только
внутри репозитория. Смешение стоит трёх вещей сразу. Читатель, открывший
`packages/`, не отличает публикуемое от иллюстративного. Три примера из
шести (`examples.container`, `examples.simple-cli`,
`examples.simple-http-server`) не помечены `private: true` — сегодня их
опубликовал бы первый же `lerna publish`. Скрипты обходят `packages/` и
вынуждены отфильтровывать примеры по префиксу имени
(`scripts/smoke.mjs:28`), то есть опираются на соглашение об именовании
там, где хватило бы каталога.

Записи в `docs/decisions/ideas.md` под это решение нет: раскладка
репозитория до сих пор не была предметом отдельного решения. Change
открывает серию из трёх (`examples-out`, `common-inline`,
`package-consolidation`) и идёт первым, потому что он механический и не
пересекается со слиянием пакетов ядра.

## What Changes

- Шесть каталогов `packages/examples.<name>` переезжают в
  `examples/<name>` на верхнем уровне монорепы. Глубина вложенности
  сохраняется, поэтому относительные пути внутри `tsconfig.json`,
  `jest.config.js`, `eslint.config.js` и `esbuild.config.js` примеров
  остаются верными без правки.
- Имена пакетов: `examples.<name>` → `@examples/<name>`. Все шесть
  получают `private: true`.
- Корневой `package.json` добавляет `"examples/*"` в `workspaces`.
- `scripts/smoke.mjs` теряет фильтр по префиксу `examples.`: в
  `packages/` примеров больше нет, и обход каталога больше не зависит от
  имени пакета.
- `.claude/skills/docs-audit/scripts/check.mjs` резолвит пример из
  плашки главы как `examples/<name>` вместо `packages/<name>`.
- Плашки «сверено с кодом» в 25 главах гайда называют пример коротким
  именем: `` `examples.users-service` `` → `` `users-service` ``.
- 278 строк-подписей в блоках кода глав меняют путь:
  `// packages/examples.users-service/src/app.ts` →
  `// examples/users-service/src/app.ts`.
- Таблицы примеров в `README.md` и `README.ru.md`, карта каталогов в
  `docs/README.md` и `CLAUDE.md`, ссылки в `docs/conventions.md`,
  `docs/design/composition.md`, `docs/guide/README.md`,
  `docs/guide/appendix-a-alternatives.md`,
  `docs/guide/appendix-c-coverage.md` и `packages/nestling.viz/README.md`
  указывают на новое расположение.
- Ссылки внутри самих примеров (`src/api/client.ts` у двух примеров,
  две команды `examples.simple-cli`, `jest.e2e.config.js` у
  `examples.app-with-http`) переписываются на новый путь.

Изменение не ломает публичный API: ни один пакет `@nestling/*` не меняет
ни имени, ни состава, ни экспортов.

## Capabilities

### New Capabilities

- `examples-layout`: где живут примеры и что гарантируется их
  расположением — каталог `examples/` вне `packages/`, `private: true` у
  каждого, обход `packages/` в `scripts/smoke.mjs` без фильтра по имени,
  резолвинг примера из плашки главы в `docs-audit`.

### Modified Capabilities

- `docs-preview-guide`: требования не меняются — парсер подписей блоков
  кода не разбирает путь, а переносит строку в атрибут `data-file` как
  есть. Устаревает иллюстрация: сценарий «Подпись блока кода» называет
  `// packages/examples.users-service/src/app.ts`, путь которого после
  переезда не существует. Дельта заменяет путь в сценарии, оставляя
  формулировку требования нетронутой.

## Impact

- Код фреймворка: не затронут. Ни один пакет `@nestling/*` не
  редактируется, кроме `packages/nestling.viz/README.md` (ссылка на
  пример).
- Код примеров: перемещается целиком; правятся только имя в
  `package.json`, флаг `private` и внутренние ссылки на собственный путь.
  Логика примеров не меняется — иначе главы гайда потребовали бы
  пересверки по существу, а не только смены даты в плашке.
- Инструменты: `scripts/smoke.mjs` (обход каталога),
  `.claude/skills/docs-audit/scripts/check.mjs` (резолвинг примера),
  `scripts/preview/build.mjs` (комментарий про формат подписи).
- Документация: 25 глав гайда, три приложения и README гайда, оба
  корневых README, `docs/README.md`, `docs/conventions.md`,
  `docs/design/composition.md`, `CLAUDE.md`.
- Сборка: `yarn install` перечитывает workspaces, `yarn verify`,
  `yarn docs:audit` и `yarn docs:preview` должны остаться зелёными.
- Пользователи: нет — стадия активного проектирования.

## Non-goals

- Слияние пакетов ядра. `@nestling/pipeline`, `config`, `ports`,
  `transport` остаются отдельными пакетами; их судьба — change
  `package-consolidation`.
- Судьба `@common/*`. Чужой npm-скоуп у `@common/misc`, `@common/graphs`
  и `@common/static-server` — предмет change'а `common-inline`.
- Изменение кода примеров по существу: ни новых сценариев, ни
  переписывания существующих. Плашки глав получают новую дату сверки,
  но текст глав меняется только в подписях блоков кода и в имени
  примера.
- Правка записей `docs/decisions/` кроме новой строки в
  `roadmap.md`: журнал append-only, а упоминания `packages/examples.*` в
  прошлых записях `ideas.md`, `archlog.md` и `deferred.md` историчны и
  остаются как есть.
- Переименование пакетов `@nestling/*` и любые правки их экспортов.
