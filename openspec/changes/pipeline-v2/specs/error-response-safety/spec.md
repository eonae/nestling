# error-response-safety — delta

## MODIFIED Requirements

### Requirement: Fail responses are not affected

Ошибки, брошенные как `Fail`, SHALL сохранять текущее поведение: `message`
и `details` попадают в тело ответа независимо от `exposeErrorDetails` —
их раскрытие является осознанным решением автора кода. Юниты `.catch`
пайплайна MAY заменить `Fail`-ответ другим `Fail`-ответом (это тоже
осознанное решение автора endpoint'а); политика раскрытия
необработанных ошибок при этом не ослабляется.

#### Scenario: Fail.badRequest with default options

- **WHEN** handler бросает `Fail.badRequest('Email already taken', { field: 'email' })`
  без `exposeErrorDetails`
- **THEN** ответ 400 содержит `"error": "Email already taken"` и
  `details: { field: 'email' }`

#### Scenario: catch-юнит переоформляет Fail

- **WHEN** `.catch`-юнит заменяет `Fail`-ответ на другой `Fail`
  с изменённым телом
- **THEN** транспорту уходит заменённый ответ; необработанные (не `Fail`)
  ошибки по-прежнему маскируются generic-сообщением по умолчанию
