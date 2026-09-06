## ADDED Requirements

### Requirement: `Topic` — broadcast-примитив без внешних зависимостей

`Topic<T>` SHALL поставляться пакетом `@nestling/operations`, не имеющим
внешних зависимостей и не зависящим от серверного кода: его
переиспользуют слой конфигурации (`reloadable`) и внутрипроцессная шина
портов, которым пайплайн не нужен.

API SHALL быть минимальным: конструктор с опциями
`{ buffer?: number; onSlowConsumer?: 'drop-oldest' | 'disconnect' }`,
`push(value)`, `subscribe(signal?)`, `close()` и счётчик подписчиков.
`Topic` SHALL оставаться примитивом (bounded buffer + `AbortSignal`), а
не парадигмой: наследования от него, операторов и фабрик «на все случаи»
SHALL NOT появляться.

#### Scenario: Примитив доступен без серверных пакетов

- **WHEN** приложение импортирует `@nestling/operations` без остальных
  пакетов фреймворка
- **THEN** `Topic` работает, и внешних зависимостей у пакета нет

#### Scenario: Источник событий — обычный провайдер

- **WHEN** класс-сервис держит приватный `Topic` и отдаёт
  `subscribe(signal)` наружу
- **THEN** он остаётся обычным singleton-провайдером контейнера; особого
  вида endpoint'а или регистрации для источников событий SHALL NOT
  существовать

## MODIFIED Requirements

### Requirement: Утилиты потоков живут рядом с `Topic`

`@nestling/operations` SHALL содержать реализацию комбинаторов
item-цепочек (capability `stream-item-chains`) и утилиты итерации под
`AbortSignal`, чтобы у ядра и satellite-пакетов была одна реализация, а
не по копии на пакет.

Публичный API пакета SHALL оставаться работой со стандартными
`AsyncIterable`/`AsyncIterableIterator`; собственный тип потока SHALL NOT
вводиться.

#### Scenario: Комбинаторы доступны отдельно от форм io

- **WHEN** satellite-пакет применяет тот же `limit`/`gapTimeout` к
  собственному потоку
- **THEN** он импортирует их из `@nestling/operations`, не затягивая
  `@nestling/app`

## REMOVED Requirements

### Requirement: `Topic` — broadcast-примитив в отдельном пакете без зависимостей

**Reason**: Отдельного пакета `@nestling/streams` больше нет — он слит в
`@nestling/operations`. Требование заменено на «`Topic` — broadcast-примитив
без внешних зависимостей»: гарантия та же, дом другой.

**Migration**: Импорт `Topic`, комбинаторов и утилит `AbortSignal`
переписывается с `@nestling/streams` на `@nestling/operations`. API,
опции и поведение не меняются.
