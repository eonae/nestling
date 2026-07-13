# pipeline-phase-model

## Purpose

Фазовая модель одного слоя пайплайна: `makePipeline()` с фазами
`.pre`/`.ok`/`.catch`/`.after`/`.finally` вместо `definePipeline().use()`,
порядок исполнения фаз, честная типизация контекста на ответном тракте
и исход выполнения в `finally`.

## Requirements

### Requirement: makePipeline со словарём фаз заменяет definePipeline().use()

Пакет `@nestling/pipeline` SHALL предоставлять `makePipeline()` — билдер
одного слоя с методами `.pre`, `.ok`, `.catch`, `.after`, `.finally`.
Прежний API (`definePipeline`, `Pipeline.use()`, типы
`IMiddleware`/`MiddlewareFn`) SHALL быть удалён из публичного экспорта.
Билдер SHALL быть иммутабельным: каждый метод возвращает новый пайплайн.

#### Scenario: Сборка слоя из фаз

- **WHEN** объявлен `makePipeline().pre(withRequestId()).pre(validate()).catch(mapError).finally(audit)`
- **THEN** получается исполнимый пайплайн; тип накопленного input отражает
  добавки pre-юнитов в порядке объявления

#### Scenario: Старый API отсутствует

- **WHEN** код импортирует `definePipeline` или `MiddlewareFn`
  из `@nestling/pipeline`
- **THEN** импорт не резолвится (ошибка компиляции)

### Requirement: Type-state билдера — pre недоступен после ответных методов

Билдер SHALL запрещать (на уровне типов) вызов `.pre` после первого
вызова любого ответного метода (`.ok`/`.catch`/`.after`/`.finally`):
декларация читается сверху вниз как порядок исполнения.

#### Scenario: pre после catch — ошибка компиляции

- **WHEN** объявлен `makePipeline().catch(u).pre(v)`
- **THEN** вызов `.pre` — ошибка компиляции

### Requirement: Исполнение одного слоя

Рантайм SHALL исполнять слой так: pre-юниты строго в порядке объявления;
падение pre-юнита ⇒ хендлер не вызывается и сразу начинается ответная
фаза с `Fail`; хендлер вызывается только если все pre прошли; ответные
юниты исполняются строго в порядке объявления, юнит применяется по
применимости к текущему ответу (`.ok` — только к успеху, `.catch` — только
к `Fail`, `.after` — к любому) и может заменить ответ возвратом нового.

#### Scenario: Успешный проход

- **WHEN** все pre прошли и хендлер вернул `Ok`
- **THEN** исполняются `.ok` и `.after` юниты в порядке объявления,
  `.catch` не исполняется

#### Scenario: Падение pre

- **WHEN** второй из трёх pre-юнитов бросает `Fail.unauthorized()`
- **THEN** третий pre и хендлер не вызываются; `.catch`/`.after` получают
  ответ `Fail` со статусом `UNAUTHORIZED`

#### Scenario: Замена ответа в catch

- **WHEN** `.catch`-юнит возвращает новый `ErrorResponseContext`
- **THEN** последующие ответные юниты видят заменённый ответ,
  и он же уходит транспорту

### Requirement: Честная типизация ctx на ответном тракте

Юниты `.ok` SHALL получать полный накопленный контекст слоя (успех
гарантирует, что весь pre-тракт прошёл). Юниты `.catch`/`.after`/`.finally`
SHALL получать поля собственного pre-тракта как `Partial` (обогащение
могло не случиться), а требования слоя к внешнему контексту — полными.
`.ok`-юнит SHALL NOT иметь возможности (типами возврата) заменить успех
на ошибку, `.catch`-юнит — ошибку на успех: успех приходит только
из хендлера (ограничение v1).

#### Scenario: ok видит полный контекст

- **WHEN** pre-юниты добавили `requestId` и `identity`, хендлер вернул `Ok`
- **THEN** `.ok`-юнит читает `ctx.input.requestId` и `ctx.input.identity`
  без проверок на undefined (тип полный)

#### Scenario: catch видит Partial собственного слоя

- **WHEN** первый pre добавил `requestId`, второй pre упал до добавления
  `identity`
- **THEN** `.catch`-юнит видит `requestId`, а `identity` — `undefined`;
  тип обоих полей — optional

### Requirement: finally получает исход выполнения

`.finally`-юниты SHALL вызываться всегда — последними в слое, с исходом
`completed | disconnected | aborted | failed` и итоговым ответом. В v1
исход SHALL вычисляться так: `meta.signal` взведён по причине дисконнекта →
`disconnected`; взведён по иной причине (shutdown) → `aborted`; иначе
`completed`/`failed` по успешности итогового ответа. Ограничение v1
(задокументированное): `finally` вызывается после ответной фазы, до
фактической отправки транспортом; точная семантика «всё дотекло»
вводится в streaming-v2.

#### Scenario: Исход completed

- **WHEN** хендлер вернул `Ok` и сигнал не взведён
- **THEN** `.finally` вызывается с исходом `completed`

#### Scenario: Исход aborted при shutdown

- **WHEN** во время обработки транспорт закрыт (`meta.signal` взведён
  с причиной shutdown) и хендлер завершился
- **THEN** `.finally` вызывается с исходом `aborted`
