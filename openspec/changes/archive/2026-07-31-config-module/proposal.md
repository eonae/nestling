# config-module: конфигурация как token families

## Why

Конфигурации во фреймворке нет вообще. Единственная её материализация в
коде — `packages/examples.simple-app/src/config/config.module.ts`: ручной
`valueProvider(IConfig, { databaseUrl: 'postgresql://localhost:5432/myapp' })`
с захардкоженными строками. `process.env` не читается ни одним пакетом ядра,
схемной валидации значений на старте не существует, и оба инварианта фазы 0
из [`composition.md`](../../../docs/design/composition.md) —
«`process.env` трогается только в config» и «невалидный конфиг на старте =
FAIL-FAST» — держать сегодня нечем.

Все примитивы, на которых стоит целевой конфиг, в коде уже есть: token
families и `familyProvider` (change #5, архив `2026-07-29-token-families`),
`Topic` (change #6, архив `2026-07-31-streaming-v2` — пакет `@nestling/streams`
заведён без зависимостей **именно** под `reloadable` конфига и шину портов),
Standard Schema как схемная граница (change #19). Логика решений зафиксирована
в `docs/decisions/ideas.md`, секции «[2026-07-08] Kernel/user space; конфиг как
token-families», «[2026-07-10] Конфиг: keys-capability вместо `configs:`-владения»
и «[2026-07-14] Конфиг: форма секции — рекорд полей»; разбор —
[`docs/history/discussions/05-modular-monolith-features-ports.md`](../../../docs/history/discussions/05-modular-monolith-features-ports.md)
§11 и §15; целевое состояние —
[`docs/design/config.md`](../../../docs/design/config.md). Это change #9 из
[roadmap](../../../docs/decisions/roadmap.md), первый в волне 4: на него
опираются `features` (#10, config-модуль — уровень L1 корня), `testing-package`
(`vars()` — объектный `ConfigSource`) и `config-secrets` (#25).

## What Changes

- **Новый пакет `@nestling/config`.** `makeConfig('orders', { … })` объявляет
  секцию; форма секции — **рекорд полей**, листья — произвольные Standard
  Schema, `from('DATABASE_URL', schema)` задаёт точное имя ключа вместо
  выведенного из префикса (`maxItems` → `ORDERS_MAX_ITEMS`). Интроспекция
  вендорских схем не требуется нигде.
- **Секция — член token family, а не регистрируемый провайдер.** Инжект
  `@Injectable([OrdersConfig])` материализует узел графа фреймворковым
  рецептом; отдельной регистрации в модуле нет, ключа `configs:` у модуля
  не появляется.
- **Приватность — keys-capability, а не проверка на `build()`.** Токен секции
  не экспортируется из пакета (чужой инжект нельзя написать — видимость
  ES-модулей); наружу отдаётся branded-хэндл `OrdersConfig.keys`, которым
  нечего инжектить. Проверки владения на `build()` не вводится.
- **Источники — объекты `ConfigSource { get; init?; watch?; close? }`,
  а не провайдеры,** и читает их одна приватная читалка (kernel-токен). `env` —
  неявный пол; свои координаты (`path`, `addr`) источник берёт из
  примордиального `process.env` в `init()` — единственный контакт источника
  с `process.env`.
- **Привязка в корне — плоский список** `config: [[src, keys | glob]]`,
  порядок = приоритет. Только env → в корне про конфиг не пишешь ничего.
  До появления `assemble()` (change #10) список живёт в `AppConfig`.
- **Eager-валидация на `build()` с fail-fast.** Поля секции валидируются
  независимо друг от друга, отказ собирает все проваленные поля секции в одну
  ошибку с именами ключей и перечнем опрошенных источников.
- **`makeConfig.reloadable`** — read-latest-геттеры плюс `onChange(signal, cb)`
  поверх `Topic` + `AbortSignal` (живой хэндл, отписка по сигналу). Асимметрия
  со стартом: невалидное горячее значение → keep last-good + warn, процесс жив.
  Reloadable-секция поверх источника без `watch` → warn на старте, не падение.
- **Реестр ключей** — источник интроспекции (`describeConfig()`): объявленные
  секции, ключи, флаг `reloadable`, unbound-глобы. Без значений и без сети.
- **`Config(key)` — публичное семейство одиночных ключей** для on-demand-инфры
  (`GrpcClient(server)` транзитивно тянет `Config(addressKey(server))`) и
  unbound-свойств; свои паттерны такой пакет экспортирует глобом симметрично
  секциям.
- **`validateSync` переезжает из `@nestling/pipeline` в `@common/misc`**
  (реэкспорт из `@nestling/pipeline` сохраняется — для потребителя ничего не
  меняется): конфиг фазы 0 не должен зависеть от request-пайплайна фаз 3–5.

## Non-goals

- **`secret()` и семантика общих ключей** (независимая валидация читателями,
  fail-fast на несогласованном `reloadable`, секретность по объединению,
  читатели ключа в `explain()`) — отдельный change `config-secrets` (#25),
  аддитивный поверх этого. Ключ, читаемый двумя секциями, здесь просто
  работает; конфликтов сборки на этот счёт не вводится.
- **Вендор-конвертеры схем для конфига** — отвергнуты записью [2026-07-14];
  перечислимость даёт рекорд полей.
- **Кросс-полевые инварианты секции** («если A задан, то B обязателен») —
  открытый вопрос записи [2026-07-14], опциональный валидатор секции поверх
  независимых полей.
- **`assemble()`, фичи и `select`** — change #10; здесь только точка привязки
  в существующем корне.
- **Готовые источники** (`file()`, `vault()`, `reloadableFile()`) — пакетами
  поверх `ConfigSource`; в ядре только интерфейс, env-пол и тестируемый
  объектный источник.
- **Тег фичи в интроспекции** — выводится из графа фич, которых ещё нет
  (приезжает с #10).

## Capabilities

### New Capabilities

- `config-sections`: объявление секции `makeConfig(prefix, record)`, деривация
  имён ключей, `from()`, проекция в типизированный объект, инжект секции как
  члена token family, независимая eager-валидация полей и fail-fast на `build()`.
- `config-keys-capability`: разделение прав на две capability — неэкспортируемый
  токен секции (инжект) и branded-хэндл `.keys` (привязка); глобы как хэндлы того
  же вида; отсутствие `configs:`-владения и build-проверки приватности.
- `config-sources-binding`: `ConfigSource`, одна приватная читалка, env как
  неявный пол, координаты источника из примордиального `process.env`, плоский
  список привязок `config: [[src, keys | glob]]` с порядком-приоритетом,
  закрытие источников на shutdown.
- `config-reloadable`: `makeConfig.reloadable`, read-latest, `onChange(signal, cb)`
  поверх `Topic`, keep-last-good + warn на невалидном обновлении, warn на
  источнике без `watch`.
- `config-registry`: реестр объявленных ключей как источник интроспекции и доков,
  семейство одиночных ключей `Config(key)` для on-demand/unbound-членов.

### Modified Capabilities

- `standard-schema-validation`: единственная точка валидации `validateSync`
  переезжает в `@common/misc` (реэкспорт из `@nestling/pipeline` сохраняется),
  а список пакетов ядра, которым запрещено зависеть от валидатора, пополняется
  `@nestling/config`.

## Impact

- **Новый пакет** `packages/nestling.config` (`@nestling/config`): зависимости —
  `@nestling/container`, `@nestling/streams`, `@common/misc`.
- **`@common/misc`** — принимает `validateSync`, `SchemaValidationError`,
  `SchemaIssue`, `normalizeIssues`, `assertStandardSchema`,
  `AsyncSchemaNotSupportedError`, `NotAStandardSchemaError`; `@nestling/pipeline`
  реэкспортирует их из прежнего места (публичный API не меняется).
- **`@nestling/app`** — `AppConfig.config?: ConfigBinding[]`; App регистрирует
  kernel-модуль конфига всегда (env-пол работает без единой строки в корне).
- **`packages/examples.simple-app`** — ручной `ConfigModule` заменяется секцией
  `makeConfig`; это первый рабочий пример fail-fast на старте.
- **Документация** — `docs/design/config.md` уточняется по факту реализованного
  (форма токена секции, точка привязки до `assemble()`), новый гайд
  `docs/guides/config.md`, README нового пакета и затронутых (`app`, `pipeline`,
  `streams`), статус change #9 в roadmap.
</content>
</invoke>
