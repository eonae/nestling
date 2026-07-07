# http-transport-limits — delta

## MODIFIED Requirements

### Requirement: Graceful close drains connections

`close()` SHALL: взвести сигналы всех in-flight запросов (см. capability
`http-request-cancellation`), перестать принимать новые соединения,
немедленно закрыть простаивающие keep-alive соединения, дождаться завершения
активных запросов до `closeTimeout` (дефолт 10s) и принудительно закрыть
оставшиеся соединения по его истечении. Кооперативное завершение по сигналу —
основной механизм дренажа; принудительное закрытие по `closeTimeout` —
fallback для хендлеров, игнорирующих сигнал. `close()` SHALL завершаться
за конечное время при наличии живых keep-alive соединений.

#### Scenario: Close with idle keep-alive connection

- **WHEN** клиент держит открытое keep-alive соединение без активного запроса
  и вызывается `close()`
- **THEN** `close()` завершается, не дожидаясь таймаута keep-alive клиента

#### Scenario: Close with hung in-flight request

- **WHEN** активный запрос не завершается дольше `closeTimeout`
  (хендлер игнорирует `meta.signal`)
- **THEN** по истечении `closeTimeout` соединение принудительно закрывается
  и `close()` завершается

#### Scenario: Close with cooperative in-flight request

- **WHEN** активный запрос обрабатывается хендлером, завершающимся
  по `meta.signal`, и вызывается `close()`
- **THEN** `close()` завершается дренажом заметно раньше `closeTimeout`,
  без принудительного закрытия соединений
