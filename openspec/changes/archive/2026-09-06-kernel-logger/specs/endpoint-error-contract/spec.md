## MODIFIED Requirements

### Requirement: Оригинал нормализованного отказа не теряется

При нормализации рантайм SHALL писать оригинал (отказ или необработанную
ошибку) в логгер из опций исполнения записью уровня `error` с полями
`transport`, `pattern`, `code` (если оригинал — отказ) и оригиналом в
`err`. Логгер SHALL приходить в рантайм из `dispatch`
(`makeDispatch(endpoints, { logger })`); без него SHALL использоваться
умолчание ядра. Молчаливое проглатывание SHALL NOT допускаться; хука
`onUnknownFail` SHALL NOT существовать.

Тело ответа SHALL подчиняться политике capability
`error-response-safety`: без `exposeErrorDetails` — generic-сообщение,
с ним — детали оригинала.

#### Scenario: Логгер получает оригинал

- **WHEN** `dispatch` собран с `spyLogger()`, и отказ нормализован
- **THEN** в записях есть `error` с исходным значением в `err` и полями
  `transport` и `pattern`, а тело ответа их не содержит

#### Scenario: Логгер не передан

- **WHEN** `makeDispatch(endpoints)` вызван без логгера
- **THEN** запись уходит в умолчание ядра (`stderr`), ответ клиента не
  меняется
