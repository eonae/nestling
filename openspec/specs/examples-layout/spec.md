# examples-layout

## Purpose

Где живут примеры и что гарантируется их расположением. Примеры
существуют только внутри репозитория и в npm не публикуются, поэтому они
лежат в отдельном каталоге `examples/`, а `packages/` содержит только
пакеты фреймворка. Состав примеров и роль каждого описывает
[example-apps](../example-apps/spec.md). Запрет на публикацию держит
флаг `private`, а не префикс имени: инструментам не нужно разбирать имя
пакета, чтобы отличить пример от пакета.

## Requirements

### Requirement: Примеры живут вне `packages/`

Каталог `packages/` SHALL содержать только пакеты фреймворка. Примеры
SHALL лежать в каталоге `examples/` на верхнем уровне монорепы, по одному
каталогу на пример: `examples/<name>`.

Корневой `package.json` SHALL перечислять оба каталога в `workspaces`:
`packages/*` и `examples/*`.

Глубина вложенности примера SHALL совпадать с глубиной пакета — два
уровня от корня. Относительные пути в `tsconfig.json`, `vitest.config.js`,
`eslint.config.js` и `esbuild.config.js` примера SHALL оставаться теми же,
что у пакета: `../../tsconfig.base.json`, `../../vitest.config.base.js`,
`../../.config/eslint.config.js`.

#### Scenario: Каталог примера

- **WHEN** в репозитории есть пример «сервис для внешних клиентов»
- **THEN** его код лежит в `examples/microservice/`, а `packages/` не
  содержит каталога с этим примером

#### Scenario: Пример виден yarn как workspace

- **WHEN** выполняется `yarn install`
- **THEN** `examples/microservice` разрешается как workspace, и его
  зависимости `@nestlingjs/*` резолвятся симлинками на пакеты монорепы

#### Scenario: Общие конфиги примера

- **WHEN** открыт `examples/microservice/tsconfig.json`
- **THEN** он наследуется от `../../tsconfig.base.json`

### Requirement: Примеры не публикуются

Каждый `package.json` в `examples/` SHALL иметь `private: true` и имя вида
`@examples/<name>`, совпадающее с именем каталога.

Запрет на публикацию SHALL держаться флагом, а не соглашением об
именовании: инструмент публикации не обязан разбирать имя пакета, чтобы
отличить пример от пакета фреймворка.

#### Scenario: Пример помечен приватным

- **WHEN** читается `examples/cli/package.json`
- **THEN** в нём `"name": "@examples/cli"` и `"private": true`

#### Scenario: Публикация не забирает примеры

- **WHEN** инструмент публикации собирает список пакетов монорепы
- **THEN** ни один пакет из `examples/` в список не попадает

### Requirement: Обход `packages/` не зависит от имени пакета

`scripts/smoke.mjs` SHALL обходить каталог `packages/` целиком, без
фильтра по префиксу имени. Пакет без собранной точки входа
(`dist/index.js`) SHALL пропускаться — это единственное основание не
проверять пакет.

#### Scenario: Smoke обходит пакеты

- **WHEN** выполняется `node scripts/smoke.mjs`
- **THEN** каждый пакет `packages/*` с собранным `dist/index.js`
  загружается настоящим Node, и ни один пакет не исключается по имени

#### Scenario: Пакет без сборки

- **WHEN** в `packages/*` есть пакет, который не собирает `tsc`, и у него
  нет `dist/index.js`
- **THEN** smoke пропускает его молча и не считает это отказом
