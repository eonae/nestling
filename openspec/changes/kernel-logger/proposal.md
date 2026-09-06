## Why

Ядро пишет в консоль пятью независимыми каналами, и заменить их одним
провайдером нельзя. Читалка конфига зовёт `console.warn` с префиксом
`[nestling/config]` (`config/reader.ts`). Пайплайн и транспорты передают
незадекларированный отказ в хук `onUnknownFail`, по умолчанию это
`console.error` (`pipeline/core/pipeline.ts`, `transport.http`,
`transport.cli`, `transport.nats`). `App` печатает состав сборки и список
detached-endpoint'ов через `console.log` (`root/app.ts`). Порты и шина
пишут отказы доставки в `console.error` (`ports/runtime.ts`,
`ports/bus.ts`). Контейнер предупреждает о совпадающих `id` DI-токенов
через `console.warn` (`container.builder.ts`). Логгера в ядре при этом
нет: `users-service` и `app-with-http` заводят свой `Logger$` заново, а
семейство `Logger(scope)` с `.auto` живёт только в примере `container`.
Решение записано в [ideas.md [2026-09-06] «Логгер ядра»](../../../docs/decisions/ideas.md).

Сейчас, потому что следующие change'и добавляют ядру новый вывод: пробы
(#53) и HTTP-сервер как ресурс (#49). Без общего логгера каждый из них
добавил бы ещё один канал.

## What Changes

- Интерфейс `Logger` в `@nestling/app`: уровни `debug`, `info`, `warn`,
  `error`; у каждого три формы вызова — `(message, fields?)`,
  `(error, fields?)`, `(fields)`; метод `child(bindings)`. Тип
  `Fields = Record<string, unknown> & { err?: unknown }`; ключ `err`
  зарезервирован за ошибкой.
- `RootLogger$` — DI-токен корня. `Logger$(scope)` — семейство DI-токенов
  с рецептом `root.child({ scope })`; `Logger$.auto` даёт член по имени
  потребителя. Замена корня одним провайдером меняет все члены.
- `ConsoleLogger` — реализация ядра по умолчанию, класс не экспортируется.
  Уровень и формат задаёт kernel-секция `nestlingLog`:
  `NESTLING_LOG_LEVEL` (`debug` | `info` | `warn` | `error`, по умолчанию
  `info`) и `NESTLING_LOG_FORMAT` (`text` | `json`, по умолчанию `text`).
  Идентификатор запроса читается из `Ctx(RequestId)`. Записи идут в
  `stderr`.
- Kernel-модуль логгера регистрируется сборкой всегда. Провайдер
  приложения под `RootLogger$` заменяет умолчание без ошибки дубля: у
  модуля появляется поле `defaults` — провайдеры, которые попадают в
  граф, только если к моменту `build()` под их DI-токеном никто не
  зарегистрирован.
- Ядро пишет только через `Logger$('nestling')` и области
  `nestling:<область>`. Строка состава, замыкание выбора,
  detached-endpoint'ы, скрытые endpoint'ы OpenAPI и сигнал остановки —
  `info`. Недолговечные операции, простаивающий интерком, предупреждения
  конфига и совпадающие `id` DI-токенов — `warn`. Незадекларированные
  отказы, отказы портов и отказы доставки шины и NATS — `error` с
  оригиналом в `err`.
- Предупреждения `ContainerBuilder.build()` становятся значением
  `BuiltContainer.warnings`; сборка `App` пишет их в логгер. Контейнер от
  логгера не зависит: он собирает граф, в котором логгер — узел.
- Предупреждения читалки конфига копятся до появления логгера и уходят в
  него сразу после `build()`; дальше идут напрямую.
- **BREAKING** Логгер привязывается к `dispatch`:
  `makeDispatch(endpoints, { logger? })`; `ExecuteOptions` получает
  `logger?` вместо `onUnknownFail`. Незадекларированный отказ — запись
  `error` с транспортом, паттерном, кодом и оригиналом в `err`. Без
  `App` (standalone) `makeDispatch` и `InProcessBus` используют
  `ConsoleLogger` с умолчаниями.
- **BREAKING** Удаляются хуки и опции вывода: `ExecuteOptions.onUnknownFail`,
  `DispatchOptions.onUnknownFail`, тип `UnknownFailInfo`,
  `HttpTransportOptions.onUnknownFail`, `CliTransportOptions.onUnknownFail`,
  `NatsTransportOptions.onUnknownFail` и `onDeliveryFailure`,
  `InProcessBusOptions.onDeliveryFailure` и `onUnknownFail`,
  `PortsKernelOptions.onPortFailure`, `ConfigReaderOptions.onWarn`,
  `ConfigWarn`, `ConfigKernelOptions`, `TestCallOptions.onUnknownFail`.
  `exposeErrorDetails` остаётся: это про ответ клиенту, а не про лог.
- **BREAKING** `withRequestLogging(logger)` принимает `Logger` ядра и
  пишет `info`; локальный интерфейс `Logger` этого юнита удалён.
- `@nestling/testing` экспортирует `spyLogger()`: логгер, который копит
  записи значениями. Подмена `[RootLogger$, spy.logger]` перехватывает
  записи ядра и приложения разом.
- Примеры `users-service`, `app-with-http` и `container` переходят на
  логгер ядра; их собственные `Logger$`, `ConsoleLogger` и секция
  `LOG_LEVEL` удаляются. Глава 8 гайда переписана вокруг логгера ядра;
  главы 5, 6, 12, 13, 15, 16, 21, 23 и приложение А пересверены.

## Non-goals

- Адаптеры к pino, winston и подобным. Это satellite-пакеты поверх
  интерфейса `Logger`; ядро от библиотек логирования не зависит.
- Reloadable-уровень: секция `nestlingLog` не reloadable.
  Reloadable-секция без наблюдающего источника предупреждает, и
  предупреждение получало бы каждое приложение на голом `process.env`.
- Имя сервиса или приложения в записях. Потребитель регистрирует под
  `RootLogger$` реализацию или адаптер с нужными привязками.
- Логгер с областью запроса. `requestId` читает реализация из
  асинхронного контекста; приложение ничего не пробрасывает.
- Вывод CLI-транспорта: результат команды в `stdout` и отказ в `stderr` —
  это ответ клиенту, а не лог; не меняется.
- `@nestling/viz` и `@common/static-server` — инструменты вне ядра;
  `console` в них остаётся.
- Пробы (#53) и HTTP-сервер как ресурс (#49) — свои change'и; они пишут
  через этот логгер.

## Capabilities

### New Capabilities

- `kernel-logger`: интерфейс `Logger`, `RootLogger$`, семейство `Logger$`,
  умолчание `ConsoleLogger` с секцией `nestlingLog`, замена корня одним
  провайдером через `defaults` модуля, вывод ядра только через логгер,
  `spyLogger()` в `@nestling/testing`.

### Modified Capabilities

- `endpoint-error-contract`: оригинал нормализованного отказа уходит
  записью `error` в логгер `dispatch`, а не в хук `onUnknownFail`.
- `dispatch-guarantee`: `makeDispatch(endpoints, { logger? })`; опции
  `call` без `onUnknownFail`.
- `endpoint-input-validation`: ошибка конфигурации схемы и отказ проверки —
  сценарии называют запись логгера вместо хука.
- `config-sources-binding`: предупреждения читалки идут в логгер ядра;
  `onWarn` удалён, тест перехватывает их через `spyLogger()`.
- `token-families`: предупреждение о совпадающих `id` — значение
  `BuiltContainer.warnings`; `App` пишет его в логгер.
- `composition-root`: строка состава сборки — запись `info` логгера ядра.
- `endpoint-detached-optout`: список detached-endpoint'ов — записи `info`
  логгера ядра.
- `durable-delivery`: деградация долговечности — запись `warn`.
- `feature-bundles`: фактический состав при `includeDeps` — запись `info`.
- `operation-map`: простаивающий интерком — запись `warn`.
- `openapi-document`: список скрытых endpoint'ов — записи `info` через
  `Logger$('nestling:openapi')`.

## Impact

- `@nestling/container`: поле `defaults` у `Module`, `BuiltContainer.warnings`,
  `console.warn` удалён.
- `@nestling/app`: новый модуль `src/logger/` (интерфейс, `RootLogger$`,
  `Logger$`, `ConsoleLogger`, секция `nestlingLog`, kernel-модуль);
  `config/reader.ts` и `config/kernel.ts` (буфер предупреждений,
  `attachLogger`); `pipeline/core/pipeline.ts` и `transport/dispatch.ts`
  (логгер вместо хука); `ports/runtime.ts`, `ports/bus.ts`,
  `ports/invoker.ts`, `ports/kernel.ts`; `root/app.ts`;
  `pipeline/middlewares/logging.ts`.
- `@nestling/transport.http`, `@nestling/transport.cli`,
  `@nestling/transport.nats`: опции `onUnknownFail` и `onDeliveryFailure`
  удалены; NATS пишет через `Logger$('nestling:nats')`.
- `@nestling/openapi`: `announceHidden` пишет через логгер.
- `@nestling/testing`: `spyLogger()`, `TestCallOptions` без `onUnknownFail`.
- Примеры: `users-service` (`logging.ts` удалён), `app-with-http`
  (`plugins/logging` без собственного логгера и секции `LOG_LEVEL`),
  `container` (семейство `Logger` примера заменено на `Logger$` ядра).
- Документация: главы 5, 6, 8, 12, 13, 15, 16, 21, 23, приложение А и
  `guide/README.md`; `design/errors.md`, `design/transports.md`,
  `design/config.md`, `design/testing.md`, `design/container.md`;
  README пакетов `app`, `container`, `transport.http`, `transport.cli`,
  `transport.nats`, `openapi`, `testing`.
- Соседний change `sync-assemble` (#45) переносит создание читалки в фазу
  0 `run()`; шаг «подключить логгер к читалке после `build()`» остаётся
  тем же. `resources-and-roles` (#46) этот change не затрагивает.
