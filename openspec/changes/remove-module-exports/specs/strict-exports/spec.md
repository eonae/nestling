# strict-exports Specification (delta)

## REMOVED Requirements

### Requirement: strictExports is an opt-in build-time check, off by default

**Reason**: Модуль в Nestling — метка принадлежности, единица упаковки и
метаданные для графа, а не граница инкапсуляции. Видимость определяют
ES-модули и границы пакетов. Опция проверяла только рёбра готового графа и
не видела ни типы в `.d.ts`, ни создание класса через `new` в обход
контейнера, ни подстановки `overrides`, ни чтение чужого ключа через
`Config(key)`. Включить её там, где собирают приложение, было нельзя:
`assemble()` опцию не принимал. Решение и отвергнутые варианты —
`docs/decisions/ideas.md`, запись «[2026-09-01] Модуль без exports».

**Migration**: Удалить опцию из вызова конструктора:
`new ContainerBuilder({ strictExports: true })` → `new ContainerBuilder()`.
Границы между модулями внутри одного пакета держит ES-видимость; при
необходимости их проверяет ESLint-правило на импорты, выбираемое
пользователем.

### Requirement: strictExports validates cross-module graph edges against exports

**Reason**: Проверка удалена вместе с опцией, которая её включала.

**Migration**: Кросс-модульные рёбра больше не ограничены. Токен, который
не должен покидать модуль, не экспортируют из его `index.ts` — тогда
зависимость на него не написать.

### Requirement: All strictExports violations are reported in a single error

**Reason**: Ошибки `strictExports` больше не существует.

**Migration**: Не требуется — сборка не выдаёт такой ошибки.

### Requirement: Module exports accept a token family

**Reason**: Поле `Module.exports` удалено целиком, поэтому принимать
семейство токенов больше нечему. Вклад в семейство объявляется провайдером
члена в `providers` модуля и другого объявления не требует.

**Migration**: Удалить поле `exports` из модуля. Вклад
`classProvider(IHealthCheck('db'), DbHealthCheck)` в `providers` остаётся
единственной и достаточной формой записи.
