# layer-fails — design

## Context

Пайплайн (`@nestling/pipeline`, `src/core/pipeline.ts`) накапливает
`input` pre-юнитами: `PreUnitFn<TInput, TAddition>` возвращает добавку,
рантайм спредит её в контекст (`layer.pre` в `executeWithHandler`).
Отказ из pre-юнита сегодня возможен только броском. Тип
`Pipeline<TReq, TAcc, TNeeds>` несёт требования, накопленный контекст и
отложенные зависимости; значение хранит провенанс композиции (`sources`)
и множество объявленных переменных (`declared`) для `hasVar`; `compose`
объединяет, `bind` сохраняет.

Проверка на границе (`pipeline.ts`, около строки 975) сверяет код ответа с
`endpoint.errors` из `EndpointMeta` и с `isKernelFailCode`; всё остальное
становится `InternalError`. `EndpointMeta.errors` заполняет декларация
(`makeEndpoint`) из `errors:`; генератор OpenAPI читает то же поле
декларации. `Output<T, E>` в `@nestling/operations` (`make-fail.ts`) —
`Promise<Ok<T> | FailOfDef<E> | T>`; `PortResult<C>` в `families.ts`
включает `KernelPortFail`. `InferOutput<undefined>` в `io/io.ts` даёт
`undefined`.

После `handler-two-forms` конструкторы деклараций несут по одной
перегрузке на форму хендлера: `httpEndpoint` — четыре, `implement` и
`cliEndpoint` — по две. Форма с операцией уже объявляет поля интерфейса
как `never` и берёт `errors` с операции.

Целевое состояние записано в `design/pipeline.md` (§2 «Исполнение одного
слоя», §3 «Отказы слоя», §5), `design/errors.md` (§1, §4),
`design/endpoints.md` (§2 «`errors:`»). Ограничения: обратной совместимости
нет; `yarn verify` включает `type-budget` с порогами из `BUDGET.md`;
рантайм-тесты для ядра пайплайна обязательны.

## Goals / Non-Goals

**Goals:**

- Отказ pre-юнита объявляется один раз, на слое; endpoint'ы и OpenAPI
  получают его автоматически; форма с операцией не даёт отказу слоя
  протечь мимо контракта.
- Pre-юнит возвращает отказ значением с проверкой компилятора.
- `Output` совпадает с правилом рантайма по отказам ядра; хендлер без
  `output` возвращает `void`.

**Non-Goals:**

- Сужение типа `.catch`-юнита по `TFails`.
- Изменение семантики `throw`: брошенный отказ по-прежнему проверяется
  только на границе.

## Decisions

### D1. Объявление — второй аргумент `.pre`, не свойство юнита и не поле `makePipeline`

`pre(unit, options?: { errors?: readonly AnyFailDefinition[] })`. Список
проверяется при вызове так же, как `errors:` декларации: не определение и
повторяющийся код — ошибка с указанием слоя. Объявление живёт там, где
юнит подключается, потому что слой уже является единицей политики
(`hasLayer`) и единицей композиции; юнит остаётся обычной функцией или
классом без метаданных об отказах.

Альтернативы: поле `makePipeline({ errors })` на весь слой — теряет связь
«какой юнит какой отказ даёт», которая нужна проверке возврата (D3);
статическое поле класса-юнита — не подходит функции-юниту и добавляет
форму. Обе отвергнуты записью ideas.md.

### D2. `TFails` — четвёртый тип-параметр; значение хранит `Set` определений

`Pipeline<TReq, TAcc, TNeeds, TFails = never>`; `PipelineTypes` получает
поле `fails`. `.pre(unit, { errors })` даёт
`PipelineBuilder<TReq, TAcc & Add, TNeeds | Needs, TFails | F[number]>`;
`.ok`, `.catch`, `.finally` сохраняют `TFails`; `compose` выводит
объединение через `$types`, как выводит `TAcc` и `TNeeds`; `AnyPipeline`
получает `any` в четвёртой позиции. Значение хранит
`declaredFails: ReadonlySet<AnyFailDefinition>` рядом с `declared`;
`compose` объединяет множества, `bind` и деривация билдера копируют.
Совпадение определений — по `code`, как у `errors:` декларации: два
определения с одним кодом — один отказ.

Бюджет: параметр не участвует в проверке требований слоя (`Guard`) и не
разворачивается по глубине `compose`; ожидаемый рост — линейный по числу
вызовов `.pre` с `errors`, как у `E` в сигнатуре хендлера. Замер до и
после — обязательная задача; пороги `BUDGET.md` не двигаются без строки в
таблице замеров.

### D3. Канал `return` у pre-юнита

`PreUnitFn<TInput, TAddition, TFail = never>` возвращает
`TAddition | TFail | undefined | void` синхронно или в `Promise`.
`ValidatePreUnit` дополняется проверкой: `Extract<Return, AnyFail>`
входит в `FailOfDef<F[number]> | KernelFail`, иначе тип-ошибка
`{ __error: 'Pre-unit returns a fail that is not declared in errors of this .pre'; undeclared: … }`
в формате `pipeline-type-diagnostics`. `ExtractAddition` берёт
`Exclude<Return, AnyFail>`, поэтому объявленный отказ не попадает в
накопленный `input`.

Рантайм: после `await materialized(entry)(currentCtx)` проверка
`isFail(result)`; при отказе — переход к ответной фазе тем же путём, что
при броске. Добавка, случайно похожая на отказ (`isFail === true` и
строковый `code`), трактуется как отказ: это тот же дискриминант, на
котором держится `Ok`/`Fail`.

