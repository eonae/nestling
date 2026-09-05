# packages-layout

## ADDED Requirements

### Requirement: Каталог `packages/` содержит только пакеты фреймворка

Каждый каталог `packages/*` SHALL быть либо публикуемым пакетом скоупа
`@nestling`, либо служебным пакетом с `private: true`. Пакетов скоупа
`@common` без флага `private` SHALL NOT существовать: скоуп репозиторию
не принадлежит, и публикация под ним невозможна.

Служебный код, у которого один потребитель, SHALL жить внутри этого
потребителя, а не отдельным пакетом. Отдельным пакетом служебный код
SHALL оставаться только при технической причине — например, когда
потребитель бандлит его сборщиком и вынести код нельзя без изменения
сборки.

#### Scenario: Публикация не упирается в чужой скоуп

- **WHEN** выполнен `lerna publish --dry-run`
- **THEN** ни один пакет скоупа `@common` в список публикуемых не попадает

#### Scenario: Служебный пакет с одним потребителем

- **WHEN** в `packages/` заводится пакет, который импортирует ровно один
  другой пакет репозитория, и он не бандлится потребителем
- **THEN** это расхождение с требованием: код принадлежит потребителю

#### Scenario: Бандлящийся служебный пакет остаётся

- **WHEN** `@nestling/viz` собирает `dist/cli.js` через esbuild, включая
  в бандл `@common/static-server`
- **THEN** пакет остаётся отдельным и несёт `private: true`

### Requirement: Объявленные зависимости совпадают с импортируемыми

Для каждого пакета множество внутренних зависимостей, объявленных в
`package.json` (`dependencies` и `peerDependencies` скоупов `@nestling`
и `@common`), SHALL совпадать с множеством пакетов, которые импортирует
его `src/` вне спеков.

Зависимость, объявленная и не импортируемая, SHALL быть удалена.
Зависимость, импортируемая и не объявленная, SHALL быть добавлена.

#### Scenario: Лишнее объявление

- **WHEN** `package.json` пакета объявляет `@nestling/streams`, а ни один
  модуль `src/` его не импортирует
- **THEN** это расхождение с требованием

#### Scenario: Недостающее объявление

- **WHEN** модуль `src/` импортирует `@nestling/transport.http`, а
  `package.json` пакета его не объявляет
- **THEN** это расхождение с требованием

#### Scenario: Импорт только из спеков объявления не требует

- **WHEN** пакет импортирует другой пакет только в файлах `*.spec.ts`
- **THEN** объявлять его в `dependencies` не требуется

### Requirement: Слой Standard Schema живёт в пакете операций

Тип схемы и работа с ним SHALL иметь один дом — `@nestling/operations`.
Пакет SHALL экспортировать `Schema`, `StandardSchemaV1`, `Infer`,
`DomainType`, `validateSync`, `assertStandardSchema`,
`SchemaValidationError`, `SchemaIssue`, а также типы-утилиты
`Constructor` и `Optional`.

Второго физического определения этих символов в репозитории SHALL NOT
существовать: пакет, которому нужна проверка схемы, импортирует её из
`@nestling/operations`, а не заводит свою копию.

#### Scenario: Проверка схемы из одного места

- **WHEN** `@nestling/config` проверяет секцию по схеме
- **THEN** он импортирует `validateSync` и `SchemaValidationError` из
  `@nestling/operations`

#### Scenario: Отказ ловится одним `instanceof`

- **WHEN** `@nestling/config` и `@nestling/pipeline` бросают
  `SchemaValidationError`
- **THEN** обе ошибки — экземпляры одного класса, и одна проверка
  `instanceof` ловит обе

#### Scenario: Тип спецификации берётся из спецификации

- **WHEN** пакету нужен только тип `StandardSchemaV1` и ничего больше
- **THEN** он импортирует его из `@standard-schema/spec` напрямую, не
  заводя зависимости от `@nestling/operations`

### Requirement: Сборка пакета не выносит наружу тестовый код

`dist` пакета SHALL содержать только его исходники. Файлы проверки типов
(`*.type-test.ts`), спеки и каталоги фикстур (`__fixtures__`) SHALL быть
исключены в `tsconfig.build.json` наравне с `*.spec.ts` и `*.test.ts`.

Ни один файл в `dist` SHALL NOT импортировать пакет из
`devDependencies`: у установившего пакет такой зависимости нет, и импорт
не разрешится.

#### Scenario: Проверка типов не попадает в dist

- **WHEN** пакет собран и в `src` есть `overrides.type-test.ts`
- **THEN** в `dist` нет ни `overrides.type-test.js`, ни его `.d.ts`

#### Scenario: Фикстуры не попадают в dist

- **WHEN** пакет собран и в `src` есть каталог `__fixtures__`
- **THEN** в `dist` этого каталога нет

#### Scenario: Импорт devDependency из dist

- **WHEN** файл в `dist` импортирует пакет, объявленный только в
  `devDependencies`
- **THEN** это расхождение с требованием
