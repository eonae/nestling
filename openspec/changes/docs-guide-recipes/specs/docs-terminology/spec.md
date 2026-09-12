## RENAMED Requirements

- FROM: `### Requirement: Список целей линтера покрывает гайд и соглашения`
- TO: `### Requirement: Список целей линтера покрывает обе папки гайда и документы корня`

## MODIFIED Requirements

### Requirement: Список целей линтера покрывает обе папки гайда и документы корня

Список целей по умолчанию `DEFAULT_TARGETS` SHALL включать `docs/guide`,
`docs/recipes`, `docs/conventions.md`, `docs/guarantees.md` и
`docs/from-nestjs.md`.

#### Scenario: Прогон без аргументов

- **WHEN** линтер запускается без путей
- **THEN** проверяются главы `docs/guide/*.md`, рецепты
  `docs/recipes/*.md`, `docs/conventions.md`, `docs/guarantees.md` и
  `docs/from-nestjs.md`

<!-- docs-style: off -->
#### Scenario: Голое слово в рецепте

- **WHEN** рецепт `docs/recipes/ops.md` содержит слово «токен» без
  приставки
- **THEN** линтер стиля печатает ERROR с именем файла и строкой
<!-- docs-style: on -->
