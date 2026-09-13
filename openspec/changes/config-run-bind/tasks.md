## 1. `@nestlingjs/app` — источники и `bind()`

- [ ] 1.1 Реализовать `bind(source, { keys?, optional?, timeout? })`;
      удалить `ConfigInput`, `isBinding()`, `toBindings()` и кортежную
      форму `[source, target]` из `config/source.ts`
- [ ] 1.2 Реализовать `dotenv(path)` на `util.parseEnv` (Node 24, без
      зависимости); отсутствие файла — отказ фазы 0 с путём в сообщении,
      если привязка не `optional`
- [ ] 1.3 Перевести координаты источника с чтения `process.env` в `init()`
      на аргумент конструктора; `env()` остаётся источником с префиксом,
      без `init`/`watch`/`close`
- [ ] 1.4 Удалить хвост `process.env` и запись `'process.env'` в
      диагностике `sources` (`config/reader.ts`: `#lookup()`, `get
      sources()`)
- [ ] 1.5 Экспортировать `defaultSources = [bind(env()), bind(dotenv('.env'), { optional: true })]`
      из `@nestlingjs/app`
- [ ] 1.6 Удалить поле `config` из `AppSpecCommon`, `NormalizedAppSpec` и
      `APP_SPEC_FIELDS` (`root/plan.ts`)
- [ ] 1.7 `config/kernel.ts`: `bootstrapConfig` принимает список привязок
      аргументом фазы 0, а не читает `plan.config`

## 2. `@nestlingjs/app` — `run()`, `check()`, `assembleTest()`, `baseUrl`

- [ ] 2.1 `AssembledApp.run(options?: { config? })` — опция заменяет
      `defaultSources` целиком (`root/app.ts`)
- [ ] 2.2 `check(args?, options?)` — `options.config` разбирается тем же
      кодом, что и `run()`; без опции поднимает `defaultSources`
- [ ] 2.3 `TEST_SEAM`/`assembleTest`: `options.config` — тот же список
      `bind()`, умолчания нет вовсе (герметичность по построению)
- [ ] 2.4 `IListener.baseUrl?(): string` — необязательная способность
      (`transport/interfaces.ts`)
- [ ] 2.5 `TestApp.run()`: довести фазы `START`/`RUN` без установки
      обработчиков `SIGTERM`/`SIGINT` и без строки состава в stdout
- [ ] 2.6 `TestApp.baseUrl(name?)`: резолв листенера — один сервер без
      имени, явный отказ на нуле/нескольких серверах без имени, на
      отсутствующем имени, на отсутствии способности `baseUrl?()`
- [ ] 2.7 `TestApp.close()`/`Symbol.asyncDispose`: `drain()` открытых
      листенеров, если `run()` был вызван; идемпотентность сохраняется

## 3. `@nestlingjs/testing` — `vars()` как собственная реализация

- [ ] 3.1 Перенести реализацию `objectSource`/`ObjectSource` из
      `@nestlingjs/app` в `packages/nestling.testing/src/config.ts` как
      `vars(values, name?)` с `set`/`assign`
- [ ] 3.2 Удалить публичный экспорт `objectSource`/`ObjectSource` из
      `@nestlingjs/app` (`config/index.ts`)

## 4. `@nestlingjs/transport.http` — `HttpServer.baseUrl()`

- [ ] 4.1 `HttpServer.baseUrl(): string` поверх уже существующего
      `address()`

## 5. Примеры

- [ ] 5.1 Удалить `examples/microservice/e2e/helpers/create-test-app.ts`;
      перевести вызывающие места на `assembleTest(app, { config }).run()`
      + `testApp.baseUrl()`
- [ ] 5.2 Убрать `DeclareOptions.httpPort` из
      `examples/modular-app/src/app.ts` и зависимые места (`graph.ts`,
      `split.spec.ts`, `metrics.spec.ts`)

## 6. Тесты

- [ ] 6.1 Обновить `config/source.spec.ts`, `config/reader.spec.ts`,
      `config/kernel.spec.ts` под `bind`/`dotenv`/`defaultSources`; убрать
      тесты `isBinding`/`toBindings`/кортежной формы
- [ ] 6.2 Тесты `run({ config })`/`check(args, { config })`/
      `assembleTest(app, { config })`: приоритет списка, `keys`,
      `optional`, `timeout`, умолчание `defaultSources`
- [ ] 6.3 Тесты `testApp.run()`/`testApp.baseUrl(name?)`: один сервер,
      несколько серверов, листенер без способности `baseUrl?()`, вызов до
      `run()`
- [ ] 6.4 e2e `examples/microservice` зелёный на новом хелпере без
      `create-test-app.ts`

## 7. Документация

- [ ] 7.1 `docs/guarantees.md` — строка: состав процесса определяет
      только аргумент сборки, конфигурация на него не влияет
- [ ] 7.2 README `packages/nestling.app` (RU/EN) — список экспортов
      config: без `ConfigInput`/`objectSource`/`ObjectSource`/
      `toBindings`, с `bind`/`dotenv`/`defaultSources`
- [ ] 7.3 README `packages/nestling.testing` (RU/EN) — `vars()` описан как
      собственная реализация, не обёртка
- [ ] 7.4 `docs/design/config.md` §3 — пометить, какая часть реализована
      этим change'ем, а какая (`needs`, `argv()`) ещё нет
- [ ] 7.5 `docs/decisions/ideas.md` — пометки «СУПЕРСИД» записям
      «[2026-09-06] Фаза 0 BOOTSTRAP» и «[2026-09-06] Конфиг: `derived`,
      `env({ prefix })`» в заменённой части
- [ ] 7.6 `docs/decisions/ideas.md` — запись «[2026-09-13] Конфигурация:
      привязки на `run()`…» помечена «РЕАЛИЗОВАНО»: что вышло (пп. 1–5,
      9–10), что уехало в `config-source-needs` (пп. 6–8), чем реализация
      уточнила решение (форма `baseUrl(name?)`, умолчание `check()` без
      `config`)

## 8. Definition of Done

- [ ] 8.1 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` +
      `type-budget` по всем пакетам)
- [ ] 8.2 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 8.3 `design/` и `decisions/` синхронизированы по правилам
      `CLAUDE.md`
- [ ] 8.4 запись `ideas.md`, по которой шёл change, несёт пометку
      «РЕАЛИЗОВАНО»
- [ ] 8.5 `yarn docs:audit` — 0 ERROR
- [ ] 8.6 затронутые `examples/*` мигрированы, гайды пересверены с
      обновлённой датой в плашке «сверено с кодом»
- [ ] 8.7 `main` не тронут — слияние делает Merger после `/opsx:archive`
