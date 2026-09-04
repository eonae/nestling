# layer-fails

## Why

Отказ, которым завершается pre-юнит слоя, сегодня объявляет каждый
endpoint, подключивший слой: `errors: [UserNotFound, Unauthorized]`.
Забытое объявление даёт молчаливый `500` вместо `401`, документ OpenAPI не
показывает `401` у endpoint'а, который его возвращает, а автор нового
endpoint'а обязан помнить про чужой отказ. Вывести множество нельзя:
`throw` компилятору не виден, а проверка на границе и генератор OpenAPI
читают значение `EndpointMeta.errors`. Объявление должно существовать как
значение между endpoint'ом и юнитом, и таким местом становится слой.
Вместе с этим закрываются два шва типа результата хендлера: `Output<T, E>`
не допускает отказы ядра, которые рантайм и `PortResult` допускают, и
декларация без `output` требует `return undefined`. Решения —
[ideas.md [2026-09-04]](../../../docs/decisions/ideas.md) «Отказы слоя:
объявление в `.pre(unit, { errors })`, канал `return` у pre-юнита,
эффективное множество `errors`» и «`Output<T, E>` допускает отказы ядра;
`void` у хендлера без `output`»; обсуждение —
[d/09](../../../docs/history/discussions/09-framework-review.md). Change
идёт после `handler-two-forms` (#33): он меняет те же перегрузки
конструкторов, и делать это над сокращённым набором дешевле.

## What Changes

- **BREAKING** `.pre(unit, { errors: [Def, …] })`: второй аргумент
  объявляет отказы юнита. Пайплайн несёт их в типе (`TFails`) и в значении
  рядом с объявленными переменными; `compose` объединяет, `bind` и
  деривация сохраняют.
- **BREAKING** Pre-юнит может вернуть отказ значением: тип результата —
  добавка к контексту либо отказ из объявленных в этой точке `.pre`;
  возвращённый отказ вне списка — ошибка компиляции. Рантайм узнаёт отказ по
  `isFail` до записи в контекст и начинает ответную фазу. `throw` остаётся
  и требует объявления на слое или endpoint'е.
- Эффективное множество отказов endpoint'а — `errors:` декларации плюс
  отказы пайплайна: в типе хендлера, в `EndpointMeta` для границы, в
  документе OpenAPI. Хендлер может вернуть отказ, объявленный слоем.
- **BREAKING** Форма с операцией (`httpEndpoint({ operation, pipeline })`,
  `implement(Operation, { pipeline })`) требует, чтобы отказы пайплайна
  входили в `errors:` операции; нарушение — ошибка компиляции с литералом
  `__error` и подсказкой добавить определение в операцию; та же проверка
  на фазе ASSEMBLE.
- **BREAKING** `Output<T, E>` и `OutputSync<T, E>` включают отказы ядра
  (`BadRequest`, `PayloadTooLarge`, `Timeout`, `InternalError`); каст
  `claimed as ReturnType<typeof QuotaExceeded>` в примере уходит.
- Декларация без `output`: тип результата хендлера принимает `void`;
  `return undefined` и отключённые правила линтера уходят из подписчиков.
- Примеры: слой `authed` объявляет `Unauthorized`; endpoint'ы и операции
  проверяются на согласованность; подписчики без `return undefined`.
  Гайд: главы 3, 9, 13, приложение А. README пакетов `pipeline`,
  `operations`, `transport.http`, `ports`, `openapi`.
- `design/pipeline.md` §2–§3, `design/errors.md` §1 и §4,
  `design/endpoints.md` §2 уже описывают целевое состояние.

## Capabilities

### New Capabilities

- `layer-declared-fails`: объявление отказов в `.pre(unit, { errors })`,
  `TFails` и множество определений на значении пайплайна, эффективное
  множество endpoint'а, проверка формы с операцией.

### Modified Capabilities

- `pipeline-phase-model`: «Исполнение одного слоя» — pre-юнит может
  вернуть отказ; граница сверяет ответ с эффективным множеством.
- `pipeline-composition`: добавлено требование «Пайплайн-значение несёт
  множество объявленных отказов», симметричное требованию об
  ambient-переменных: `compose` объединяет, `bind` и деривация сохраняют,
  `TFails` выводится без разворачивания по глубине.
- `endpoint-error-contract`: `errors:` и эффективное множество; тип
  отказов хендлера включает отказы слоя и отказы ядра; `EndpointMeta`
  несёт эффективное множество.
- `error-values`: `Output` допускает отказы ядра; `void` без `output`.
- `openapi-document`: `responses` строятся по эффективному множеству.
- `endpoint-declarations`, `contract-implementations`: форма с операцией и
  `implement` требуют вхождения отказов пайплайна в `errors:` операции
  (добавленные требования).

## Impact

- Пакеты: `@nestling/pipeline` (`core/pipeline.ts`: `TFails`, второй
  аргумент `.pre`, проверка `isFail` после юнита, эффективное множество в
  `makeEndpoint`; `core/types/unit.ts`: `PreUnitFn`; `metadata/endpoint.ts`),
  `@nestling/operations` (`Output`, `OutputSync`, `InferOutput` для
  отсутствующего `output`, экспорт объединения отказов ядра),
  `@nestling/transport.http` и `@nestling/transport.cli` (перегрузки,
  проверка формы с операцией), `@nestling/ports` (`implement`,
  ASSEMBLE-проверка), `@nestling/app` (ASSEMBLE-проверка),
  `@nestling/openapi` (эффективное множество), `@nestling/testing`
  (`testApp.call` — тип ответа).
- Бюджет типов: новый параметр `Pipeline`; замер раннером `type-budget`
  обязателен, пороги двигаются только с записью в `BUDGET.md`.
- Примеры: `examples.users-service`, `examples.app-with-http`,
  `examples.split-nats`; гайд и README.

## Non-goals

- Сужение `res.value` в `.catch`-юните по `TFails` — открытый вопрос
  записи ideas.md, отдельное решение.
- Объявление отказов на уровне `makeApp`, объявление на самом юните,
  вывод из возвращаемого типа без значения — отвергнуты в записи.
- Изменение состава отказов ядра и таблицы категорий.