`throw` из юнита не меняется: компилятор его не видит, граница проверяет
код по эффективному множеству. Канон гайда для юнитов — `return`, как для
хендлеров; `throw` — доставка из глубины.

### D4. Эффективное множество считает `makeEndpoint`

`makeEndpoint` объединяет `errors:` декларации и `pipeline.declaredFails`
в одно значение и кладёт его в `EndpointDefinition.errors` и далее в
`EndpointMeta.errors`. Дубли по коду схлопываются. Тип хендлера получает
`E = FailsOf<Errors> | TFails`; для класс-формы аннотация
`Output<T, typeof Def>` с отказом слоя компилируется. Генератор OpenAPI
читает `EndpointDefinition.errors` и ничего не пересчитывает: `responses`
получают ответы слоя автоматически. Граница пайплайна читает
`EndpointMeta.errors` без изменений в коде проверки.

Альтернатива — держать два поля (`errors` декларации и `layerErrors`) и
объединять в каждом потребителе — отвергнута: три потребителя, одно
правило, одно место.

### D5. Форма с операцией: проверка в типах и на ASSEMBLE

Для `httpEndpoint({ operation, pipeline })` и `implement(Operation,
{ pipeline })` тип слота `pipeline` — условный: если `TFails` пайплайна не
входит в `OperationFailsOf<C>` (с учётом отказов ядра), слот принимает
литерал `{ __error: 'Layer may fail with errors the operation does not declare'; undeclared: …; hint: 'add the definitions to errors of the operation' }`.
Форма литерала — как у слота `pipeline` при несовпадении требований
слоя (там уже есть `hint`). Рантайм-зеркало: `makeEndpoint` в форме с
операцией сравнивает коды `declaredFails` с `errors` операции и бросает
при создании декларации; `App` на ASSEMBLE ничего дополнительно не
проверяет, потому что декларация уже создана с проверкой. Если проверка
при создании декларации по каким-то формам недостижима (декларация
создана до операции), её дублирует ASSEMBLE.

Почему обязать операцию, а не расширить её множество автоматически:
операция — контракт, её импортирует клиент, и клиент не видит пайплайн
реализации. Автоматическое расширение сделало бы тип клиента неполным.

### D6. `Output` и отказы ядра; `void` без `output`

`@nestling/operations` экспортирует объединение определений ядра
(`KernelFail`: `BadRequest | PayloadTooLarge | Timeout | InternalError`).
`OutputSync<T, E> = Ok<T> | FailOfDef<E> | FailOf<KernelFail> | T`,
`Output` — то же в `Promise`. `PortResult<C>` за вычетом `Ok` становится
подмножеством допустимого, и `return claimed` после `if (claimed.isFail)`
компилируется. `E` по умолчанию остаётся `never`: доменный отказ без
объявления не компилируется.

`InferOutput<undefined>` даёт `void`. `HandlerFn` для декларации без
`output` принимает `Promise<void>` и синхронный `void`; `Ok.noContent()`
и `new Ok(null)` остаются допустимы через `Ok<void>`-совместимость или
явную ветку `Ok<null>` — выбор фиксируется в коде и README `operations`.
Правило `unicorn/no-useless-undefined` в примерах больше не отключается.

### D7. Примеры и гайд

`examples.users-service` и `examples.app-with-http`: `authed` объявляет
`Unauthorized` при подключении `Authenticate`; `DeleteUser`,
`UpdateUser`, `UploadAvatar` и прочие endpoint'ы со слоем перестают
перечислять `Unauthorized`; операции в `api/operations.ts` его сохраняют
(контракт); проверка D5 подтверждает согласованность. `create-user`
теряет каст. Подписчики и владельцы команд — без `return undefined`.
`examples.split-nats` — то же для реализаций с `TenantId.propagated()`
(отказов нет, изменений нет, проверка проходит).

Гайд: глава 3 — `Output` и отказы ядра одной фразой; глава 9 — объявление
на слое, `DeleteUser` без `Unauthorized`, абзац о том, что `401` в OpenAPI
появляется у всех мутирующих endpoint'ов через `hasLayer`; глава 13 —
подписчики без `return undefined`; приложение А — раздел «Отказ броском»
становится «Отказ из юнита: `return` канон, `throw` для глубины».

## Risks / Trade-offs

- [Рост бюджета типов от `TFails`] → замер раннером до и после; параметр
  не входит в `Guard`; при сверхлинейном росте — вывод `TFails` через
  `$types` тем же приёмом, что спас `compose`.
- [Юнит возвращает объект с полем `isFail: true` как добавку] →
  трактуется как отказ по дискриминанту; документируется в README
  `pipeline` одной строкой.
- [Операция вынуждена перечислять сквозные отказы] → цена признана
  правильной в записи ideas.md; константа со спредом `errors:
  [...authFails, …]` снимает повтор.
- [Снапшоты диагностик `pipeline` и `transport.http` меняются] →
  обновляются в change; тексты читаются глазами.
- [`void` в объединении с `Ok<T>` даёт неожиданное сужение] → покрывается
  type-tests: `async () => {}`, `() => Ok.noContent()`, `() => undefined`.

## Migration Plan

Пользователей нет. Порядок внутри change: типы и рантайм `pipeline`
(D1–D4) с рантайм-тестами → `operations` (D6) → перегрузки конструкторов
и форма с операцией (D5) → `openapi` и `testing` → примеры → гайд, README,
спеки. `type-budget` после D2 и после D5.

## Open Questions

- Сужение `res.value` в `.catch` по `TFails ∪ E ∪ KernelFail`: после
  замера бюджета, отдельной записью.
- Точная форма совместимости `void` и `Ok<null>` у декларации без
  `output`: решает apply-сессия по результатам type-tests, записывает в
  README `operations`.
