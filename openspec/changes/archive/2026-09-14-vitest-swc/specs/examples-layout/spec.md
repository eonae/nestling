## MODIFIED Requirements

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
