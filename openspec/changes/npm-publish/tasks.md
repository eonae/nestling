# npm-publish — tasks

## 1. Скоуп `@nestlingjs`

- [x] 1.1 Имена всех пакетов и все их упоминания в `packages/`, `examples/`,
  `docs/` (кроме `history/` и журналов `decisions/`), `openspec/specs/`,
  `scripts/` и корневых конфигах переведены на `@nestlingjs`; внутренние —
  на `@nestlingjs/common.*`
- [x] 1.2 `moduleNameMapper` в `jest.config.base.js`: правило для `common.`
  стоит до общего, иначе `@nestlingjs/common.misc` попадает в
  несуществующий каталог
- [x] 1.3 `workspaceDirOf` в `scripts/boundary/package-boundary.ts` читает
  имена из манифестов вместо подстановки скоупа в шаблон и не падает на
  корне без каталога `packages`
- [x] 1.4 Внутренний пакет в `.claude/skills/docs-audit/scripts/check.mjs`
  определяется по имени, а не по скоупу
- [x] 1.5 Имя ESLint-плагина в конфигах репозитория, примеров и гайда —
  `@nestlingjs`
- [x] 1.6 Плашки README `common.graphs` и `common.static-server` больше не
  утверждают, что пакет не публикуется
- [x] 1.7 `yarn install`, `yarn verify` зелёный, `yarn docs:audit` — 0 ERROR

## 2. Метаданные манифестов

- [x] 2.1 `files: ["dist"]` в каждом публикуемом пакете
- [x] 2.2 `publishConfig: { "access": "public" }` в каждом публикуемом
  пакете
- [x] 2.3 `engines` с версией Node из `.nvmrc` в каждом публикуемом пакете
- [x] 2.4 `repository` с `directory`, `homepage`, `bugs`, `author`,
  `keywords` в каждом публикуемом пакете
- [x] 2.5 Поле `main` удалено у всех пакетов; точку входа задаёт `exports`
- [x] 2.6 Пустые `description` заполнены: `@nestlingjs/app`, `container`,
  `transport.cli`, `transport.http`, `common.graphs`, `common.misc`
- [x] 2.7 `@nestlingjs/viz` помечен `private: true` — в первый релиз он не
  входит

## 3. Корень репозитория

- [x] 3.1 `LICENSE` (MIT) в корне
- [x] 3.2 `lerna.json`: `version: "0.1.0"`, удалены `tagVersionPrefix:
  "teamc."` и остальные значения из чужого репозитория
- [x] 3.3 `packageManager` в корневом манифесте совпадает с `yarnPath` в
  `.yarnrc.yml`
- [x] 3.4 `lerna-debug.log` и каталог `dist/` в корне убраны, если не нужны

## 4. Проверка упаковки

- [x] 4.1 `scripts/pack-check.mjs`: упаковка публикуемых пакетов, установка
  тарболов в проект вне репозитория, импорт каждого пакета оттуда с
  условием `testing`
- [x] 4.2 Цель `yarn pack:check` в корневом манифесте; в `yarn verify`
  проверка не входит
- [x] 4.3 Проверка падает на пакете без `files` и на манифесте с
  `workspace:` — проверено на заведомо сломанном манифесте
- [x] 4.4 `yarn pack:check` зелёный на всех публикуемых пакетах

## 5. GitHub Actions

- [x] 5.1 `.github/workflows/ci.yml`: push и pull request, Node из
  `.nvmrc`, `yarn install --immutable`, `yarn verify`
- [x] 5.2 `.github/workflows/release.yml`: тег `v*`, те же шаги плюс
  `yarn pack:check` и `lerna publish from-package`
- [x] 5.3 В workflow публикации: `permissions: id-token: write`,
  `NPM_CONFIG_PROVENANCE: true`, ключ доступа из секрета `NPM_TOKEN`
- [ ] 5.4 Секрет `NPM_TOKEN` типа automation заведён в настройках
  репозитория *(действие человека, не кода)*

## 6. Документация

- [x] 6.1 README `@nestlingjs/testing`: условие `"testing"` названо вместе
  со способом включить — `--conditions=testing` и `customExportConditions`
- [x] 6.2 Глава гайда про тесты: то же условие названо там, где читатель
  заводит тесты у себя
- [x] 6.3 README `@nestlingjs/app` и `@nestlingjs/transport.nats`: тестовые
  subpath'ы упоминают условие
- [x] 6.4 `docs/README.md`: правила ведения сверены с тем, что различие
  публичного и внутреннего пакета несёт имя, а не скоуп
- [x] 6.5 `docs/decisions/ideas.md`, запись [2026-09-10] «Публикация в
  npm»: пометка «РЕАЛИЗОВАНО» с тем, что вышло целиком, что уехало дальше
  и чем реализация уточнила решение
- [x] 6.6 `docs/decisions/roadmap.md`: change добавлен в раздел «После
  волны 6» со статусом

## 7. Definition of Done

- [ ] 7.1 Все задачи выше отмечены
- [ ] 7.2 `yarn verify` зелёный (build, typecheck, lint, test, type-budget)
- [ ] 7.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 7.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [ ] 7.5 Запись `ideas.md`, по которой шёл change, несёт пометку
  «РЕАЛИЗОВАНО»
- [ ] 7.6 `yarn docs:audit` — 0 ERROR
- [ ] 7.7 Затронутые `examples/*` мигрированы, главы гайда пересверены с
  обновлённой датой в плашке «сверено с кодом»
- [ ] 7.8 `yarn pack:check` зелёный
- [ ] 7.9 Коммиты осмысленные, ветка запушена
