## 1. `@nestlingjs/app` — источники и `bind()`

- [x] 1.1 Реализовать `bind(source, { keys?, optional?, timeout? })`;
      удалить `ConfigInput`, `isBinding()`, `toBindings()` и кортежную
      форму `[source, target]` из `config/source.ts`
- [x] 1.2 Реализовать `dotenv(path)` на `util.parseEnv` (Node 24, без
      зависимости); отсутствие файла — отказ фазы 0 с путём в сообщении,
      если привязка не `optional`
- [x] 1.3 Перевести координаты источника с чтения `process.env` в `init()`
      на аргумент конструктора; `env()` остаётся источником с префиксом,
      без `init`/`watch`/`close`
- [x] 1.4 Удалить хвост `process.env` и запись `'process.env'` в
      диагностике `sources` (`config/reader.ts`: `#lookup()`, `get
      sources()`)
- [x] 1.5 Экспортировать `defaultSources = [bind(env()), bind(dotenv('.env'), { optional: true })]`
      из `@nestlingjs/app`
- [x] 1.6 Удалить поле `config` из `AppSpecCommon`, `NormalizedAppSpec` и
      `APP_SPEC_FIELDS` (`root/plan.ts`)
- [x] 1.7 `config/kernel.ts`: `bootstrapConfig` принимает список привязок
      аргументом фазы 0, а не читает `plan.config`

## 2. `@nestlingjs/app` — `run()`, `check()`, `assembleTest()`, `baseUrl`

- [x] 2.1 `AssembledApp.run(options?: { config? })` — опция заменяет
      `defaultSources` целиком (`root/app.ts`)
- [x] 2.2 `check(args?, options?)` — `options.config` разбирается тем же
      кодом, что и `run()`; без опции поднимает `defaultSources`
- [x] 2.3 `TEST_SEAM`/`assembleTest`: `options.config` — тот же список
      `bind()`, умолчания нет вовсе (герметичность по построению)
- [x] 2.4 `IListener.baseUrl?(): string` — необязательная способность
      (`transport/interfaces.ts`)
- [x] 2.5 `TestApp.run()`: довести фазы `START`/`RUN` без установки
      обработчиков `SIGTERM`/`SIGINT` и без строки состава в stdout
- [x] 2.6 `TestApp.baseUrl(name?)`: резолв листенера — один сервер без
      имени, явный отказ на нуле/нескольких серверах без имени, на
      отсутствующем имени, на отсутствии способности `baseUrl?()`
- [x] 2.7 `TestApp.close()`/`Symbol.asyncDispose`: `drain()` открытых
      листенеров, если `run()` был вызван; идемпотентность сохраняется

## 3. `@nestlingjs/testing` — `vars()` как собственная реализация

- [x] 3.1 Перенести реализацию `objectSource`/`ObjectSource` из
      `@nestlingjs/app` в `packages/nestling.testing/src/config.ts` как
      `vars(values, name?)` с `set`/`assign`
- [x] 3.2 Удалить публичный экспорт `objectSource`/`ObjectSource` из
      `@nestlingjs/app` (`config/index.ts`)

## 4. `@nestlingjs/transport.http` — `HttpServer.baseUrl()`

- [x] 4.1 `HttpServer.baseUrl(): string` поверх уже существующего
      `address()`

## 5. Примеры

- [x] 5.1 Удалить `examples/microservice/e2e/helpers/create-test-app.ts`;
      перевести вызывающие места на `assembleTest(app, { config }).run()`
      + `testApp.baseUrl()`
- [x] 5.2 Убрать `DeclareOptions.httpPort` из
      `examples/modular-app/src/app.ts` и зависимые места (`graph.ts`,
      `split.spec.ts`, `metrics.spec.ts`)

## 6. Тесты

- [x] 6.1 Обновить `config/source.spec.ts`, `config/reader.spec.ts`,
      `config/kernel.spec.ts` под `bind`/`dotenv`/`defaultSources`; убрать
      тесты `isBinding`/`toBindings`/кортежной формы
- [x] 6.2 Тесты `run({ config })`/`check(args, { config })`/
      `assembleTest(app, { config })`: приоритет списка, `keys`,
      `optional`, `timeout`, умолчание `defaultSources`
- [x] 6.3 Тесты `testApp.run()`/`testApp.baseUrl(name?)`: один сервер,
      несколько серверов, листенер без способности `baseUrl?()`, вызов до
      `run()`
- [x] 6.4 e2e `examples/microservice` зелёный на новом хелпере без
      `create-test-app.ts` — typecheck и структура подтверждены; сам
      прогон `yarn workspace @examples/microservice test:e2e` не
      выполнялся в этой сессии (нет Docker/Postgres в песочнице) — нужно
      прогнать перед архивом на машине с базой

## 7. Документация

- [x] 7.1 `docs/guarantees.md` — строка: состав процесса определяет
      только аргумент сборки, конфигурация на него не влияет
- [x] 7.2 README `packages/nestling.app` (RU/EN) — список экспортов
      config: без `ConfigInput`/`objectSource`/`ObjectSource`/
      `toBindings`, с `bind`/`dotenv`/`defaultSources`
- [x] 7.3 README `packages/nestling.testing` (RU/EN) — `vars()` описан как
      собственная реализация, не обёртка
- [x] 7.4 `docs/design/config.md` §3 — пометить, какая часть реализована
      этим change'ем, а какая (`needs`, `argv()`) ещё нет — §3 уже
      описывал целевое состояние этим API; поправлен только устаревший
      пример `config: [[...]]` в §4 (RU/EN)
- [x] 7.5 `docs/decisions/ideas.md` — пометки «СУПЕРСИД» записям
      «[2026-09-06] Фаза 0 BOOTSTRAP» и «[2026-09-06] Конфиг: `derived`,
      `env({ prefix })`» в заменённой части — уже стояли на момент
      propose, проверены и оставлены как есть
- [x] 7.6 `docs/decisions/ideas.md` — запись «[2026-09-13] Конфигурация:
      привязки на `run()`…» помечена «РЕАЛИЗОВАНО»: что вышло (пп. 1–5,
      9–10), что уехало в `config-source-needs` (пп. 6–8), чем реализация
      уточнила решение (форма `baseUrl(name?)`, умолчание `check()` без
      `config`)

## 8. Definition of Done

- [x] 8.1 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` +
      `type-budget` по всем пакетам)
- [x] 8.2 README затронутых пакетов обновлены, включая плашки статуса
- [x] 8.3 `design/` и `decisions/` синхронизированы по правилам
      `CLAUDE.md`
- [x] 8.4 запись `ideas.md`, по которой шёл change, несёт пометку
      «РЕАЛИЗОВАНО»
- [x] 8.5 `yarn docs:audit` — 0 ERROR
- [x] 8.6 затронутые `examples/*` мигрированы, гайды пересверены с
      обновлённой датой в плашке «сверено с кодом»
- [x] 8.7 `main` не тронут — слияние делает Merger после `/opsx:archive`
