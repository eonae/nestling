## ADDED Requirements

### Requirement: Примеры живут вне `packages/`

Каталог `packages/` SHALL содержать только пакеты фреймворка. Примеры
SHALL лежать в каталоге `examples/` на верхнем уровне монорепы, по одному
каталогу на пример: `examples/<name>`.

Корневой `package.json` SHALL перечислять оба каталога в `workspaces`:
`packages/*` и `examples/*`.

Глубина вложенности примера SHALL совпадать с глубиной пакета — два
уровня от корня. Относительные пути в `tsconfig.json`, `jest.config.js`,
`eslint.config.js` и `esbuild.config.js` примера SHALL оставаться теми же,
что у пакета: `../../tsconfig.base.json`, `../../jest.config.base.js`,
`../../.config/eslint.config.js`.

#### Scenario: Каталог примера

- **WHEN** в репозитории есть пример «сервис пользователей»
- **THEN** его код лежит в `examples/users-service/`, а `packages/` не
  содержит каталога с этим примером

#### Scenario: Пример виден yarn как workspace

- **WHEN** выполняется `yarn install`
- **THEN** `examples/users-service` разрешается как workspace, и его
  зависимости `@nestling/*` резолвятся симлинками на пакеты монорепы

#### Scenario: Общие конфиги примера

- **WHEN** открыт `examples/users-service/tsconfig.json`
- **THEN** он наследуется от `../../tsconfig.base.json`, и правка пути не
  требовалась при переезде

### Requirement: Примеры не публикуются

Каждый `package.json` в `examples/` SHALL иметь `private: true` и имя вида
`@examples/<name>`, совпадающее с именем каталога.

Запрет на публикацию SHALL держаться флагом, а не соглашением об
именовании: инструмент публикации не обязан разбирать имя пакета, чтобы
отличить пример от пакета фреймворка.

#### Scenario: Пример помечен приватным

- **WHEN** читается `examples/simple-cli/package.json`
- **THEN** в нём `"name": "@examples/simple-cli"` и `"private": true`

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

### Requirement: Плашка главы называет пример коротким именем

Плашка «сверено с кодом `<пример>` (YYYY-MM-DD)» в главе гайда SHALL
называть пример именем каталога без префикса: `users-service`, а не
`examples.users-service`.

Проверка документации SHALL резолвить это имя сначала как
`examples/<name>`, затем как `packages/<name>`, и SHALL сообщать ERROR,
если нет ни того, ни другого каталога. Второй вариант нужен главе про
сателлит: её источник — пакет фреймворка, а не пример.

#### Scenario: Плашка указывает на существующий пример

- **WHEN** глава начинается плашкой «сверено с кодом `users-service`
  (2026-09-05)»
- **THEN** `yarn docs:audit` находит `examples/users-service` и не выдаёт
  ошибку

#### Scenario: Плашка указывает на пакет фреймворка

- **WHEN** глава начинается плашкой «сверено с кодом
  `nestling.subscriptions` (2026-09-05)»
- **THEN** `yarn docs:audit` находит `packages/nestling.subscriptions` и
  не выдаёт ошибку

#### Scenario: Плашка указывает на несуществующий каталог

- **WHEN** глава называет в плашке имя, которого нет ни в `examples/`, ни
  в `packages/`
- **THEN** `yarn docs:audit` выдаёт ERROR с именем главы и обоими путями

#### Scenario: Свежесть главы считается по каталогу примера

- **WHEN** последний коммит, тронувший `examples/users-service`, новее
  даты в плашке главы
- **THEN** `yarn docs:audit` выдаёт WARN о необходимости пересверки

### Requirement: Подпись блока кода в главе указывает на путь примера

Первая строка блока кода в главе гайда, ссылающегося на файл примера,
SHALL быть комментарием с путём от корня репозитория:
`// examples/<name>/src/<file>.ts`.

#### Scenario: Подпись сниппета

- **WHEN** глава показывает `app.ts` примера «сервис пользователей»
- **THEN** первая строка блока кода — `// examples/users-service/src/app.ts`
