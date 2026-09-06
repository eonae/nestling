## MODIFIED Requirements

### Requirement: Юнита `validate()` в публичном API нет

Пакет `@nestling/app` SHALL NOT экспортировать юнит `validate()`.
Сигнатура `Pipeline.executeWithHandler` SHALL типизировать аргумент
`payload` хендлера как `unknown`; тип `meta` SHALL по-прежнему исключать
ключ `payload`.

#### Scenario: Импорт не компилируется

- **WHEN** код импортирует `validate` из `@nestling/app`
- **THEN** импорт не резолвится (ошибка компиляции)

#### Scenario: Пользовательский `payload` не попадает в мету

- **WHEN** пайплайн содержит `.pre`-юнит, возвращающий
  `{ payload: unknown }`
- **THEN** тип `meta` в `executeWithHandler` не содержит ключа `payload`,
  а `payload` типизирован как `unknown`
