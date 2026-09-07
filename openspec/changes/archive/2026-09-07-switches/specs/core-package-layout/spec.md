## MODIFIED Requirements

### Requirement: Ядро занимает три пакета

Ядро фреймворка SHALL поставляться тремя пакетами и SHALL NOT занимать
больше:

| Пакет | Состав |
|---|---|
| `@nestling/container` | контейнер зависимостей: DI-токены, провайдеры, семейства, модули, переключатели состава |
| `@nestling/operations` | операции, отказы, формы io, пометки размещения, `Topic` и комбинаторы потоков |
| `@nestling/app` | пайплайн, конфигурация, порты, транспортный интерфейс, композиционный корень |

Переключатели состава SHALL жить в `@nestling/container`: ветка стоит в
`providers:` и `dependsOn:` модуля, а тип `Module` объявлен этим пакетом
(capability `composition-switches`). `@nestling/app` SHALL импортировать
их оттуда и SHALL NOT реэкспортировать `makeSwitch`: имя экспортирует один
пакет.

Пакетов `@nestling/pipeline`, `@nestling/config`, `@nestling/ports`,
`@nestling/transport` и `@nestling/streams` SHALL NOT существовать.
Пакетов-заглушек, реэкспортирующих слитый код под прежним именем, SHALL
NOT создаваться: имя, которого нет в `packages/`, SHALL NOT резолвиться.

Автор приложения SHALL импортировать из трёх перечисленных пакетов и
транспорта по выбору.

#### Scenario: Прежнее имя не резолвится

- **WHEN** код импортирует что-либо из `@nestling/pipeline`
- **THEN** импорт не резолвится, и в `packages/` нет каталога с этим
  пакетом

#### Scenario: Приложение импортирует из трёх пакетов

- **WHEN** читаются `dependencies` примера, поднимающего HTTP-сервис
- **THEN** из ядра там названы `@nestling/app`, `@nestling/container` и
  `@nestling/operations`, а транспорт добавлен четвёртым

#### Scenario: Переключатель импортируется из контейнера

- **WHEN** приложение объявляет `makeSwitch('storage', ['s3', 'local'])`
- **THEN** имя импортируется из `@nestling/container`, а из
  `@nestling/app` не экспортируется
