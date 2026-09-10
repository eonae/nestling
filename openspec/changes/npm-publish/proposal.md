# npm-publish

## Why

Пакеты Nestling не опубликованы ни разу, и репозиторий к публикации не
готов: имя `@nestling` в реестре занято чужим аккаунтом, в тарбол попадают
исходники и конфиги, `LICENSE` нет ни одного при `"license": "MIT"` в
каждом манифесте, а scoped-пакет без `publishConfig.access` реестр
отвергает. Решение по скоупу, версиям, составу первого релиза и способу
публикации зафиксировано записью
[ideas.md [2026-09-10] «Публикация в npm»](../../../docs/decisions/ideas.md).

## What Changes

- **BREAKING** Скоуп пакетов — `@nestlingjs`. Внутренние пакеты переезжают
  из чужого скоупа `@common` в тот же скоуп с `common.` в имени:
  `@nestlingjs/common.graphs`, `@nestlingjs/common.misc`,
  `@nestlingjs/common.static-server`. Каталоги остаются прежними, поэтому
  связь «имя пакета — каталог» перестаёт выводиться из скоупа там, где
  выводилась: `moduleNameMapper` в `jest.config.base.js` и `workspaceDirOf`
  в тесте границы. *(выполнено)*
- Манифест публикуемого пакета получает `files`, `publishConfig.access`,
  `engines`, `repository` с `directory`, `homepage`, `bugs`, `author` и
  `keywords`. Битые `main: "dist/out.js"` убираются: точку входа задаёт
  `exports`. Пустые `description` заполняются.
- В корне появляется `LICENSE` (MIT).
- Условие `"testing"` называется в README `@nestlingjs/testing` и в главе
  гайда про тесты: без `--conditions=testing` установивший пакет получает
  `ERR_PACKAGE_PATH_NOT_EXPORTED` и никакого объяснения.
- Появляется проверка упаковки установкой: тарболы всех пакетов ставятся в
  пустой проект вне репозитория и импортируются оттуда. `scripts/smoke.mjs`
  этого не ловит — он грузит `dist` на месте, не проверяя ни `files`, ни
  подстановку версий вместо `workspace:*`.
- Публикация выполняется GitHub Actions по тегу `v*`: сборка, `yarn verify`,
  проверка упаковки, `lerna publish from-package` с provenance через OIDC.
  `lerna.json` очищается от чужих значений (`version: 1.50.0`,
  `tagVersionPrefix: "teamc."`) и переходит на общую версию `0.1.0`.
- Расхождение `packageManager` в корневом манифесте и `yarnPath` в
  `.yarnrc.yml` устраняется.

## Capabilities

### New Capabilities

- `package-publication`: что публикуемый пакет обязан нести в манифесте, что
  попадает в тарбол, чем проверяется пригодность к установке и кто
  выполняет публикацию.

### Modified Capabilities

- `packages-layout`: имена пакетов живут в одном скоупе `@nestlingjs`;
  внутренний пакет отличается префиксом `common.` в имени, а не скоупом;
  каталог пакета из его имени не выводится.
- `testing-subpath-convention`: условие `"testing"` названо в README пакета
  и в главе гайда — включить его должен уметь не только репозиторий, но и
  потребитель.
- `docs-package-readme`: плашка статуса различает публичный и внутренний
  пакет по имени пакета, а не по его скоупу.

## Non-goals

- **Публикация `@nestlingjs/viz`.** У него нет `exports`, есть `bin` и
  собранная статика фронтенда; состав его тарбола проверяется отдельно.
- **Английские README.** Язык выбран русским осознанно
  ([ideas.md [2026-09-05]](../../../docs/decisions/ideas.md)); английская
  версия — отдельная задача, если появится внешняя аудитория.
- **Перевод `zod` в `peerDependencies` у `@nestlingjs/transport.http`.**
  Вопрос открыт записью и решается замером, а не вместе с упаковкой.
- **Автоматическое версионирование по conventional commits.** Версию
  поднимает человек, тег ставит человек; CI только публикует уже собранное.
- **Публикация сайта документации.** Это change `docs-publish` (#61
  roadmap), у него свой триггер и свои инварианты.
- **Английский `CHANGELOG` и релизные заметки GitHub.** Первый релиз
  обходится тегом.

## Impact

- Манифесты `packages/*/package.json` — все восемнадцать.
- Корень: `LICENSE`, `lerna.json`, `package.json`, `.yarnrc.yml`.
- `.github/workflows/` — новый workflow публикации.
- `scripts/` — проверка установки из тарбола, вызов её из `yarn verify` или
  отдельной командой.
- Документация: README `@nestlingjs/testing`, глава гайда про тесты,
  `docs/README.md`, запись `ideas.md [2026-09-10]`, `roadmap.md`.
- Спеки: новая `package-publication`, дельты `packages-layout`,
  `testing-subpath-convention`, `docs-package-readme`.
