## Context

`Operation<I, O, E, K>` (`packages/nestling.operations/src/operation.ts:73-129`)
уже несёт объявленные отказы публичным полем `readonly errors?: E`, где
`E extends readonly AnyFailDefinition[]` — конкретный тюпл определений
`makeFail`, а не стёртый до `unknown[]` тип. `ChargeCard.errors` уже
доступен и протестирован (`operation.spec.ts:23`:
`expect(ChargeCard.errors).toEqual([CardDeclined])`), значение операции
заморожено (`Object.freeze` в `declare()`, `operation.ts:621`).

Рядом в том же файле уже есть три производных типовых хелпера по
одинаковому `infer`-паттерну — `InputFormOf`, `OutputFormOf`
(`operation.ts:173-178`) и `OperationFailsOf` (`operation.ts:198-203`).
Последний даёт **union значений `Fail`** (через фантомное поле `$fail`
определения), а не список определений — он решает другую задачу
(типизация `Output<T, E>` реализации), и для `errorsOf` не подходит:
`errors: [...errorsOf(ClaimQuota), EmailTaken]` собирает список
**определений**, из которого затем компилятор сам выведет union `Fail`
через существующий `OperationFailsOf`.

Внутри пакетов уже есть несколько мест с тем же паттерном чтения,
написанным вручную: `packages/nestling.app/src/ports/invoker.ts:200-206`,
`packages/nestling.testing/src/stub.ts:209`,
`packages/nestling.client/src/client.ts:287`. Но их цель другая: слить
`errors:` операции с кодами ядра/пайплайна для распознавания ответа или
для проверки стаба, а не для переноса в `errors:` вызывающей декларации
пользователем. `errorsOf` формализует именно пользовательский сценарий
из `examples/app-with-http/src/api/operations.ts:12,45-50`, где
`QuotaExceeded` — отказ операции `ClaimQuota`
(`examples/app-with-http/src/operations.ts:19-38`) — переписан вручную в
`errors:` операции `CreateUser`.

## Goals / Non-Goals

**Goals:**

- Публичный хелпер `errorsOf(operation)` в `@nestlingjs/operations`,
  который отдаёт `operation.errors` тем же значением, с сохранением
  тюпл-типа конкретных определений на уровне TypeScript.
- Использование в `errors: [...errorsOf(X), OwnFail]` типизирует хендлер
  так же, как если бы отказы `X` были перечислены напрямую — проверяется
  фикстурой type-test.
- Операция без `errors:` даёт `errorsOf(operation) === []`.
- Компилятор отвергает `errorsOf` от операции вида `event` — у события
  `errors` невыразим (`EventSpec`, `operation.ts:576-584`).

**Non-Goals:**

- Не рефакторит внутренние места (`invoker.ts`, `stub.ts`, `client.ts`,
  `endpoint.ts` `effectiveErrors`, `openapi/responses.ts`), которые уже
  читают `operation.errors ?? []` — они решают другую задачу (слияние с
  кодами ядра/пайплайна), а не отдают значение пользователю.
- Не вводит `OperationErrorsOf<C>` отдельным экспортируемым типом:
  сигнатуры функции с generic-параметром `E`, выводимым из аргумента,
  достаточно; отдельный алиас увеличил бы публичную поверхность без
  дополнительной возможности.
- Не проверяет и не меняет правила создания `errors:` (дубли `code`,
  слияние с отказами слоёв) — `contract-declarations` и
  `layer-declared-fails` не трогаются.

## Decisions

### Сигнатура и место в коде

```typescript
export function errorsOf<E extends readonly AnyFailDefinition[]>(
  operation: Operation<any, any, E, 'request' | 'command'>,
): E {
  return operation.errors ?? ([] as unknown as E);
}
```

Функция и, если понадобится по ходу реализации, вспомогательный тип
живут в `packages/nestling.operations/src/operation.ts` рядом с
`InputFormOf`/`OutputFormOf`/`OperationFailsOf` — тем же файлом, тем же
`infer`-стилем; барель `index.ts` (`operation.ts` — 20-я секция,
`index.ts:144-164`) получает новый экспорт значения в этой же группе.

Четвёртый тип-параметр `Operation` ограничен объединением
`'request' | 'command'` вместо `OperationKind`: `EventOperation<I,O,E>`
имеет `K = 'event'`, не входящий в объединение, поэтому передача события
в `errorsOf` — ошибка компиляции без отдельной рантайм-проверки вида.
Альтернатива (проверка вида в рантайме с `throw`) отвергнута: у события
`errors:` невыразим уже на уровне типа его конструктора, дублировать
проверку в рантайме нечем — до вызова `errorsOf` событие физически не
может нести `errors`.

### Возврат ссылки без копирования

Возвращается сам `operation.errors` (или замороженный `[]` по
умолчанию), а не его копия. Значение операции уже заморожено при
создании (`Object.freeze`, `operation.ts:621`), и вызывающая сторона
использует результат только для чтения через spread в новом массиве
(`errors: [...errorsOf(X), Own]`) — копия на этом шаге и так возникает
собственным массивом-литералом декларации, второй уровень копирования не
нужен.

### Отсутствие рантайм-валидации аргумента

`errorsOf` не проверяет во время выполнения, что `operation` — значение
`makeRequest`/`makeCommand`, а полагается на тип TypeScript.
`assertFailDefinitions` (`operation.ts:391-427`) уже проверила элементы
`errors:` при создании самой операции — вторая проверка на чтении была
бы избыточной, а модуль ошибок и так рассчитан на дисциплину типов
(`no runtime magic`, `guarantee over convention`).

## Risks / Trade-offs

- **Вывод типа `E` из четырёхпараметрического `Operation<any,any,E,K>`
  через generic-функцию** → риск минимален: тот же паттерн уже работает
  для `OperationFailsOf` и трёх других хелперов в этом файле; type-test
  фикстура (аналогично `families.type-test.ts`) закрепляет позитивный и
  негативный (`@ts-expect-error` на `makeEvent`) случаи.
- **`AnyOperation`-типизированная переменная (широкий `K = OperationKind`)
  не пройдёт в `errorsOf`**, даже если рантайм-значение — запрос → это
  ожидаемое поведение: `errorsOf` предназначен для точки объявления, где
  тип операции — литерал её конструктора, а не стёртый до `AnyOperation`;
  тот же компромисс уже есть у `OperationFailsOf`.

## Migration Plan

Чисто аддитивное изменение одного пакета, без раздела миграции: новый
экспорт, один переписанный пример, без изменения существующих сигнатур.
Обкатка — `examples/app-with-http/src/api/operations.ts`
(`errors: [EmailTaken, ...errorsOf(ClaimQuota), Unauthorized]`) и
`yarn verify`.
