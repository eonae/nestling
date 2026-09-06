## MODIFIED Requirements

### Requirement: makePipeline со словарём фаз заменяет definePipeline().use()

Пакет `@nestling/app` SHALL предоставлять `makePipeline()` — билдер
одного слоя с методами `.pre`, `.ok`, `.catch`, `.finally`. Словарь
ответной фазы SHALL быть исчерпан тройкой `.ok`/`.catch`/`.finally`
(зеркало `then`/`catch`/`finally` у `Promise`): постпроцессор,
обработчик ошибок, наблюдатель исхода. Прежний API (`definePipeline`,
`Pipeline.use()`, типы `IMiddleware`/`MiddlewareFn`) SHALL быть удалён
из публичного экспорта. Билдер SHALL быть иммутабельным: каждый метод
возвращает новый пайплайн.

#### Scenario: Сборка слоя из фаз

- **WHEN** объявлен `makePipeline().pre(withRequestId()).pre(withIdentity(auth)).catch(mapError).finally(audit)`
- **THEN** получается исполнимый пайплайн; тип накопленного input отражает
  добавки pre-юнитов в порядке объявления

#### Scenario: Старый API отсутствует

- **WHEN** код импортирует `definePipeline` или `MiddlewareFn`
  из `@nestling/app`
- **THEN** импорт не резолвится (ошибка компиляции)
