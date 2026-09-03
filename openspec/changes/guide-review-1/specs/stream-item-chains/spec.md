# stream-item-chains Specification (delta)

## MODIFIED Requirements

### Requirement: Ошибки цепочки эскалируют в request-pipeline

Отказ, порождённый комбинатором входной цепочки, SHALL проявляться при
итерации в хендлере и SHALL обрабатываться обычным ответным трактом
(`.catch`/`.finally`). Если ответ уже начал течь, отказ SHALL
обрабатываться mid-stream политикой транспорта (capability
`http-streaming-framing`) и SHALL давать исход `failed`.

`.limit(max)` SHALL отказывать встроенным определением `PayloadTooLarge`
(`payload_too_large`), `.gapTimeout(ms)` — встроенным определением
`Timeout` (`timeout`); отдельных определений `StreamLimitExceeded` и
`StreamGapTimeout` не существует. Оба кода SHALL входить в kernel-набор, то
есть SHALL NOT требовать объявления в `errors:` и SHALL NOT нормализовываться
стражем границы в `internal_error`.

#### Scenario: Превышение лимита элементов

- **WHEN** во входном потоке с `.limit(10)` приходит одиннадцатый элемент
- **THEN** итерация бросает отказ с кодом `payload_too_large` (HTTP 413),
  а не 500 `internal_error`

#### Scenario: Молчание источника дольше допустимого

- **WHEN** во входном потоке с `.gapTimeout(1000)` между элементами
  прошло больше секунды
- **THEN** итерация бросает отказ с кодом `timeout`

#### Scenario: Отказ цепочки виден `.catch`-юниту

- **WHEN** отказ цепочки возник до начала отдачи ответа
- **THEN** `.catch`-юниты слоя вызываются обычным порядком, `.finally`
  получает исход `failed`
