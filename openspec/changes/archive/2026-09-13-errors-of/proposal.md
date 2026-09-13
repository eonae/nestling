## Why

Вызывающая операция обязана перечислить в своём `errors:` не только
собственные отказы, но и отказы каждой вызываемой операции, чей `Fail`
она пробрасывает наружу (`if (charge.isFail) return charge`). Список
неотличим от переписанного вручную: `examples/app-with-http/src/api/operations.ts`
копирует `QuotaExceeded` из `errors:` операции `ClaimQuota`
(`examples/app-with-http/src/operations.ts`) в `errors:` операции
`CreateUser`. На пяти операциях это дисциплина, на пятидесяти —
копирование, которого компилятор требует, но в котором не помогает
([ideas.md 2026-09-12 «Разбор обзоров d/10 и d/13», п. 1](../../../docs/decisions/ideas.md),
d/13 §4.1, §6.6; [roadmap.md, строка 76](../../../docs/decisions/roadmap.md)).

## What Changes

- Новый хелпер `errorsOf(operation)`, экспортированный из
  `@nestlingjs/operations`: принимает значение `makeRequest`/`makeCommand`
  (и любую другую декларацию, несущую `errors:`) и отдаёт её список
  отказов тем же значением — тип результата сохраняет union конкретных
  определений `makeFail`, а не расширяется до `AnyFailDefinition[]`.
- `errors:` вызывающей операции пишется через spread результата:
  `errors: [...errorsOf(ClaimQuota), EmailTaken]` вместо ручного
  перечисления чужих отказов.
- Пример `examples/app-with-http/src/api/operations.ts` (`CreateUser`)
  переписан на `errorsOf(ClaimQuota)` вместо прямого импорта и
  перечисления `QuotaExceeded`.
- Документация: `docs/design/operations.md` §1 получает упоминание
  `errorsOf` рядом с описанием `errors:`.

## Non-goals

- Не меняет правила создания `errors:` (проверка дублей `code`,
  объединение с отказами слоёв) — это `contract-declarations` и
  `layer-declared-fails`, они остаются как есть.
- Не обходит цепочку вызовов транзитивно сам: `errorsOf(A)` отдаёт ровно
  то, что объявлено в `errors:` операции `A`; если `A` уже собрала свой
  список через `errorsOf` своих соседей, `errorsOf(A)` унаследует их
  автоматически — но это следствие композиции, а не отдельная функция
  обхода графа.
- Не вводит версионирование или снапшоты отказов (`contract-versioning`,
  change 26) — читает текущее значение `errors:`, а не его историю.

## Capabilities

### New Capabilities

- `errors-of`: хелпер `errorsOf(operation)`, отдающий список отказов
  операции производным типизированным значением вместо ручной копии.

### Modified Capabilities

(нет — `errors:` операции уже существующее публичное поле декларации,
`errorsOf` только читает его типизированным геттером; правила создания
`errors:` из `contract-declarations` не меняются)

## Impact

- `@nestlingjs/operations`: новый публичный экспорт `errorsOf`.
- `examples/app-with-http`: `src/api/operations.ts` использует новый
  хелпер вместо ручной копии отказа соседней операции.
- `docs/design/operations.md`: короткое дополнение к §1.
