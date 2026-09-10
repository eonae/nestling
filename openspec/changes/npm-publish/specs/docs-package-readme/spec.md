## MODIFIED Requirements

### Requirement: Плашка статуса ведёт на design-док и главу гайда

За первым абзацем README SHALL идти блок цитаты — плашка статуса.

У публичного пакета плашка SHALL называть статус разработки и содержать
хотя бы одну ссылку в `docs/design/` и хотя бы одну ссылку в `docs/guide/`.
Ссылок каждого вида SHALL быть не больше трёх: перечень из шести design-доков
перестаёт быть ориентиром.

У внутреннего пакета — того, чьё имя начинается с `@nestlingjs/common.`, —
плашка SHALL состоять из одной строки о том, что пакет внутренний. Ссылок
на `docs/design/` и `docs/guide/` у него SHALL NOT быть.

#### Scenario: Плашка без ссылки на гайд

- **WHEN** README пакета `@nestlingjs/outbox` не содержит ссылки в `docs/guide/`
- **THEN** `yarn docs:audit` печатает ERROR с именем файла

#### Scenario: Слишком много ссылок

- **WHEN** плашка README перечисляет шесть design-доков
- **THEN** `yarn docs:audit` печатает ERROR с числом ссылок

#### Scenario: Внутренний пакет

- **WHEN** README пакета `@nestlingjs/common.graphs` содержит однострочную плашку без
  ссылок в `docs/`
- **THEN** `yarn docs:audit` по плашке этого файла молчит
