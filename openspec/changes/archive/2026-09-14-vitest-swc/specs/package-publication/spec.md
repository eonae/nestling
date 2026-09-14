## MODIFIED Requirements

### Requirement: Тарбол публикуемого пакета несёт только сборку

Манифест публикуемого пакета SHALL перечислять в поле `files` каталог
сборки. Исходники, конфигурация сборки и линтера, спеки, проверки типов и
фикстуры SHALL NOT попадать в тарбол.

`README.md`, `LICENSE` и `package.json` реестр включает всегда, поэтому
перечислять их в `files` SHALL NOT требоваться.

#### Scenario: Состав тарбола

- **WHEN** для публикуемого пакета выполняется упаковка
- **THEN** тарбол содержит `dist`, `README.md`, `LICENSE` и `package.json`
  и не содержит ни `src`, ни `tsconfig*.json`, ни `eslint.config.js`, ни
  `vitest.config.js`
