## RENAMED Requirements

- FROM: `### Requirement: Плашка статуса ведёт на design-док и главу гайда`
- TO: `### Requirement: Плашка статуса ведёт на design-док и главу или рецепт`

## MODIFIED Requirements

### Requirement: Плашка статуса ведёт на design-док и главу или рецепт

За первым абзацем README SHALL идти блок цитаты — плашка статуса.

У публичного пакета плашка SHALL называть статус разработки и содержать
хотя бы одну ссылку в `docs/design/` и хотя бы одну ссылку в `docs/guide/`
или в `docs/recipes/`. Ссылок каждого вида SHALL быть не больше трёх:
перечень из шести design-доков перестаёт быть ориентиром. Ссылки в
`docs/guide/` и в `docs/recipes/` SHALL считаться одним видом: у пакета
один текст-источник, и жанр этого текста выбирает не пакет.

У внутреннего пакета — того, чьё имя начинается с `@nestlingjs/common.`, —
плашка SHALL состоять из одной строки о том, что пакет внутренний. Ссылок
на `docs/design/`, `docs/guide/` и `docs/recipes/` у него SHALL NOT быть.

#### Scenario: Плашка без ссылки на гайд

- **WHEN** README пакета `@nestlingjs/outbox` не содержит ссылки ни в
  `docs/guide/`, ни в `docs/recipes/`
- **THEN** `yarn docs:audit` печатает ERROR с именем файла

#### Scenario: Плашка ведёт на рецепт

- **WHEN** README пакета `@nestlingjs/transport.cli` содержит ссылку в
  `docs/recipes/cli.md` и ссылку в `docs/design/`
- **THEN** `yarn docs:audit` по плашке этого файла молчит

#### Scenario: Слишком много ссылок

- **WHEN** плашка README перечисляет шесть design-доков
- **THEN** `yarn docs:audit` печатает ERROR с числом ссылок

#### Scenario: Внутренний пакет

- **WHEN** README пакета `@nestlingjs/common.graphs` содержит однострочную плашку без
  ссылок в `docs/`
- **THEN** `yarn docs:audit` по плашке этого файла молчит
