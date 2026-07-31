# tasks — features: фичи, `select` и composition root

Порядок работ идёт снизу вверх (контейнер → контракт транспорта → транспорты
→ app → примеры → доки): каждая группа оставляет репозиторий собираемым.

## 1. `@OnStart` в контейнере

- [x] 1.1 Декоратор `@OnStart` и поле `onStart` в `LifecycleMetadata` /
      `LifecycleHooks` (`packages/nestling.container/src/lifecycle/lifecycle.ts`),
      сбор метаданных ровно один раз на метод — как у `@OnInit`/`@OnDestroy`
- [x] 1.2 `BuiltContainer.start()` — обход узлов в топологическом порядке
      (переиспользовать машинерию `init()`), идемпотентность повторного вызова
- [x] 1.3 Рантайм-тесты: порядок `B.onInit → A.onInit → B.onStart → A.onStart`
      для `A → B`; `start()` без хуков; повторный `start()`; ошибка в
      `@OnStart` пробрасывается наружу
- [x] 1.4 Экспорт `@OnStart` из публичного API пакета, JSDoc с указанием
      места фазы (после WIRE, до go-live)

## 2. Контракт транспорта: `Dispatch` и `serve`

- [x] 2.1 `packages/nestling.transport`: тип `RouteDeclaration` — проекция
      декларации без исполнимых полей (`handle`, `pipeline`, `deps`,
      `resolve`), и функция построения проекции из декларации
- [x] 2.2 Тип `Dispatch` (`routes`, `call(pattern, ctx, options?)`) и
      `DispatchOptions` (`exposeErrorDetails`, `onUnknownFail`)
- [x] 2.3 `makeDispatch(endpoints)` — принимает только исполнимые декларации
      (`TNeeds = never`); внутри: индекс `pattern → { declaration, handler }`,
      ветка «с pipeline» (`pipeline.executeWithHandler`) и ветка «без
      pipeline» (парсинг value-формы + прямой вызов хендлера), перенесённая
      из транспортов
- [x] 2.4 `ITransport`: `serve(dispatch, signal): Promise<void>` вместо
      `listen()`; методы `endpoint()`/`route()` убрать из контракта;
      `close?()` сохранить
- [x] 2.5 `TransportToken = TokenString<ITransport>` и хелпер имени
      транспорта из id токена
- [x] 2.6 Рантайм-тесты `makeDispatch`: обе ветки исполнения, отсутствие
      исполнимых полей в `routes`, неизвестный `pattern`, проброс опций
      границы

## 3. Токен транспорта в декларации

- [x] 3.1 `@nestling/pipeline`: поле `transport` декларации типизируется
      токеном (`TransportRef = TokenString<any>`), `Raw.transport` и
      `EndpointMeta.transport` продолжают нести строковое имя, выведенное
      из id токена
- [x] 3.2 `makeEndpoint` принимает токен; `httpEndpoint`/`cliEndpoint`
      проставляют токены своих пакетов
- [x] 3.3 Рантайм-тесты: `meta.transport === 'http'` в слое пайплайна;
      декларация несёт именно токен; два разных транспорта различимы по
      токену
- [x] 3.4 Обновить существующие тесты и фикстуры, сравнивавшие
      `definition.transport` со строкой

## 4. HTTP-транспорт на `serve`

- [x] 4.1 `HttpTransport.serve(dispatch, signal)`: сборка роутера из
      `dispatch.routes`, `assertFormsSupported` по каждому маршруту до
      открытия сокета, подъём сервера, реакция на `signal`
- [x] 4.2 Исполнение ручки — через `dispatch.call(pattern, ctx, options)`;
      сантехника ответа (`sendResponse`, дренаж multipart, классификация
      ошибок входа) остаётся в транспорте
- [x] 4.3 Удалить `listen()`, `route()`/`endpoint()` как публичные точки
      регистрации; порт/хост брать из опций и конфига, а не из аргументов
- [x] 4.4 `address(): { host, port } | null` — фактический адрес после
      go-live, `null` до `serve` и после `close()`
- [x] 4.5 Конфиг-секция транспорта: `makeConfig('http', { port, host })`
      внутри пакета, наружу — только `keys`-хэндл; приоритет «явные опции >
      конфиг > дефолт»
- [x] 4.6 Фабрика провайдера `http(options?)` с токеном транспорта и
      зависимостью от своей конфиг-секции
- [x] 4.7 Мигрировать интеграционные тесты (`transport.integration.spec.ts`,
      `streaming.integration.spec.ts`, `binding.spec.ts`): хелпер `listen()`
      → `serve(makeDispatch([...]), signal)` + `address()`; ожидания по
      проводу не менять
- [x] 4.8 Тесты фабрики-провайдера: порт из `HTTP_PORT`, перекрытие явной
      опцией, fail-fast на невалидном значении

## 5. CLI-транспорт на `serve`

- [x] 5.1 `CliTransport.serve(dispatch, signal)`: команды из
      `dispatch.routes`, проверка форм, single-shot и REPL поверх
      `dispatch.call`
- [x] 5.2 Удалить `listen()`/`endpoint()`; фабрика провайдера `cli(options?)`
      с токеном транспорта
- [x] 5.3 Мигрировать тесты пакета (`cli-endpoint.spec.ts`,
      `streaming.spec.ts`) на `serve` + `makeDispatch`

## 6. Фичи и `select`

