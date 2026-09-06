## Context

Вывод ядра сегодня разбросан по пяти каналам, и у каждого свой способ
подмены:

| Кто пишет | Как | Подмена |
|---|---|---|
| читалка конфига (`config/reader.ts`) | `console.warn` с префиксом `[nestling/config]` | `ConfigReaderOptions.onWarn`, до `configKernel` из `App` не доходит |
| рантайм пайплайна (`pipeline/core/pipeline.ts`) | хук `onUnknownFail`, по умолчанию `console.error` | опция транспорта: `http()`, `cli()`, `nats()`, `TestCallOptions` |
| `App` (`root/app.ts`) | `console.log`: состав, замыкание выбора, недолговечные операции, detached-endpoint'ы, сигнал остановки; `console.warn`: простаивающий интерком | нет |
| порты и шина (`ports/runtime.ts`, `ports/bus.ts`) | `console.error` | `PortsKernelOptions.onPortFailure`, `InProcessBusOptions.onDeliveryFailure` — из `App` не доходят |
| контейнер (`container.builder.ts`) | `console.warn` о совпадающих `id` DI-токенов | нет |
| `@nestling/openapi` (`module.ts`) | `console.log` о скрытых endpoint'ах | `announceHidden: false` |

Приложения заводят логгер сами: `users-service/src/logging.ts`,
`app-with-http/src/plugins/logging/`. Семейство с `.auto` есть только в
`examples/container`.

Ограничения, которые задают форму решения:

1. Логгер — узел графа. Его создаёт контейнер, поэтому билдер контейнера
   писать через него не может: во время `build()` экземпляров ещё нет.
2. Реализация по умолчанию читает уровень из секции конфига, значит
   зависит от читалки. Читалка не может зависеть от логгера: это цикл.
3. Standalone-пути без `App` — `makeDispatch` и `serve` (глава 24),
   `new InProcessBus()`, `new HttpTransport()` — kernel-модуля не имеют.
4. `@nestling/container` не импортирует `@nestling/app`; направление
   зависимостей держит правило зон.
