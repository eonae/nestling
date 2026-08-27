# request-abort-signal

## MODIFIED Requirements

### Requirement: Сигнал доступен middleware через контекст

`ExtendableContext` SHALL содержать `readonly signal: AbortSignal`,
доступный каждому юниту каждой фазы (`.pre`, `.ok`, `.catch`,
`.finally`) каждого слоя пайплайна.

#### Scenario: Юниты читают сигнал

- **WHEN** pre-юнит и finally-юнит выполняются в пайплайне запроса
- **THEN** `ctx.signal` доступен обоим и указывает на тот же сигнал,
  который получит хендлер в `meta.signal`
