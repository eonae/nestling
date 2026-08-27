# request-abort-signal

## Purpose

Контракт per-request сигнала отмены в pipeline: `meta.signal` присутствует
всегда, взводится транспортом (дисконнект) и при graceful shutdown; отмена
кооперативная.

## Requirements

### Requirement: meta.signal присутствует в каждом вызове хендлера

Pipeline SHALL передавать хендлеру в `meta` поле `signal: AbortSignal`
при каждом вызове через `executeWithHandler`. Если транспорт не предоставил
сигнал, `makeEmptyContext` SHALL подставить never-aborted сигнал —
поле не опционально, хендлер MUST NOT нуждаться в проверке на undefined.

#### Scenario: Транспорт передал сигнал

- **WHEN** транспорт создал контекст через `makeEmptyContext(raw, endpoint, signal)`
  и pipeline выполнил хендлер
- **THEN** хендлер получает `meta.signal`, идентичный переданному транспортом
  (взведение транспортного сигнала наблюдаемо через `meta.signal.aborted`)

#### Scenario: Транспорт не передал сигнал

- **WHEN** контекст создан старой сигнатурой `makeEmptyContext(raw, endpoint)`
- **THEN** хендлер получает `meta.signal` типа `AbortSignal`
  с `aborted === false`, который никогда не взводится

### Requirement: Сигнал доступен middleware через контекст

`ExtendableContext` SHALL содержать `readonly signal: AbortSignal`,
доступный каждому юниту каждой фазы (`.pre`, `.ok`, `.catch`,
`.finally`) каждого слоя пайплайна.

#### Scenario: Юниты читают сигнал

- **WHEN** pre-юнит и finally-юнит выполняются в пайплайне запроса
- **THEN** `ctx.signal` доступен обоим и указывает на тот же сигнал,
  который получит хендлер в `meta.signal`

### Requirement: Ключ signal в meta зарезервирован

Pipeline SHALL инъецировать `signal` в `meta` хендлера: одноимённое
поле, добавленное pre-юнитом в накопленный input, SHALL быть перекрыто
сигналом контекста. Зарезервированность ключа SHALL быть задокументирована.

#### Scenario: Pre-юнит добавил поле signal в input

- **WHEN** pre-юнит вернул `{ signal: <не-сигнал> }` и pre-тракт дошёл
  до хендлера
- **THEN** `meta.signal` — это `AbortSignal` контекста запроса,
  а не значение юнита