5. `hot-path-trim` (#38) вернул 15% на `GET`. Логгер в горячем пути не
   должен их отдать.

## Goals / Non-Goals

**Goals:**

- Один интерфейс `Logger` для ядра и приложения; ядро пишет только через
  него.
- Замена реализации одним провайдером под `RootLogger$`; все члены
  `Logger$(scope)` следуют за корнем.
- Записи проверяются тестом как значения, а не разбором `stdout`.
- Standalone-пути сохраняют правило «незадекларированный отказ не
  проглатывается молча».
- `requestId` попадает в записи без пробрасывания руками.

**Non-Goals:**

- Адаптеры к библиотекам логирования; reloadable-уровень; имя сервиса в
  записях; логгер с областью запроса; вывод CLI-транспорта; `viz` и
  `static-server`; пробы (#53) и HTTP-сервер (#49). Причины — в
  proposal.

## Decisions

### 1. Код живёт в `packages/nestling.app/src/logger/`

Файлы: `interface.ts` (`Logger`, `Fields`, `LogLevel`), `tokens.ts`
(`RootLogger$`, `Logger$`), `config.ts` (секция `nestlingLog`,
`logConfigKeys`), `console.ts` (`ConsoleLogger`), `kernel.ts`
(`loggerKernel()`), `index.ts`. Наружу из пакета идут `Logger`, `Fields`,
`LogLevel`, `RootLogger$`, `Logger$`, `logConfigKeys`, `loggerKernel`.
`ConsoleLogger`, DI-токен секции и умолчание для standalone-путей не
экспортируются: реализации ядра приватны, как у конфига и портов.

Альтернатива — положить интерфейс и DI-токены в `@nestling/container`,
чтобы контейнер тоже писал через логгер. Отклонена: во время `build()`
экземпляров нет, писать нечем. Контейнер отдаёт предупреждения значением
(решение 9).

### 2. Интерфейс: четыре уровня, три формы, `child`

```typescript
type Fields = Record<string, unknown> & { err?: unknown };
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogMethod {
  (message: string, fields?: Fields): void;
  (error: Error, fields?: Fields): void;
  (fields: Fields): void;
}

interface Logger {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  child(bindings: Fields): Logger;
}
```

- Форма с `Error` первым аргументом берёт `message` из ошибки и кладёт
  саму ошибку в `err`. `Fail` наследует `Error`
  (`operations/src/result.ts`) и проходит той же формой.
- Форма `(fields)` пишет запись без сообщения.
- `child(bindings)` возвращает логгер, который добавляет `bindings` к
  каждой записи. Привязки дочернего логгера накладываются поверх
  родительских; поля вызова — поверх привязок.
- Ключ `err` в `fields` зарезервирован: реализация сериализует его как
  ошибку (`name`, `message`, `stack`, `cause`), а не как произвольное
  значение.

### 3. Корень и семейство

`RootLogger$ = makeToken<Logger>('RootLogger')`.
`Logger$ = makeTokenFamily<Logger, [scope: string]>('Logger')`. Рецепт
семейства регистрирует kernel-модуль:
`factoryProvider(Logger$(scope), (root) => root.child({ scope }), [RootLogger$])`.
`Logger$.auto` работает существующей машинерией семейств.

Kernel-модуль регистрирует член `Logger$('nestling')` явным провайдером
того же вида. Член семейства становится узлом, только когда его кто-то
запрашивает в `deps`; `App` — не узел графа и запрашивает логгер через
`container.getOrThrow` после `build()`, поэтому узел нужен заранее.

Области ядра — члены семейства: `nestling` у `App`, `nestling:config`,
`nestling:ports`, `nestling:bus`, `nestling:nats`, `nestling:openapi`.
Каждая область — узел графа, виден в визуализации и в `toJSON()`.
Альтернатива `Logger$('nestling').child({ area })` отклонена: область
исчезала бы из графа.

### 4. Умолчание, которое заменяется одним провайдером: `defaults` модуля

`Module` получает поле `defaults?: Provider[]`. Провайдер из `defaults`
попадает в граф, только если к моменту `build()` под его DI-токеном никто
не зарегистрирован: ни модулем, ни фабрикой провайдеров модуля, ни
`register()`. Билдер применяет `defaults` в `build()` после раскрытия
фабрик провайдеров модулей и до создания членов семейств; узел
атрибутируется модулю, объявившему умолчание. Два умолчания под одним
DI-токеном — ошибка регистрации.

Kernel-модуль логгера объявляет
`defaults: [classProvider(RootLogger$, ConsoleLogger)]`. Плагин
приложения с `factoryProvider(RootLogger$, …)` в `providers` побеждает
без ошибки дубля, в каком бы порядке модули ни регистрировались.
`overrides` тестового корня находят провайдер под `RootLogger$` как
обычно: умолчание применяется раньше подстановок.

Отклонено:

- сканировать провайдеры в `App` до `build()` и не регистрировать
  умолчание при совпадении — фабрики провайдеров модулей раскрываются
  внутри `build()`, сканирование их не видит;
- терпимая регистрация дубля для отдельных DI-токенов — прятала бы
  настоящие дубли;
- `ContainerBuilder.registerDefault()` — то же правило, но без атрибуции
  к модулю; поле модуля читается как декларация.

### 5. `ConsoleLogger`: секция, уровни, формат, `stderr`, `requestId`

Класс с `@Injectable([NestlingLogConfig, Ctx(RequestId)])`. Каждая запись
проходит фильтр уровня (`debug` < `info` < `warn` < `error`) и уходит в
`process.stderr` одной строкой. Это единственное место ядра, которое
пишет в поток процесса.

- `text`: `<время ISO> <УРОВЕНЬ> <scope> <сообщение> key=value …`;
  значения-объекты — через `JSON.stringify`; `err` — `err=<name>: <message>`
  и стек на следующих строках.
- `json`: `{"time","level","scope"?,…привязки,"requestId"?,"msg",…поля,"err":{"name","message","stack","cause"?}}`
  одной строкой.
- `requestId` берётся из `Ctx(RequestId).peek()` в момент записи и
  добавляется полем, если он есть и поле не задано вызовом. Вне запроса
  поля нет.
- `child(bindings)` возвращает `ConsoleLogger` с теми же секцией и ридером
  и объединёнными привязками.

`stderr`, а не `stdout`: у CLI-транспорта `stdout` занят результатом
команды, и лог не должен в него попадать; для сервера разницы нет.

Умолчание для standalone-путей — `ConsoleLogger` без секции и ридера:
уровень `info`, формат `text`, без `requestId`. Он живёт внутри модуля
`console.ts` и наружу не отдаётся.

### 6. Секция `nestlingLog`

`makeConfig('nestlingLog', { level, format })` со схемами, написанными
руками как у `nestlingPorts` (Standard Schema без вендора). Ключи —
`NESTLING_LOG_LEVEL` и `NESTLING_LOG_FORMAT`. Наружу идёт только
`logConfigKeys`. Секция не reloadable: reloadable-секция без наблюдающего
источника предупреждает, а на голом `process.env` это каждое приложение.

### 7. Незадекларированные отказы: логгер у `dispatch`

`makeDispatch(endpoints, options?)` принимает `{ logger?: Logger }` и
хранит логгер рядом с таблицей маршрутов. `Dispatch.call` передаёт его
рантайму пайплайна: `ExecuteOptions` получает `logger?` вместо
`onUnknownFail`. Нормализованный отказ пишется так:
`logger.error('undeclared fail normalized to internal_error', { transport, pattern, code?, err: original })`.
Сообщение постоянное, чтобы по нему искать; endpoint и код — поля.

`App` создаёт `dispatch` на фазе WIRE и передаёт `Logger$('nestling')`.
Транспорты об этом не знают: `DispatchOptions` остаётся
`{ exposeErrorDetails? }`. Без логгера `makeDispatch` берёт умолчание из
решения 5, поэтому standalone-путь молча ничего не проглатывает.

Отклонено:

- оставить хук `onUnknownFail` с логгером по умолчанию — два канала на
  один факт;
- логгер в `DispatchOptions` при каждом `call` — каждому транспорту
  понадобилась бы зависимость от логгера ради одного вызова, тогда как у
  `App` он есть один раз.

Вызыватели портов (`ports/invoker.ts`) больше не передают `onUnknownFail`
в `dispatch.call`: запись с транспортом и паттерном делает сам `dispatch`.
`PortRuntime.report` остаётся для отказов уровня порта — исход `emit`,
ошибка доставки.

### 8. Предупреждения конфига: буфер до `build()`, затем логгер

Читалка копит предупреждения в списке. `attachLogger(logger)` отдаёт
накопленное через `logger.warn` и переключает `warn(message)` на прямую
запись. `App` вызывает `attachLogger` сразу после `build()` с
`Logger$('nestling:config')` и в `run()`, и в `check()`. DI-токен читалки
остаётся приватным: `root/app.ts` импортирует его из `config/kernel.ts`
внутри пакета, из `index.ts` он не выходит.

Отклонено:

- зависимость читалки от логгера — цикл через секцию `nestlingLog`;
- только список предупреждений без подключения — `refresh()`
  reloadable-секции предупреждает на фазе RUN, и каналу нужно жить после
  сборки;
- логгер без зависимости от секции, с уровнем из `process.env` напрямую —
  нарушает правило «`process.env` читает только конфиг».

`sync-assemble` (#45) переносит создание читалки в фазу 0 `run()`; шаг
`attachLogger` после `build()` при этом не меняется.

### 9. Предупреждения контейнера — значение

`ContainerBuilder.build()` собирает предупреждения (сегодня одно: о
совпадающих `id`) в `BuiltContainer.warnings: readonly string[]`.
`console.warn` из контейнера уходит. `App` после `build()` пишет каждое
через `Logger$('nestling')` уровнем `warn`. Пользователь контейнера без
`App` читает `container.warnings` сам — тот же приём, что у `pruned`.

### 10. Порты, шина, NATS, OpenAPI

- `PortRuntime` получает логгер в конструктор; фабрика kernel-модуля
  портов зависит от `Logger$('nestling:ports')`. `report(info)` →
  `logger.error('port failure', { operation, err })`.
  `PortsKernelOptions.onPortFailure` удаляется.
- `InProcessBus(options)` принимает `{ buffer?, logger? }`; фабрика
  kernel-модуля передаёт `Logger$('nestling:bus')`, standalone — умолчание
  из решения 5. Отказ доставки → `logger.error('bus delivery failed', { subject, err })`.
  Входящее сообщение исполняется с `{ exposeErrorDetails: false }`.
- `nats()` объявляет зависимость `Logger$('nestling:nats')`;
  `#reportDelivery` пишет `error`. `onDeliveryFailure` и `onUnknownFail`
  удаляются. `onConnectionChange` остаётся: это событие для приложения,
  а не канал вывода — без хука он ничего не печатает.
- Плагин `openapi()` добавляет фабрике документа зависимость
  `Logger$('nestling:openapi')`; `announceHidden` пишет `info` на каждый
  скрытый endpoint: `hidden from the API document` с полями `pattern`,
  `module`, `reason`.

### 11. Записи `App`

| Событие | Уровень | Сообщение | Поля |
|---|---|---|---|
| состав сборки на старте | `info` | `features: …; transports: …` | `features`, `transports` |
| выбор замкнут по вызовам | `info` | `selection closed over calls` | `named`, `added` |
| операции обслуживаются недолговечно | `warn` | `durable delivery is not available on this bus` | `operations` |
| detached-endpoint | `info` | `detached from policies` | `pattern`, `transport`, `reason` |
| интерком без операций | `warn` | `intercom is assigned, but this assembly declares no operations` | `transport` |
| предупреждение контейнера | `warn` | текст предупреждения | — |
| сигнал процесса | `info` | `shutting down` | `signal` |

`check()` строку состава не пишет, как и сейчас; предупреждения конфига и
контейнера пишет.

### 12. `withRequestLogging(logger: Logger)`

Юнит принимает `Logger` ядра и пишет `info('request started', { transport, pattern })`.
Локальный интерфейс `Logger` из `middlewares/logging.ts` удаляется: два
экспорта с одним именем из одного пакета невозможны.

### 13. `spyLogger()` в `@nestling/testing`

```typescript
interface LogEntry { level: LogLevel; message: string; fields: Fields }
function spyLogger(): { logger: Logger; entries: readonly LogEntry[] }
```

`child(bindings)` возвращает логгер, который пишет в тот же список с
объединёнными привязками в `fields`. Подмена `[RootLogger$, spy.logger]`
в `overrides` перехватывает записи всех членов `Logger$` — и ядра, и
приложения. `familyOverride(Logger$, …)` работает как прежде.

### 14. Примеры и гайд

- `users-service`: `logging.ts` удаляется. `Database`, `DbUsersRepository`,
  `AuditOutcome` зависят от `Logger$.auto`. Строка аудита —
  `info(\`${pattern} ${status}\`, { outcome })`; `requestId` в запись
  кладёт `ConsoleLogger`, префикс `[req-42]` руками не пишется.
  Тесты: `spyLogger()` из `@nestling/testing`, подмена `RootLogger$`,
  проверка `entries` по полям.
- `app-with-http`: плагин `plugins/logging` становится плагином
  наблюдаемости — слой `observability` и юнит `AuditOutcome`. Секция
  `LoggerConfig` (`LOG_LEVEL`) и класс `ConsoleLogger` примера удаляются;
  уровень задаёт `NESTLING_LOG_LEVEL`. Параметр `service` уходит вместе с
  ними; абзац главы 12 о параметризованном плагине переносится на плагин
  с параметром, который остаётся в примере.
- `container`: семейство `Logger` примера заменяется на `Logger$` ядра.
  Глава 21 учит рецепту семейства на семействе, которое пример объявляет
  сам (например, `Counter$(name)` поверх секции конфига), `.auto` — на
  `Logger$.auto`, `.all` — на `HealthCheck` как сейчас.
- Глава 8 переписывается вокруг логгера ядра: `Logger$.auto`, три формы
  вызова, поля, `child`, `requestId` из контекста, `NESTLING_LOG_LEVEL` и
  `NESTLING_LOG_FORMAT`, замена корня провайдером, `spyLogger()`.

## Risks / Trade-offs

- [Горячий путь] Запись на каждый запрос делает только опциональный
  `withRequestLogging` и юниты приложения; ядро пишет на запросе лишь при
  незадекларированном отказе. → Прогнать бенчмарк из `hot-path-trim`;
  разница с базой не больше погрешности замера.
- [Шум в тестах] Умолчание пишет предупреждения конфига в `stderr` при
  каждой тестовой сборке, как сегодня `console.warn`. → Тест, который
  проверяет записи, подменяет `RootLogger$` через `spyLogger()`.
- [Цикл при замене корня] Провайдер под `RootLogger$`, зависящий от
  `Logger$(x)`, даёт цикл. → Ошибка цикла называет путь; правило записано
  в README.
- [Лишний узел] `Ctx(RequestId)` появляется в каждом графе ради
  `ConsoleLogger`. → Это `valueProvider` ридера; цена нулевая.
- [Уровень `warn` прячет состав] `NESTLING_LOG_LEVEL=warn` убирает строку
  состава на старте. → Так и задумано: состав — `info`.
- [Порядок предупреждений] Предупреждения конфига выходят после
  `build()`, позже предупреждений контейнера. → Порядок внутри каждого
  канала сохраняется; тесты проверяют состав, а не порядок.
- [Слияние с `sync-assemble`] Оба change'а правят `config/kernel.ts` и
  `root/app.ts`. → Шаг `attachLogger` — одно место; при слиянии он
  переезжает вслед за созданием читалки.
- [Глава 21 меняет предмет] Рецепт семейства показывается на другом
  примере. → Структура главы сохраняется, меняется только семейство.

## Migration Plan

| Было | Стало |
|---|---|
| `ExecuteOptions.onUnknownFail`, `DispatchOptions.onUnknownFail`, `UnknownFailInfo` | `makeDispatch(endpoints, { logger })`; запись `error` в логгере |
| `http({ onUnknownFail })`, `cli({ onUnknownFail })`, `nats({ onUnknownFail, onDeliveryFailure })` | опции удалены; записи идут в `Logger$('nestling')` и `Logger$('nestling:nats')` |
| `InProcessBusOptions.onDeliveryFailure`, `onUnknownFail` | `InProcessBusOptions.logger` |
| `PortsKernelOptions.onPortFailure` | зависимость `Logger$('nestling:ports')` |
| `configKernel(bindings, { onWarn })`, `ConfigWarn`, `ConfigKernelOptions` | `configKernel(bindings)`; предупреждения в `Logger$('nestling:config')` |
| `TestCallOptions.onUnknownFail` | `overrides: [[RootLogger$, spyLogger().logger]]` |
| `console.warn` контейнера | `BuiltContainer.warnings` |
| `withRequestLogging({ log })` | `withRequestLogging(logger: Logger)` |
| собственный `Logger$` приложения | `Logger$.auto`, `Logger$(scope)`, `RootLogger$` |

Порядок работ: контейнер (`defaults`, `warnings`) → логгер в `app` →
пайплайн и `dispatch` → конфиг → порты и шина → `App` → транспорты,
OpenAPI, testing → примеры → гайд и документация. Откат — ветка
`change/kernel-logger` целиком.

## Open Questions

- Точный вид текстовой строки `ConsoleLogger` фиксируется тестом в apply;
  состав полей JSON-формата задан здесь.
