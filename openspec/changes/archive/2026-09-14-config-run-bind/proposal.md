## Why

Привязки конфигурации сегодня объявляются полем `config:` у `makeApp`, хотя
состав процесса они не определяют никогда — это дело аргумента сборки.
Синтаксис `makeApp({ config: [...] })` утверждает обратное, и три места кода
несут цену этого расхождения: `packages/nestling.app/src/config/reader.ts`
безусловно дочитывает `process.env` последним шагом (`#lookup`), даже когда
привязки его не называли, — тест с `vars({...})` не герметичен; каждый
источник читает свои координаты сам из `process.env` внутри `init()`, а не
получает их аргументом; `ConfigInput` — объединение трёх форм
(`ConfigSource | ConfigBinding | ConfigBinding[]`), и `isBinding()` внутри
`config/source.ts` угадывает форму по структуре массива вместо разбора
декларации. `dotenv()` при этом упомянут в JSDoc трёх пакетов, но нигде не
реализован.

Решение зафиксировано записью
[ideas.md [2026-09-13]](../../../docs/decisions/ideas.md) «Конфигурация:
привязки на `run()`, `env()` и `dotenv()` умолчанием, `bind()`, `needs` у
источника», пп. 1–5, 9–10 (строка 186
[roadmap](../../../docs/decisions/roadmap.md), change 90): привязки
принимает метод, который заводит машину (`run`), а не декларация. Пункты
6–8 той же записи — про `needs` источника, `watch`/`retries` и Vault — идут
отдельным change `config-source-needs` (roadmap 92) и в этот change не
входят.

## What Changes

- **BREAKING** Поле `config:` у `makeApp` удаляется. Привязки принимает
  `app.assemble(args).run({ config })`; та же форма опции у уже существующих
  `check(args, { config })` и `assembleTest(app, { config })` — они меняются
  только тем, что опция описана одним способом, а не собственным разбором.
  `discover()` конфига не читает и не принимает.
- Без опции `run()` использует умолчание `defaultSources` — публичное
  значение `[bind(env()), bind(dotenv('.env'), { optional: true })]`:
  окружение выше файла, файл необязателен. Приложение достраивает список
  поверх умолчания (например, Vault), а не переписывает его. У тестового
  корня умолчания нет — герметичность по построению, не по соглашению.
- **BREAKING** Одна форма привязки — `bind(source, { keys?, optional?,
  timeout? })`. `keys` — `ConfigKeys<Prefix>` секции или глоб, по умолчанию
  `'*'` (источник отвечает за любой ключ любой секции, как раньше отвечал
  неявный хвост `process.env`). `optional` — источник не поднялся, привязка
  пропускается вместо отказа фазы 0. `timeout` — граница ввода-вывода
  `init()`, по умолчанию 10 секунд, отказ называет источник. Кортеж
  `[source, target]`, объединение форм `ConfigInput`, `isBinding()` и
  `toBindings()` удаляются.
- `env(options?)` — обычный источник без исключений: `process.env` больше не
  читается ядром нигде, кроме как внутри `env()`. Хвост `#lookup()` в
  `reader.ts` и запись `'process.env'` в диагностике `sources` удаляются.
- Новый источник ядра `dotenv(path)` на `node:util` `parseEnv` (Node 24, без
  зависимости). Отсутствие файла — отказ фазы 0 с путём в сообщении, если
  привязка не `optional`.
- **BREAKING** `objectSource`/`ObjectSource` переезжают из
  `@nestlingjs/app` в `@nestlingjs/testing` как реализация `vars(values,
  name?)` — сегодня `vars()` лишь тонкая обёртка над импортом из ядра, после
  change'а реализация целиком в `testing`. Публичный экспорт `objectSource`/
  `ObjectSource` из `@nestlingjs/app` удаляется; интерфейс `ConfigSource`
  остаётся публичным в ядре.
- Тестовое приложение переходит в RUN: `testApp.run()` продолжает фазы после
  WIRE, где сегодня тестовый шов останавливается, сокет открывается.
  `IListener` получает необязательную способность `baseUrl?(): string` —
  протокол-специфичный листенер (`HttpServer`) её реализует, ядро не знает
  схемы адреса. `testApp.baseUrl(name?)` резолвит нужный листенер: без
  аргумента — когда сервер один, с именем — когда серверов несколько или имя
  сервера не совпадает с единственным; отсутствие способности `baseUrl` у
  листенера или отсутствие названного сервера — явный отказ с именами
  доступных серверов.
- `examples/microservice/e2e/helpers/create-test-app.ts` удаляется: вызовы
  переходят на `assembleTest(app, { config }).run()` + `testApp.baseUrl()`.
  `DeclareOptions.httpPort` в `examples/modular-app/src/app.ts` и его
  привязка через `objectSource({ HTTP_PORT: ... })` удаляются вместе с
  зависимыми местами (`graph.ts`, `split.spec.ts`, `metrics.spec.ts`).
