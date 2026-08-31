## MODIFIED Requirements

### Requirement: Fallback-endpoint'ы без pipeline получают meta.signal

HTTP-транспорт SHALL передавать один и тот же композитный сигнал запроса в
контекст каждого endpoint'а. Endpoint без `pipeline` исполняется рантаймом
пайплайна с пустым пайплайном (capability `dispatch-guarantee`) и SHALL
получать `meta.signal` тем же способом, что endpoint с пайплайном:
отдельного прямого вызова хендлера SHALL NOT быть.

#### Scenario: Endpoint без pipeline при дисконнекте

- **WHEN** endpoint без pipeline обрабатывает запрос и клиент обрывает
  соединение
- **THEN** `meta.signal`, переданный хендлеру, взводится
