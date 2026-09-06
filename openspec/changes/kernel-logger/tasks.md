## 1. Контейнер: `defaults` модуля и `warnings`

- [x] 1.1 Добавить `Module.defaults?: Provider[]`: билдер запоминает умолчания с именем модуля, применяет их в `build()` после раскрытия фабрик провайдеров модулей и до `familyOverrides`; узел атрибутируется модулю; два умолчания под одним DI-токеном — ошибка регистрации с именами модулей
- [x] 1.2 Заменить `console.warn` о совпадающих `id` на `BuiltContainer.warnings: readonly string[]` (заморожен; без предупреждений — пустой список)
- [x] 1.3 Тесты контейнера: умолчание без соперника, соперник из `providers` в любом порядке регистрации, соперник из фабрики провайдеров, `overrides` находит умолчание, два умолчания — ошибка; `warnings` вместо `console.warn` в существующем тесте о совпадающих `id`
- [x] 1.4 README `@nestling/container`: раздел «Модули» (`defaults`), раздел «Сборка графа» (`warnings`), справочник API

## 2. Логгер в `@nestling/app`

- [x] 2.1 `src/logger/interface.ts`: `Logger`, `LogMethod`, `Fields`, `LogLevel`; `src/logger/tokens.ts`: `RootLogger$`, `Logger$`
- [x] 2.2 `src/logger/config.ts`: секция `nestlingLog` со схемами `level` и `format`, написанными руками как у `nestlingPorts`; наружу только `logConfigKeys`
- [x] 2.3 `src/logger/console.ts`: `ConsoleLogger` с `@Injectable([NestlingLogConfig, Ctx(RequestId)])`; фильтр уровня, форматы `text` и `json`, запись в `process.stderr`, сериализация `err` (`name`, `message`, `stack`, `cause`), `requestId` из `peek()`, `child` с объединением привязок; умолчание для standalone-путей без секции и ридера (не экспортируется)
- [x] 2.4 `src/logger/kernel.ts`: `loggerKernel()` — модуль `kernel:logger` с `defaults: [classProvider(RootLogger$, ConsoleLogger)]`, рецептом `familyProvider(Logger$, …)` от `RootLogger$` и явным членом `Logger$('nestling')`; экспорт из `src/index.ts`
- [x] 2.5 Тесты: три формы вызова на каждом уровне, `Fail` формой ошибки, `child`, фильтр уровня, JSON-строка разбирается и несёт `time`/`level`/`scope`/`msg`/поля/`err`, текстовая строка фиксируется тестом, `requestId` внутри области запроса и его отсутствие вне запроса, невалидный `NESTLING_LOG_LEVEL` падает на сборке, замена корня провайдером плагина меняет члены без ошибки дубля, `Logger$.auto`

## 3. Пайплайн и `dispatch`

- [x] 3.1 `ExecuteOptions`: `logger?: Logger` вместо `onUnknownFail`; `reportUnknownFail` пишет `logger.error('undeclared fail normalized to internal_error', { transport, pattern, code?, err })`; тип `UnknownFailInfo` удалён
- [x] 3.2 `makeDispatch(endpoints, { logger? })`: логгер хранится в `dispatch` и передаётся рантайму при каждом `call`; `DispatchOptions` — только `exposeErrorDetails`
- [x] 3.3 Рантайм-тесты пайплайна и `dispatch`: незадекларированный отказ пишется в переданный логгер с полями `transport`, `pattern`, `code` и `err`; без логгера — в умолчание ядра (перехват `process.stderr.write`); async-схема и объект-не-схема дают запись с оригиналом; отказ проверки входа записи не даёт; переписать существующие спеки `pipeline.*.spec.ts`, `dispatch.spec.ts`, `input-validation.spec.ts`, `stream.runtime.spec.ts`, использовавшие `onUnknownFail`
- [x] 3.4 `withRequestLogging(logger: Logger)` пишет `info('request started', { transport, pattern })`; локальный интерфейс `Logger` юнита удалён; тест

## 4. Конфиг: предупреждения через логгер

