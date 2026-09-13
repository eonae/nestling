## MODIFIED Requirements

### Requirement: Пакет объявляет публикуемость вторым аргументом `createEslintConfig`

`createEslintConfig(fileUrl, options)` SHALL принимать поле
`published`. Умолчание SHALL быть `true`: пакет, ничего не объявивший,
проверяется правилом языка.

`published: false` SHALL выключать только правило языка и SHALL NOT
менять остальные правила конфига.

Каждый `examples/*/eslint.config.js` SHALL передавать `published: false`:
пример не уходит в npm, и русская строка в нём не попадает на глаза
читателю пакета.

#### Scenario: Пример с русским `summary`

- **WHEN** `examples/microservice/src/api/operations.ts` объявляет
  `summary: 'Создать пользователя'`
- **THEN** `lint` примера проходит

#### Scenario: Новый пакет ничего не объявляет

- **WHEN** пакет копирует `eslint.config.js` как
  `createEslintConfig(import.meta.url)` и кладёт русскую строку в `src/`
- **THEN** `lint` пакета падает

#### Scenario: Пакет со своим конфигом

- **WHEN** `@nestlingjs/viz` не подключает общую базу и держит свой набор
  правил
- **THEN** правило языка его не касается, пока не решён вопрос о его
  публикации
