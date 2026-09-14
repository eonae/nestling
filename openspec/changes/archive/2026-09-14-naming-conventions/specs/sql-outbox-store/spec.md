## MODIFIED Requirements

### Requirement: Адаптер хранилища живёт в подпуте пакета

Реализация `OutboxStore` на drizzle SHALL отдаваться подпутём
`@nestlingjs/drizzle.pg/outbox`. `@nestlingjs/outbox` SHALL быть
необязательной peer-зависимостью: приложение без outbox'а SHALL
устанавливать пакет и собираться без него.

Адаптер SHALL объявляться функцией от соединения и SHALL возвращать плагин
с DI-токеном хранилища, пригодным для поля `store` плагина outbox'а.

#### Scenario: Приложение без outbox'а собирается

- **WHEN** приложение ставит `@nestlingjs/drizzle.pg` и не ставит
  `@nestlingjs/outbox`
- **THEN** оно собирается и стартует, а корневой подпуть пакета грузится
  настоящим Node без ошибок

#### Scenario: Хранилище подключается DI-токеном

- **WHEN** корень объявляет `makePgOutboxStore(db)` и передаёт его DI-токен в
  `makeOutbox({ store })`
- **THEN** relay получает адаптер, а записи попадают в таблицу этого
  соединения