- [x] 4.1 `ConfigReader`: список накопленных предупреждений, `attachLogger(logger)` отдаёт накопленное и переключает `warn` на прямую запись; `ConfigReaderOptions.onWarn`, `ConfigWarn`, `ConfigKernelOptions` и второй параметр `configKernel` удалены; DI-токен читалки помечен `@internal` и импортируется `root/app.ts` внутри пакета
- [x] 4.2 Тесты конфига (`reader.spec.ts`, `reloadable.spec.ts`, `shared-keys.spec.ts`, `secrets.spec.ts`, `graph.spec.ts`): предупреждения проверяются через `spyLogger()` и `attachLogger`; предупреждение `refresh()` после подключения уходит напрямую

## 5. Порты и шина

- [x] 5.1 `PortRuntime` получает логгер в конструктор; фабрика kernel-модуля портов зависит от `Logger$('nestling:ports')`; `report` пишет `error('port failure', { operation, err })`; `PortsKernelOptions.onPortFailure` удалён
- [x] 5.2 `InProcessBus({ buffer?, logger? })`: отказ доставки — `error('bus delivery failed', { subject, err })`; входящее сообщение исполняется с `{ exposeErrorDetails: false }`; фабрика kernel-модуля передаёт `Logger$('nestling:bus')`; `onDeliveryFailure` и `onUnknownFail` удалены
- [x] 5.3 `ports/invoker.ts`: `dispatch.call` без `onUnknownFail`; `runtime.report` остаётся для исхода `emit` и ошибок доставки
- [x] 5.4 Тесты `bus.spec.ts`, `kernel.spec.ts`, `invoker.spec.ts`, `ports.spec.ts`: записи проверяются через `spyLogger()`

## 6. Сборка `App`

- [x] 6.1 `#assemble()` регистрирует `loggerKernel()` рядом с kernel-модулями конфига, контекста и портов; после `build()` пишет `container.warnings` уровнем `warn` и вызывает `reader.attachLogger(Logger$('nestling:config'))` — и в `run()`, и в `check()`
- [x] 6.2 WIRE: `makeDispatch(endpoints, { logger: Logger$('nestling') })`
- [x] 6.3 `#announce` и `#warnOnIdleIntercom` и обработчик сигналов пишут через `Logger$('nestling')` по таблице design.md (уровни, сообщения, поля); `console` в `root/app.ts` не остаётся
- [x] 6.4 Тесты `app.spec.ts`, `check.spec.ts`, `policies.spec.ts`, `selection.spec.ts`, `ports.spec.ts`: состав сборки, замыкание выбора, недолговечные операции, detached, простаивающий интерком, предупреждение контейнера, сигнал — через `spyLogger()`; `console.*` в тестах ядра не перехватывается

## 7. Транспорты и OpenAPI

- [x] 7.1 `@nestling/transport.http`: `HttpTransportOptions.onUnknownFail` удалён; `serve` передаёт `dispatch.call` только `exposeErrorDetails`; спеки `provider.spec.ts`, `transport.integration.spec.ts`, `streaming.integration.spec.ts` переведены на `spyLogger()`; README (раздел ошибок, таблица опций)
- [x] 7.2 `@nestling/transport.cli`: `CliTransportOptions.onUnknownFail` удалён; вывод результата в `stdout`/`stderr` не меняется; спеки; README
- [x] 7.3 `@nestling/transport.nats`: `nats()` объявляет зависимость `Logger$('nestling:nats')`; `#reportDelivery` пишет `error`; `onDeliveryFailure` и `onUnknownFail` удалены, `onConnectionChange` остаётся; спеки `transport.spec.ts`, `durable.spec.ts`; README
- [x] 7.4 `@nestling/openapi`: фабрика документа зависит от `Logger$('nestling:openapi')`; `announceHidden` пишет `info('hidden from the API document', { pattern, module, reason })`; `module.spec.ts`; README
- [x] 7.5 `@nestling/subscriptions`: спека `layer.spec.ts` без `onUnknownFail`

## 8. `@nestling/testing`

- [x] 8.1 `spyLogger()` — `{ logger, entries }` с `LogEntry { level, message, fields }`; `child` пишет в тот же список с объединёнными привязками; экспорт типов `LogEntry`
- [x] 8.2 `TestCallOptions` без `onUnknownFail`; `testApp.call` передаёт `dispatch.call` только `exposeErrorDetails`
- [x] 8.3 Тесты `app.spec.ts`, `stub.spec.ts`, `wiring.spec.ts`, `policies.spec.ts` пакета; README (раздел `testApp.call`, новый раздел `spyLogger()`, справочник API)

