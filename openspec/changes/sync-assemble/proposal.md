## Why

Фаза 0 BOOTSTRAP описана в [composition.md §1](../../../docs/design/composition.md),
но в коде её нет. Источники конфига поднимает асинхронная фабрика внутри
графа (`packages/nestling.app/src/config/kernel.ts`), а билдер делает `await`
и на `useFactory` каждого провайдера, и на фабрике `providers` модуля — хотя
тип `factoryProvider` синхронный. Рантайм разрешает то, что запрещает тип:
`build()` асинхронный, `check()` не обходится без ввода-вывода, а фабрика
провайдера остаётся местом, где соединение захватывается мимо фазовой модели.

Решение зафиксировано записью
[ideas.md [2026-09-06] «Фаза 0 BOOTSTRAP: источники до сборки, синхронный
`build()`, фабрики без I/O»](../../../docs/decisions/ideas.md). Второй мотив —
переключатели состава (change `switches`): им нужен снимок значений до
регистрации провайдеров.

## What Changes

- **BREAKING** `ContainerBuilder.build()` возвращает `BuiltContainer`, а не
  `Promise<BuiltContainer>`. Фаза 1 ASSEMBLE синхронна и не делает
  ввода-вывода.
- **BREAKING** `useFactory` вызывается синхронно. Фабрика, вернувшая
  `Promise`, роняет сборку с именем провайдера и подсказкой про
  `resourceProvider`. Тип `FactoryProviderDefinition` запрещает
  `Promise` в возвращаемом значении.
- **BREAKING** `ProvidersFactory` (фабрика `providers` модуля) синхронна:
  `Promise` из неё — та же ошибка сборки.
- **BREAKING** Читалка конфига перестаёт быть узлом графа с асинхронной
  фабрикой. `run()` выполняет фазу 0 отдельно: инициализирует привязанные
  источники, читает объявленные ключи в снимок, закрывает фазу. Секции
  проецируются из снимка.
- Читалка живёт время `run()`: закрывается на SHUTDOWN явным вызовом, а не
  хуком `@OnDestroy` внутри графа. `check()` закрывает её сразу после отчёта.
- Ошибка фазы 0 называет источник. Повторы при временно недоступном
  источнике — забота источника (`vault({ retries })`), ядро зовёт `init()`
  один раз. Закрывает открытый вопрос записи ideas.md.
- `check()` проходит фазы 0 и 1 и принимает опцию `config:` в тех же трёх
  формах, что тестовый корень: с `vars({ … })` проверка обходится без
  источников.
- Reloadable не меняется поведением: читалка наблюдает источники после
  фазы 0, `refresh()` обновляет снимок и перепроецирует секции.

## Non-goals

- Перенос создания экземпляров с ASSEMBLE на INIT. Это change
  `resources-and-roles`: `@Resource`, `static acquire` и `release`. Здесь
  экземпляры по-прежнему создаются в `build()` — синхронно.
- Переключатели состава (`makeSwitch`, `pick`, `when`) и типизированный
  аргумент сборки. Это change `switches`; снимок фазы 0 — его предпосылка.
- Новые источники конфига (`file`, `vault`) и опция `env({ prefix })`.
- Изменение `container.init()`, `start()` и `destroy()`: хуки жизненного
  цикла остаются асинхронными.

## Capabilities

### New Capabilities

- `synchronous-assembly`: фаза 1 ASSEMBLE без ввода-вывода — синхронный
  `build()`, синхронные фабрики провайдеров и фабрики `providers` модуля,
  ошибка сборки на `Promise` из фабрики.
- `config-bootstrap-snapshot`: фаза 0 — инициализация привязанных источников
  вне контейнера, снимок объявленных ключей, время жизни читалки и её
  закрытие, повторы на стороне источника.

### Modified Capabilities

- `lifecycle-phases`: фаза 0 перестаёт быть только первичным чтением `load()` — она поднимает источники и отдаёт снимок; фаза 1 объявляется
  синхронной и без ввода-вывода.
- `config-sources-binding`: `init()` источников вызывается на фазе 0 до
  контейнера, а не асинхронной фабрикой внутри графа; отказ источника
  называет его имя.
- `config-sections`: проекция секции считается из снимка фазы 0, а не
  опросом источников на месте.
- `config-reloadable`: `refresh()` обновляет снимок и перепроецирует секцию.
- `structural-check`: `check()` проходит фазы 0–1 и принимает `config:` для
  проверки без источников.

## Impact

- `@nestling/container`: `ContainerBuilder.build()`, `instantiateAll`,
  `appendFactoryProviders`, типы `FactoryProviderDefinition`,
  `FactoryProviderWithDeps`, `ProvidersFactory`.
- `@nestling/app`: `AssembledApp.run()`, `close()`, швы `CHECK_SEAM` и
  `TEST_SEAM`, `App.check()`, `configKernel`, `ConfigReader`, проекция секций.
- `@nestling/testing`: `checkTopologies` и опции `check()`.
- `examples/container`: `await builder.build()` в `src/container.ts`.
- Документация: `docs/design/composition.md` (§1, повторы источника),
  `docs/design/config.md`, `docs/design/container.md`, README пакетов
  `nestling.container`, `nestling.app`, `nestling.testing`, главы гайда 06
  (конфиг) и 07 (тестирование), если сниппеты расходятся.
