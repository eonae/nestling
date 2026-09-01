## MODIFIED Requirements

### Requirement: Fail responses are not affected

Ошибки, брошенные или возвращённые как **задекларированный** `Fail`
(код входит в `errors:` endpoint'а или в набор kernel-кодов), SHALL
сохранять текущее поведение: `message`, `code` и `details` попадают в тело
ответа независимо от `exposeErrorDetails` — их раскрытие является
осознанным решением автора кода. Юниты `.catch` пайплайна MAY заменить
`Fail`-ответ другим `Fail`-ответом (это тоже осознанное решение автора
endpoint'а); политика раскрытия необработанных ошибок при этом не
ослабляется.

**Незадекларированный** отказ привилегии раскрытия не имеет: он
нормализуется в `UnknownError` (capability `endpoint-error-contract`) и
подчиняется политике необработанных ошибок — без `exposeErrorDetails`
клиент получает generic-тело, оригинал уходит в диагностический хук.

#### Scenario: Задекларированный отказ с default options

- **WHEN** endpoint объявляет `errors: [EmailTaken]`, хендлер бросает
  `EmailTaken({ email })`, `exposeErrorDetails` выключен
- **THEN** ответ 409 содержит `"code": "EMAIL_TAKEN"`, сообщение отказа
  и его `details`

#### Scenario: Kernel-отказ с default options

- **WHEN** payload не проходит схему `input` при проверке рантаймом перед
  хендлером, а `exposeErrorDetails` выключен
- **THEN** ответ 400 содержит `"code": "VALIDATION_FAILED"` и детали
  issue'ов

#### Scenario: Незадекларированный Fail не раскрывается

- **WHEN** хендлер бросает `Fail.badRequest('email already taken',
  { email })`, отказ не объявлен, `exposeErrorDetails` выключен
- **THEN** ответ — 500 с телом `{ "error": "Internal server error",
  "code": "UNKNOWN" }`; ни сообщение, ни `details` оригинала в тело не
  попадают, а оригинал уходит в диагностический хук

#### Scenario: catch-юнит переоформляет Fail

- **WHEN** `.catch`-юнит заменяет `Fail`-ответ на другой **объявленный**
  `Fail` с изменённым телом
- **THEN** транспорту уходит заменённый ответ; необработанные (не `Fail`)
  ошибки по-прежнему маскируются generic-сообщением по умолчанию