## 9. Примеры

- [ ] 9.1 `examples/users-service`: удалить `logging.ts`; `Database`, `DbUsersRepository`, `AuditOutcome` зависят от `Logger$.auto` и пишут через `info`/`debug` с полями; `ConsoleLogger` убран из `providers:` фичи; `app.spec.ts` использует `spyLogger()` из `@nestling/testing` и подмену `RootLogger$`, проверяет `requestId` в полях записи
- [ ] 9.2 `examples/app-with-http`: `plugins/logging` → плагин наблюдаемости без собственного логгера и без секции `LoggerConfig`; все `@Injectable([Logger$])` → `Logger$.auto`; `app.spec.ts` на `spyLogger()`; `.env`/README примера — `NESTLING_LOG_LEVEL` вместо `LOG_LEVEL`
- [ ] 9.3 `examples/container`: семейство `Logger` примера заменено на `Logger$` ядра (`.auto` в `UserRepository` и `HealthService`); рецепт семейства показан на семействе, которое пример объявляет сам (например, `Counter$(name)` поверх секции конфига); вывод примера пересверен
- [ ] 9.4 `yarn workspaces foreach` в `examples/*`: `verify` и `smoke` зелёные

## 10. Гайд

- [ ] 10.1 Глава 8 переписана вокруг логгера ядра: `Logger$.auto`, три формы, поля, `child`, `requestId` из контекста без ручного префикса, `NESTLING_LOG_LEVEL` и `NESTLING_LOG_FORMAT`, замена корня одним провайдером, `spyLogger()`; сниппеты совпадают с `users-service`
- [ ] 10.2 Главы 5, 6, 12, 13, 15, 16, 23 и приложение А: `@Injectable([Logger$])` → `Logger$.auto`, `log(...)` → `info(...)`, подмена `[RootLogger$, spy.logger]`, `testApp.get(Logger$)` → `testApp.get(RootLogger$)`; глава 12 — абзац о параметризованном плагине перенесён на плагин с параметром
- [ ] 10.3 Глава 21: рецепт семейства на собственном семействе примера, `.auto` на `Logger$.auto`, `.all` на `HealthCheck`; заголовок и первый абзац пересверены с новым предметом
- [ ] 10.4 `guide/README.md`: строка «логгер ядра» в карте понятий (глава 8), строка главы 21 в таблице части 5; плашки «сверено с кодом» затронутых глав с датой правки
- [ ] 10.5 `node .claude/skills/docs-style/scripts/lint.mjs docs/guide packages/*/README.md` → 0 запрещённых слов

## 11. Design и decisions

- [ ] 11.1 `design/errors.md` (§ нормализации: логгер вместо хука), `design/transports.md` (§1: опции границы без `onUnknownFail`), `design/config.md` (§3: предупреждения через логгер вместо `onWarn`), `design/testing.md` (`spyLogger()` рядом с `familyOverride`), `design/container.md` («Логгер ядра»: `defaults` модуля и `warnings`; «Модули»: поле `defaults`), `design/composition.md` (§6 «Логгер»: области `nestling:<область>`)
- [ ] 11.2 README `@nestling/app`: раздел «Логгер ядра» (интерфейс, `RootLogger$`, `Logger$`, секция `nestlingLog`, области ядра, замена корня, правило про цикл), «Ошибки» и «`Dispatch`» без `onUnknownFail`, «Готовые юниты», «Справочник API: конфигурация» без `ConfigKernelOptions`/`ConfigWarn`, «Порты» без хуков, справочник API логгера, плашка статуса
- [ ] 11.3 `yarn docs:audit` → 0 ERROR

## 12. Замер

- [ ] 12.1 Прогнать бенчмарк из change `hot-path-trim` на `GET` и `POST`; разница с базой в пределах погрешности; результат записан в PR

## Definition of Done

- [ ] все задачи выше отмечены
- [ ] `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` + `type-budget` по всем пакетам)
- [ ] README затронутых пакетов обновлены, включая плашки статуса
- [ ] `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [ ] `yarn docs:audit` → 0 ERROR
- [ ] затронутые `examples/*` мигрированы, главы гайда пересверены с обновлённой датой в плашке «сверено с кодом»
- [ ] коммиты осмысленные, ветка `change/kernel-logger` запушена