- `docs/guarantees.md` — новая строка: состав процесса определяет только
  аргумент сборки, конфигурация на него не влияет.
- Записи `ideas.md` «[2026-09-06] Фаза 0 BOOTSTRAP» и «[2026-09-06] Конфиг:
  derived, `env({ prefix })`» получают пометку «СУПЕРСИД» в части «`process.env`
  как источник по умолчанию» и «координаты источника из `init()`» — решение
  этого change их замещает.

## Capabilities

### New Capabilities

Новых способностей нет.

### Modified Capabilities

- `config-sources-binding`: привязка перестаёт быть полем `makeApp` и
  становится опцией `run()`/`check()`/`assembleTest()`; `process.env`
  перестаёт быть источником с неявным низшим приоритетом читалки и
  становится обычным источником `env()`; одна форма
  `bind(source, options)` вместо трёх форм `ConfigInput`.
- `composition-root`: поле `config` удаляется из перечня полей `makeApp` и
  из требования «Привязки конфига объявляются в `makeApp`» — требование
  переносится на `run()`.
- `test-composition-root`: `assembleTest` перестаёт быть единственной
  остановкой после WIRE — `testApp.run()` переходит в RUN; добавляется
  `testApp.baseUrl(name?)`; опция `config` теряет три формы и принимает
  список `bind(source, options)`, как `run()` боевого корня.
- `structural-check`: опция `config` у `check()` теряет три формы и
  принимает список `bind(source, options)`; без опции `check()` поднимает
  `defaultSources` — источники декларации, на которые опиралось прежнее
  умолчание, у декларации больше нет.
- `health-probes`: пример привязки `healthConfigKeys` в требовании о секции
  `nestlingHealth` переписывается с поля `config` у `makeApp` на опцию
  `config` у `run()`; право пакета отдавать `healthConfigKeys` не меняется.

## Impact

**Код.** `packages/nestling.app`: `config/source.ts` (`bind`, `dotenv`,
удаление `objectSource`/`ObjectSource`/`isBinding`/`toBindings`),
`config/reader.ts` (удаление хвоста `process.env` и записи `sources`),
`config/kernel.ts` (`bootstrapConfig` принимает список привязок явным
аргументом фазы 0, а не читает `plan.config`), `root/plan.ts` (поле `config`
уходит из `AppSpecCommon`/`NormalizedAppSpec`/`APP_SPEC_FIELDS`),
`root/app.ts` (`AssembledApp.run(options?: { config? })`, `TEST_SEAM`
переходит в RUN, `baseUrl(name?)`), `transport/interfaces.ts` (`IListener.
baseUrl?()`). `packages/nestling.transport.http`: `HttpServer.baseUrl()`
поверх уже существующего `address()`. `packages/nestling.testing`:
`config.ts` (`vars`/`set`/`assign` — реализация, а не обёртка).
`packages/nestling.app/src/health/config.ts` — пример привязки
`healthConfigKeys` в JSDoc.

**Примеры.** `examples/microservice/e2e/helpers/create-test-app.ts` удалён,
вызывающие места переведены на `assembleTest` + `testApp.baseUrl()`.
`examples/modular-app/src/app.ts`, `graph.ts`, `split.spec.ts`,
`metrics.spec.ts` — без `DeclareOptions.httpPort`.

**Документация.** `docs/design/config.md` §3 (часть, относящаяся к этому
change, без `argv()` — он change 91), `docs/guarantees.md`, README пакетов
`nestling.app` и `nestling.testing` на обоих языках (список публичных
экспортов config), `docs/decisions/ideas.md` (пометки СУПЕРСИД).

Старое API (`config:` у `makeApp`, `objectSource` в ядре, три формы
`ConfigInput`, неявный хвост `process.env`) удаляется целиком, без
промежуточных обёрток.

## Non-goals

- `needs` у `ConfigSource`, топологический порядок подъёма источников по
  секциям, опции `watch`/`retries`, сателлит `@nestlingjs/config.vault` —
  change `config-source-needs` (roadmap 92), пп. 6–8 записи ideas.md.
- `argv(process.argv)` как аргумент сборки, уход `RootConfig`/`load()` из
  примеров — change `argv-args` (roadmap 91). Примеры этого change используют
  `assemble(args)` без `argv()`.
- Переименование `assemble` → `build` — независимый change `terminology`
  (roadmap 86) в отдельной ветке. Этот change держит текущие имена
  (`assemble`, `assembleTest`, `AssembledApp`) и получит переименование
  автоматически при rebase на `main` после слияния `terminology`.
- Транспорты, кроме HTTP: `baseUrl?()` у `IListener` — способность, которую
  сегодня реализует только `HttpServer`; протокол WS/gRPC (roadmap 98, 99) не
  реализован и вне этого change.