- [x] 6.1 `makeFeature({ name, modules, dependsOn? })` в `@nestling/app` —
      значение, без побочных эффектов; `dependsOn` принимает только
      значения-фичи
- [x] 6.2 Резолвер выбора: формы `'all' | 'a,b' | string[]`, транзитивное
      замыкание `dependsOn` с множеством посещённых (цикл легален),
      дедупликация по имени
- [x] 6.3 Fail-fast: неизвестное имя (с перечнем доступных), одноимённые
      фичи, пустой выбор, `select` без `features`
- [x] 6.4 Рантайм-тесты резолвера, включая транзитивную зависимость, не
      перечисленную в `features:`, и взаимную зависимость

## 7. `assemble` и фазовый рантайм `App`

- [x] 7.1 `AssemblySpec` и `assemble(spec): App`; внутренний
      `AssemblyPlan`, тип которого не экспортируется, — конструктор `App`
      перестаёт быть публичной поверхностью
- [x] 7.2 Фаза ASSEMBLE: резолв выбора → дерево модулей (kernel-конфиг,
      `modules:` корня, модули выбранных фич) → `discoverEndpoints` →
      `build()` → сверка транспортных токенов с графом → `assertFormsSupported`
- [x] 7.3 Фаза INIT (`container.init()`), фаза WIRE (гашение зависимостей
      деклараций + `makeDispatch` на каждый транспорт), фаза START
      (`container.start()`, затем `serve(dispatch, signal)` в
      детерминированном порядке)
- [x] 7.4 Фаза SHUTDOWN как строгий реверс: `abort(signal)` → `close()`
      транспортов в обратном порядке → `container.destroy()`; снятие
      обработчиков сигналов; идемпотентность `run()`/`close()`
- [x] 7.5 Строка состава сборки на старте: выбранные фичи и поднятые
      транспорты
- [x] 7.6 `discoverEndpoints`: карта транспортов ключуется токеном; удалить
      сверку с `transports: Record` и сам `AppConfig`
- [x] 7.7 `config:` переезжает в `assemble`; `AppConfig.config` удаляется
- [x] 7.8 Тексты ошибок ASSEMBLE: транспорт не в графе (имя, паттерн,
      модуль, способ починки), незарегистрированная зависимость декларации
      (существующий текст сохранить)
- [x] 7.9 Рантайм-тесты `App`: порядок фаз (`@OnInit` → `@OnStart` →
      `serve`), fail-fast до `@OnInit`, невыбранная фича не строит
      провайдеров и не регистрирует ручек, транспорт без ручек поднимается,
      реверс shutdown, идемпотентность

## 8. Примордиальное чтение конфига (фаза 0)

- [x] 8.1 `load(section)` в `@nestling/config`: синхронное чтение ключей
      секции из `process.env`, валидация схемой, fail-fast; привязанные
      источники не участвуют
- [x] 8.2 Тесты: успешное чтение, невалидное значение, независимость от
      привязок корня

## 9. Примеры

- [x] 9.1 `packages/examples.app-with-http` — на `assemble`; витрина L2:
      две фичи (`users`, `logging`-инфра или аналог по месту) и `select`
      из `load(RootConfig)`
- [x] 9.2 `packages/examples.simple-http-server` — standalone-путь:
      `makeDispatch` + `serve`
- [x] 9.3 `packages/examples.simple-cli` — `makeDispatch` + `serve` для CLI
- [x] 9.4 `packages/examples.simple-app` — на `assemble`, транспорты
      провайдерами
- [x] 9.5 Проверить, что каждый пример запускается (`yarn start` / node) и
      делает ровно то, что описывает его README

## 10. Документация

- [x] 10.1 `docs/design/composition.md` — уточнить §1 (что `dispatch`
      создаётся в WIRE и передаётся в START одним объектом) и §2 (состав
      полей `assemble` на сегодня, без `plugins`/`policies`/`dispatch`)
- [x] 10.2 `docs/design/transports.md` §1 — контракт транспорта по факту:
      `serve(dispatch, signal)`, `routes` как проекция, точка проверки форм
- [x] 10.3 Новый гайд `docs/guides/composition.md` (L0→L2: модули,
      транспорты-провайдеры, фичи и `select`, фазы и `@OnStart`), плашка
      «сверено с кодом `examples.app-with-http` (дата)»
- [x] 10.4 Пересверить гайды `http-app-di.md`, `http-functional.md`,
      `cli.md`, `config.md` с мигрированными примерами; обновить даты в
      плашках
- [x] 10.5 README пакетов `app`, `container`, `transport`, `transport.http`,
      `transport.cli`, `config` — включая плашки статуса
- [x] 10.6 `docs/decisions/roadmap.md` — статус change #10 и оговорка о
      трёх BREAKING-поверхностях в аддитивной волне; запись в `ideas.md`
      **не** добавлять без явного «запиши» от пользователя (правило
      `CLAUDE.md`) — предложить её текст в отчёте

## 11. Definition of Done

- [x] 11.1 Все задачи `tasks.md` отмечены
- [x] 11.2 `yarn verify` зелёный (`build` + `lint` + `test` по всем пакетам)
- [x] 11.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 11.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [x] 11.5 `yarn docs:audit` — 0 ERROR
- [x] 11.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены с
      обновлённой датой в плашке «сверено с кодом»
- [x] 11.7 Коммиты осмысленные, ветка запушена
