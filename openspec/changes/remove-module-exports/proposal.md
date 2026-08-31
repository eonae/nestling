# remove-module-exports

## Why

Модуль в Nestling — метка принадлежности провайдеров, единица упаковки и
метаданные для графа (`docs/design/container.md`, §Модули). Границей
инкапсуляции он не является: видимость определяют ES-модули и границы
пакетов. Поле `Module.exports` и опция `strictExports` тянут модуль во
вторую роль и не справляются с ней.

Проверка узкая: она смотрит только рёбра готового графа. Мимо неё проходят
типы в `.d.ts`, создание класса через `new` в обход контейнера, подстановки
`overrides` в тестах и чтение чужого ключа через `Config(key)`. Включить её
нельзя там, где собирают приложение: `assemble()` — единственный публичный
composition root — опцию не принимает, поэтому для приложений на
`@nestling/app` поле `exports` не влияет ни на что.

В итоге примеры объявляют `exports` в каждом модуле, а проверяет их ноль
сборок. Это конвенция вместо гарантии — ровно то, что принцип
**guarantee over convention** запрещает. Решение зафиксировано в
`docs/decisions/ideas.md`: запись «Решение 3» (модули остаются plain
objects, видимость — через ES-модули) в части опциональной строгости
суперсидится, запись про `strictExports` у агрегата семейства — тоже.

## What Changes

- **Поле `Module.exports` удаляется** из `@nestling/container`. Модуль
  описывают `name`, `providers` и `imports`.
- **Опция `ContainerBuilder({ strictExports })` удаляется** вместе с шагом
  проверки в `build()`. Число шагов сборки уменьшается с одиннадцати до
  десяти.
- **`metadata.exported` уходит из узла графа** и из `toJSON()`: вычислять
  флаг больше не из чего. `metadata.module` остаётся — атрибуция к модулю
  не менялась.
- **Вклад в семейство больше ничего не требует.** `classProvider(IHealthCheck('db'),
  DbHealthCheck)` в `providers` модуля — полная форма записи вклада. Узел-агрегат
  `Family.all` собирает всех зарегистрированных членов независимо от модулей.
- Модули фреймворка (`kernel:config`, `kernel:context`, `kernel:ports`,
  `module:openapi`, `module:subscriptions`) и примеры теряют поле `exports`.
- **BREAKING**: `exports` в модуле и `strictExports` в опциях билдера
  становятся неизвестными полями. Замены нет: границы держат ES-модули.
  Обёрток совместимости не остаётся — стадия активного проектирования.

## Capabilities

### New Capabilities

Новых возможностей нет: change только удаляет.

### Modified Capabilities

- `strict-exports`: удаляется целиком. Все четыре требования снимаются,
  спека уходит из `openspec/specs/` при архивации.
- `container-module-attribution`: снимается часть требования про
  `metadata.exported`. Узел графа сохраняет `metadata.module`, флага
  экспортированности у него больше нет.
- `multi-injection`: снимается требование «вклад чужого модуля объявляется
  в `exports`». Узел-агрегат по-прежнему безмодульный, но его рёбра к
  членам ничем не ограничены.

## Impact

- `@nestling/container` — тип `Module`, опции билдера, `build()`, граф и
  его сериализация; тест `strict-exports.spec.ts` удаляется, блок про
  strictExports уходит из `family-aggregates.spec.ts`.
- `@nestling/config`, `@nestling/pipeline`, `@nestling/ports`,
  `@nestling/openapi`, `@nestling/subscriptions` — поле `exports` в модулях.
- `@nestling/viz` — отрисовка узлов, если она читает `exported`.
- `examples.simple-app`, `examples.app-with-http` — модули без `exports`.
- Документация: `docs/design/container.md`, `principles.md`, `endpoints.md`,
  `docs/guides/di-token-families.md`, `composition.md`, `docs/README.md`,
  `docs/preview/src/*.md`, README пакетов `nestling.container` и
  `nestling.config`.
- `docs/decisions/ideas.md` — новая запись и пометки суперсида у двух старых.

## Non-goals

- **Модель прав конфига не трогаем.** `Config(key)` читает любой ключ,
  включая секретный; `isSecretKey` затирает значение только при печати.
  Это отдельная тема — права на конфиг, а не границы модулей.
- **ESLint-правило на импорты не добавляем.** Ограничение вида «в
  `src/users/**` ходят только через `index.ts`» остаётся выбором
  пользователя. Гарантией оно не является: правило выключают и глушат
  комментарием.
- **`imports` не меняем.** Поле остаётся тем, чем было: списком модулей
  для рекурсивной регистрации.
- **Атрибуция к модулю сохраняется.** `metadata.module`, разрешение
  коллизий имён и discovery работают по-прежнему.
