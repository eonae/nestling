# cli-request-cancellation

## Purpose

Отмена команд CLI-транспорта: `meta.signal` присутствует в каждом выполнении
и взводится при `close()` транспорта.

## Requirements

### Requirement: CLI-транспорт предоставляет meta.signal

CLI-транспорт SHALL передавать в контекст каждого выполнения
(`execute()`, включая fallback без pipeline) сигнал transport-level
`AbortController`; `close()` транспорта SHALL взводить этот сигнал
перед закрытием readline/REPL.

#### Scenario: Команда получает сигнал

- **WHEN** команда выполняется через CLI-транспорт
- **THEN** хендлер получает `meta.signal: AbortSignal` (невзведённый,
  пока транспорт не закрывается)

#### Scenario: close() взводит сигнал выполняющейся команды

- **WHEN** долгая команда выполняется и вызывается `close()` транспорта
- **THEN** `meta.signal` команды взводится, позволяя ей завершиться
  кооперативно
