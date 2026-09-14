## MODIFIED Requirements

### Requirement: Пакет `@nestlingjs/agent-skill` публикуется вместе с ядром

Репозиторий SHALL содержать пакет `@nestlingjs/agent-skill` в каталоге
`packages/nestling.agent-skill/`. Пакет SHALL быть публикуемым: поля `private`
у него SHALL NOT быть, и он SHALL попадать в список
`scripts/packages.mjs` без отдельной правки.

Пакет SHALL быть собран по общему набору конфигов репозитория: `tsconfig.json`,
`tsconfig.build.json`, `eslint.config.js`, `vitest.config.js`, — и SHALL иметь
скрипты `clear`, `typecheck`, `build`, `lint`, `test`.

Тарбол SHALL содержать каталоги `dist` и `skill` и SHALL NOT содержать
`snippets`, `src` и конфиги пакета.

#### Scenario: Состав тарбола

- **WHEN** выполняется `yarn pack:check`
- **THEN** в тарболе есть `package/skill/SKILL.md` и `package/dist/cli.js`, и
  нет ни одного файла `package/src/` и `package/snippets/`

#### Scenario: Импорт установленного пакета

- **WHEN** `yarn pack:check` импортирует установленный `@nestlingjs/agent-skill`
- **THEN** импорт проходит: барель экспортирует `installSkill`
