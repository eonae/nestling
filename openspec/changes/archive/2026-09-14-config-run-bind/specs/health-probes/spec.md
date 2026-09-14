## MODIFIED Requirements

### Requirement: Секция `nestlingHealth` задаёт таймаут и срок кэша

Ядро SHALL объявлять kernel-секцию `nestlingHealth` с ключами
`NESTLING_HEALTH_TIMEOUT` (умолчание `2000`) и `NESTLING_HEALTH_CACHE`
(умолчание `1000`), обе в миллисекундах. Значение вне диапазона
неотрицательных целых SHALL быть ошибкой сборки с именем ключа.

Секция SHALL читаться узлом из графа обычной зависимостью. Наружу пакет
SHALL отдавать только `healthConfigKeys` — право привязать источник опцией
`config` у `run()` (capability `config-sources-binding`); DI-токен секции
SHALL оставаться приватным.

#### Scenario: Источник привязан к ключам секции

- **WHEN** вызван `run({ config: [bind(envSource(), { keys: healthConfigKeys })] })`,
  а в окружении `NESTLING_HEALTH_TIMEOUT=50`
- **THEN** каждая проверка отменяется через 50 мс

#### Scenario: Умолчания без единой привязки

- **WHEN** `run()` вызван без опции `config`
- **THEN** таймаут проверки — 2000 мс, срок кэша — 1000 мс
