# request-abort-signal — delta

## MODIFIED Requirements

### Requirement: Сигнал доступен middleware через контекст

`ExtendableContext` SHALL содержать `readonly signal: AbortSignal`,
доступный каждому юниту каждой фазы (`.pre`, `.ok`, `.catch`, `.after`,
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
