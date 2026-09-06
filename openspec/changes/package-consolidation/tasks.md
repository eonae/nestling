## 1. Подготовка: разорвать будущий цикл в графе проектов

- [x] 1.1 Завести фикстуру транспорта в `packages/nestling.app/src/__fixtures__/test-transport.ts`: токен транспорта, конструктор декларации поверх `makeEndpoint`, значение `capabilities`
- [x] 1.2 Перевести на неё одиннадцать спеков `@nestling/app` (`app`, `boundary`, `capabilities`, `check`, `config`, `discovery`, `discovery-token`, `operations`, `policies`, `ports`, `selection`)
- [x] 1.3 Утверждения, проверяющие поведение самого HTTP-транспорта, перенести в спеки `@nestling/transport.http`
- [x] 1.4 Убрать `@nestling/transport.http` и `@nestling/transport.cli` из `devDependencies` пакета `app`
- [x] 1.5 `yarn verify` зелёный

## 2. `streams` в `@nestling/operations`

- [x] 2.1 `git mv packages/nestling.streams/src` → `packages/nestling.operations/src/streams`, баррель каталога сохранён
- [x] 2.2 Экспорты `streams` подняты в `packages/nestling.operations/src/index.ts`
- [x] 2.3 Импорты `@nestling/streams` переписаны на `@nestling/operations` в `packages/`, `examples/`, `scripts/`
- [x] 2.4 Каталог `packages/nestling.streams` удалён; `@nestling/streams` убран из манифестов
- [x] 2.5 Тест границы `@nestling/operations` зелёный без правки списка разрешённых импортов
- [x] 2.6 `yarn verify` зелёный

## 3. `ports` в `@nestling/app`

- [x] 3.1 Собственный код `app` перенесён `git mv` из `src/*.ts` в `src/root/`, заведён баррель `src/root/index.ts`
- [x] 3.2 `packages/nestling.ports/src` перенесён в `packages/nestling.app/src/ports`
- [x] 3.3 Экспорты портов подняты в `src/index.ts`; дублирующий реэкспорт `Timeout` в слое портов удалён
- [x] 3.4 Импорты `@nestling/ports` переписаны на `@nestling/app` в `packages/`, `examples/`
- [x] 3.5 Каталог `packages/nestling.ports` удалён; манифесты потребителей обновлены
- [x] 3.6 `yarn verify` зелёный

## 4. `transport` в `@nestling/app`

- [x] 4.1 `packages/nestling.transport/src` перенесён в `packages/nestling.app/src/transport`
- [x] 4.2 Экспорты подняты в `src/index.ts`; дублирующие реэкспорты `transportNameOf` и `TransportCapabilities` удалены
- [x] 4.3 Импорты `@nestling/transport` переписаны на `@nestling/app`
- [x] 4.4 Каталог `packages/nestling.transport` удалён; манифесты потребителей обновлены
- [x] 4.5 `yarn verify` зелёный

## 5. `config` в `@nestling/app`

- [x] 5.1 `packages/nestling.config/src` перенесён в `packages/nestling.app/src/config`
- [x] 5.2 Экспорты подняты в `src/index.ts`; дублирующие реэкспорты `ConfigBinding` и `ConfigTarget` в корне удалены
- [x] 5.3 Импорты `@nestling/config` переписаны на `@nestling/app`
- [x] 5.4 Каталог `packages/nestling.config` удалён; манифесты потребителей обновлены
- [x] 5.5 `yarn verify` зелёный

## 6. `pipeline` в `@nestling/app`

- [x] 6.1 `packages/nestling.pipeline/src` перенесён в `packages/nestling.app/src/pipeline`
- [x] 6.2 Экспорты подняты в `src/index.ts`
- [x] 6.3 `packages/nestling.pipeline/type-tests` перенесён в `packages/nestling.app/type-tests`; `tsconfig.json` пакета `app` включает `type-tests` и исключает `type-tests/fixtures`
- [x] 6.4 Скрипт `type-budget` перенесён в `packages/nestling.app/package.json`; пороги и снапшоты диагностик прогнаны заново
- [x] 6.5 Импорты `@nestling/pipeline` переписаны на `@nestling/app`
- [x] 6.6 Каталог `packages/nestling.pipeline` удалён; манифесты потребителей обновлены
- [x] 6.7 `yarn verify` зелёный

## 7. Направление зависимостей и границы

- [x] 7.1 В `packages/nestling.app/eslint.config.js` добавлены блоки по `files` с `no-restricted-imports`: зоны `pipeline`, `config`, `transport`, `ports` по таблице из `design.md`
- [x] 7.2 Проверено, что запрещённый импорт валит `yarn lint` пакета, а разрешённый проходит
- [x] 7.3 Тест `@nestling/subscriptions` проверяет список имён, импортируемых из `@nestling/app`: `assemble`, объявления фичи и плагина в нём нет
- [x] 7.4 Списки разрешённых импортов в тестах границы `operations`, `client`, `openapi` сверены с фактическими
- [x] 7.5 `yarn verify:fresh` зелёный один раз после последнего слияния

## 8. Примеры

- [x] 8.1 Импорты и манифесты шести примеров `examples/*` переписаны на три имени плюс транспорт
- [x] 8.2 `node scripts/smoke.mjs` проходит; ни один пример не тянет исчезнувшее имя

## 9. Документация

- [x] 9.1 README сливаемых пакетов сложены в `packages/nestling.app/README.md` и `packages/nestling.operations/README.md`; плашки статуса обновлены
- [x] 9.2 README пакетов-потребителей (`testing`, `subscriptions`, `transport.http`, `transport.cli`, `transport.nats`, `common.misc`) названы новыми именами
- [x] 9.3 Таблицы пакетов в `docs/README.md` перестроены на 17 каталогов
- [x] 9.4 `docs/glossary.md`, `docs/design/operations.md`, `docs/design/streaming.md`, `docs/design/transports.md` обновлены
- [x] 9.5 Девять глав гайда обновлены (`04`, `06`, `08`, `09`, `13`, `14`, `16`, `25`, приложение А), дата в плашке «сверено с кодом» поднята
- [x] 9.6 `node .claude/skills/docs-style/scripts/lint.mjs` по изменённым текстам — 0 запрещённых слов

## 10. Спеки

- [x] 10.1 Разделы `## Purpose` в `openspec/specs/{contracts-package-boundary,config-reloadable,endpoint-type-diagnostics,event-sources-topic,message-bus}/spec.md` названы новыми именами пакетов — дельты покрывают только требования
- [x] 10.2 `openspec validate package-consolidation --strict` проходит

## 11. Definition of Done

- [x] 11.1 Все задачи выше отмечены
- [x] 11.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` + `type-budget` по всем пакетам плюс smoke)
- [x] 11.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 11.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [x] 11.5 `yarn docs:audit` — 0 ERROR
- [x] 11.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с обновлённой датой в плашке «сверено с кодом»
- [ ] 11.7 Коммиты осмысленные, ветка `change/package-consolidation` запушена
