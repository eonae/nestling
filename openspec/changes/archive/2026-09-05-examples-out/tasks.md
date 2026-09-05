## 1. Перенос каталогов и манифесты

- [x] 1.1 `git mv` шести каталогов: `packages/examples.app-with-http` →
  `examples/app-with-http`, `packages/examples.container` →
  `examples/container`, `packages/examples.simple-cli` →
  `examples/simple-cli`, `packages/examples.simple-http-server` →
  `examples/simple-http-server`, `packages/examples.split-nats` →
  `examples/split-nats`, `packages/examples.users-service` →
  `examples/users-service`
- [x] 1.2 В каждом `examples/<name>/package.json`: имя →
  `@examples/<name>`, добавлен `"private": true` (сегодня его нет у
  `container`, `simple-cli`, `simple-http-server`)
- [x] 1.3 Корневой `package.json`: `workspaces` получает `"examples/*"`
- [x] 1.4 `yarn install` — workspaces перечитаны, симлинки
  `node_modules/examples.*` заменены на `node_modules/@examples/*`
- [x] 1.5 Проверить, что конфиги примеров не потребовали правки: во всех
  шести `tsconfig.json`, `jest.config.js`, `eslint.config.js` и
  `esbuild.config.js` пути `../../…` остались верными (design D1)
- [x] 1.6 `examples/app-with-http/jest.e2e.config.js`: `displayName` →
  `@examples/app-with-http:e2e`

## 2. Ссылки внутри примеров

- [x] 2.1 `examples/users-service/src/api/client.ts` и
  `examples/app-with-http/src/api/client.ts`: команда в JSDoc →
  `yarn workspace @examples/<name> client`
- [x] 2.2 `examples/simple-cli/src/commands/help.command.ts` (две строки)
  и `process-stdin.command.ts`: команды в тексте помощи и JSDoc →
  `yarn workspace @examples/simple-cli …`

## 3. Инструменты

- [x] 3.1 `scripts/smoke.mjs`: снят фильтр по префиксу `examples.`
  (строка 28); комментарий в шапке отражает, что примеры в `packages/`
  больше не лежат
- [x] 3.2 `.claude/skills/docs-audit/scripts/check.mjs:88`: пример из
  плашки резолвится как `examples/<name>`; тексты ERROR и WARN называют
  новый путь
- [x] 3.3 `scripts/preview/build.mjs`: комментарий про формат подписи
  сниппета (строка 94) называет новый путь

## 4. Главы гайда

- [x] 4.1 Подписи блоков кода: 278 строк
  `// packages/examples.<name>/…` → `// examples/<name>/…` во всех главах
  и приложениях
- [x] 4.2 Плашки «сверено с кодом»: имя примера без префикса
  (`` `users-service` `` вместо `` `examples.users-service` ``) в 25
  главах
- [x] 4.3 Плашки «сверено с кодом»: дата сверки во всех главах — дата
  переезда (design D3: `git log` по новому пути начинается с неё, иначе
  `docs:audit` даёт WARN по каждой главе)
- [x] 4.4 Команды запуска: 43 вхождения
  `yarn workspace examples.<name> …` → `yarn workspace @examples/<name> …`
  в главах, обоих README и приложениях
- [x] 4.5 `docs/guide/README.md`, `docs/guide/appendix-a-alternatives.md`,
  `docs/guide/appendix-c-coverage.md`: ссылки и имена примеров

## 5. Остальная документация

- [x] 5.1 `README.md` и `README.ru.md`: таблица примеров — ссылки
  `./examples/<name>/` и короткие имена; раздел Development («packages
  live in `packages/`») называет и `examples/`
- [x] 5.2 `docs/README.md`: карта каталогов и упоминание
  `packages/examples.*` в разделе про README пакетов
- [x] 5.3 `CLAUDE.md`: карта `docs/`, пункт 5 «Обязанности держать доки в
  синхроне», пункт 6 Definition of Done
- [x] 5.4 `docs/conventions.md` и `docs/design/composition.md`: ссылки на
  примеры
- [x] 5.5 `packages/nestling.viz/README.md:25`: ссылка
  `../examples.container/` → `../../examples/container/`

## 6. Спеки и roadmap

- [x] 6.1 Дельта `specs/docs-preview-guide/spec.md` применена к
  `openspec/specs/docs-preview-guide/spec.md` при синхронизации
- [x] 6.2 Новая спека `openspec/specs/examples-layout/spec.md` создана из
  дельты
- [x] 6.3 `docs/decisions/roadmap.md`: строка change'а 39 `examples-out`
  со ссылкой на архив после закрытия; записи `ideas.md`, `archlog.md`,
  `deferred.md` не редактируются (append-only)

## 7. Проверка

- [x] 7.1 `grep -rn "packages/examples" .` не находит вхождений вне
  `docs/history/`, `openspec/changes/archive/` и записей
  `docs/decisions/` — три намеренных исключения (design D5)
- [x] 7.2 `grep -rn "yarn workspace examples\."` не находит вхождений вне
  тех же трёх мест
- [x] 7.3 `yarn verify:fresh` зелёный — сборка, тайпчек, линт, тесты и
  type-budget без nx-кеша, плюс smoke по всем пакетам
- [x] 7.4 `yarn docs:preview` собирается без ошибок; выборочно открыта
  страница главы с подписью сниппета — `data-file` содержит новый путь
- [x] 7.5 `yarn workspace @examples/users-service start:dev` поднимается
  (проверка, что имя пакета и скрипты живы)

## 8. Definition of Done

- [x] 8.1 Все задачи разделов 1–7 отмечены
- [x] 8.2 `yarn verify` зелёный (build + typecheck + lint + test +
  type-budget по всем пакетам, smoke)
- [x] 8.3 README затронутых пакетов обновлены, включая плашки статуса:
  затронут только `packages/nestling.viz/README.md` (ссылка на пример),
  плашки статуса не меняются — состав и API пакетов те же
- [x] 8.4 `design/` и `decisions/` синхронизированы по правилам
  `CLAUDE.md`: `docs/design/composition.md` правится, `decisions/`
  получает только строку в `roadmap.md`
- [x] 8.5 `yarn docs:audit` — 0 ERROR
- [x] 8.6 Примеры мигрированы, главы гайда пересверены с обновлённой
  датой в плашке «сверено с кодом»
- [x] 8.7 Коммиты осмысленные, ветка `change/examples-out` запушена
