## MODIFIED Requirements

### Requirement: `build()` синхронный, фаза BUILD без ввода-вывода

`ContainerBuilder.build()` SHALL возвращать `BuiltContainer`, а не
`Promise<BuiltContainer>`. Все шаги сборки — разворачивание фабрик
`providers` модулей, создание токенов семейств, подстановки, прунинг,
проверка неудовлетворённых зависимостей, построение графа и проверка на
циклы — SHALL выполняться синхронно.

Создания экземпляров среди шагов сборки SHALL NOT быть: их создаёт
`init()` (capability `instantiation-on-init`).

Фаза 1 BUILD SHALL NOT выполнять ввод-вывод. Всё, что читает файл, сеть
или соединение, SHALL происходить раньше — на фазе 0 — или позже: на INIT и
дальше, где захват ресурсов и хук `@OnStart` асинхронны.

#### Scenario: Контейнер собирается без ожидания

- **WHEN** код пишет `const container = new ContainerBuilder().register(UserService).build()`
- **THEN** `container` — собранный контейнер, а не промис; `await` не нужен

#### Scenario: Жизненный цикл остаётся асинхронным

- **WHEN** провайдер объявлен ресурсом с асинхронным `acquire`
- **THEN** `container.init()` его дожидается: синхронной стала сборка, а не
  жизненный цикл
