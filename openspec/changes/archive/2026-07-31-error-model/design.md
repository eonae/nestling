# design — error-model

## Context

Целевое состояние описано в [`docs/design/errors.md`](../../../docs/design/errors.md);
логика — `docs/decisions/ideas.md`, «[2026-07-10] Модель ошибок: Fail —
значение, code-идентичность, `defineFail`, ошибки в контракте». Мотивация и
границы — [proposal.md](./proposal.md).

Текущее состояние кода:

- `packages/nestling.pipeline/src/core/result.ts` — `Ok<TValue>` и
  `Fail extends Error` (`status`, `message`, `details`), `Output<T> =
  Promise<Ok<T> | T>`;
- `src/core/status.ts` — плоские списки `successStatuses`/`errorStatuses`;
- `src/core/pipeline.ts` — `normalizeResponse` (знает только `instanceof Ok`,
  всё остальное считает успехом) и `errorToResponse` (`instanceof Fail` →
  раскрытие `message`/`details`, иначе generic 500 по `exposeErrorDetails`);
- `src/core/types/context.ts` — `EndpointMeta` (`transport`, `pattern`,
  `input`, `output`, индексная сигнатура) и `ErrorDetails`
  (`error`/`details`/`stack`);
- `src/metadata/endpoint.ts` — `makeEndpoint` + `EndpointOptions`
  (после change #24/#21: три формы `handle`, `deps`, непрозрачный
  `binding`);
- `src/middlewares/validate.ts` — бросает `Fail.badRequest(...)` при
  ошибке схемы;
- транспорты (`transport.http/src/transport.ts:401`,
  `transport.cli/src/index.ts:254`) собирают `EndpointMeta` вручную из
  декларации.

Ограничения, которые нельзя нарушить:

- **ядро без зависимостей от валидатора** — `details`-схема принимается как
  Standard Schema (change #19), интроспекции вендора нет;
- **no runtime magic** — ни ALS, ни глобальных реестров: множество
  допустимых отказов доезжает до рантайма только через значение
  декларации;
- **типовой бюджет pipeline** (change #23) — новые тип-параметры не должны
  ронять снапшоты диагностик и порог инстанциаций;
- `@nestling/pipeline` — kernel-пакет; HTTP-специфика (коды) живёт в
  транспорте.

## Goals / Non-Goals

**Goals**

1. Возврат `Fail` эквивалентен броску на всех путях исполнения.
2. Отказ — сериализуемое значение с машинной идентичностью (`code`),
   переживающей провод.
3. Множество отказов ручки закрыто и объявлено: `E ∪ UnknownError`
   (плюс kernel-коды), с гарантией на границе, а не по конвенции.
4. Типизированный канал отказов в обе стороны: `Output<T, E>` для возврата,
   `meta.fail(e): never` для раннего выхода.

**Non-Goals** — см. раздел «Non-goals» в [proposal.md](./proposal.md)
(ре-гидрация по проводу, RFC 9457, OpenAPI-responses, `requestId`,
`Fail` в стриме, тела ошибок вне пайплайна).

## Decisions

### D1. `Fail` — генерик по `code`, идентичность строится на нём

```typescript
class Fail<
  TCode extends string | undefined = string | undefined,
  TDetails = unknown,
> extends Error {
  readonly isFail = true as const;
  readonly status: ErrorStatus;
  readonly code: TCode;
  readonly details?: TDetails;
  // cause — из ES2022 Error, объявляется в options
}
```

Тип-параметр `TCode` включает `undefined`, потому что анонимный отказ
(`Fail.notFound('...')`, `new Fail('CONFLICT', msg)`) кода не несёт: это и
есть «незадекларированный», который страж нормализует. Такая форма даёт
нужную несовместимость **бесплатно, структурно**: `Fail<undefined>` не
присваивается `Fail<'ORDER_NOT_FOUND'>`, а `Fail<'A'>` — не присваивается
`Fail<'B'>`. Отдельного symbol-бренда не требуется.

`isFail` — свойство инстанса (`true as const`), симметрично `Ok.isFail =
false`: проверка `res.isFail` работает и на десериализованном объекте, где
`instanceof` мёртв.

*Альтернативы.* (а) Отдельный тип `TypedFail<C, D> = Fail & { code: C }`
поверх негенерического класса — те же гарантии, но расходится с
`Fail<'EMAIL_TAKEN'>` из дизайн-дока и хуже читается в диагностиках.
(б) Symbol-бренд на определении — не переживает JSON, а именно провод и
есть мотив code-идентичности. (в) Иерархия классов исключений (rsdk) —
отвергнута в журнале.

### D2. `Output<T, E>`: по умолчанию отказ в возврате не допускается

```typescript
type AnyFail = Fail<string | undefined, any>;
type Output<TValue = unknown, E extends AnyFail = never> =
  Promise<Ok<TValue> | E | TValue>;
type OutputSync<TValue = unknown, E extends AnyFail = never> =
  Ok<TValue> | E | TValue;
```

Дефолт `E = never` — не «любой Fail»: только так типы и рантайм говорят
одно и то же. Страж (D5) активен всегда, поэтому «типы разрешают вернуть
`Fail.notFound()`, а рантайм отвечает 500» было бы худшим из миров.
Хендлер без `errors:` не может **вернуть** отказ вообще; `throw` типами не
проверяется нигде и остаётся дырой, которую закрывает рантайм.

`new Ok(fail)` закрывается типом конструктора (`value: TValue extends
AnyFail ? never : TValue`) — это закрывает одноимённый открытый вопрос
журнала.

*Альтернатива* — дефолт `E = AnyFail` («без декларации можно вернуть
любой отказ»): мягче для миграции, но возвращает конвенцию — компилятор
разрешает то, что граница гарантированно превратит в 500.

### D3. `defineFail`: аргумент конструктора — `details`, сообщение — функция от него

```typescript
export const OrderNotFound = defineFail('ORDER_NOT_FOUND', {
  status: 'NOT_FOUND',
  details: z.object({ orderId: z.string() }),
  message: (d) => `Order ${d.orderId} not found`,
});

throw OrderNotFound({ orderId: '42' });            // Fail<'ORDER_NOT_FOUND', {orderId: string}>
throw OrderNotFound({ orderId: '42' }, { cause }); // второй аргумент — опции
if (OrderNotFound.is(res)) { res.details.orderId } // сужение по code
```

Журнал оставлял открытым «форму message-фабрики и связь details-схемы с
типом аргументов» и показывал эскиз `message: (id: string) => …` +
`OrderNotFound('42')`. Эскиз описывает **два независимых** источника
аргументов (произвольные параметры сообщения и схема деталей), и связать их
типами нечем — пришлось бы дублировать данные в вызове. Решение:
**единственный источник — `details`**; `message` — либо строка, либо
функция от валидированных деталей. Без схемы конструктор вызывается без
аргументов: `EmailTaken()`.

Определение — значение со свойствами: `code`, `status`, `is(value)`
(предикат по `code`, сужающий тип), `schema` (для OpenAPI и клиентов
позже). Само определение вызываемо (конструктор). `details` валидируется
схемой **в конструкторе** (schema-first, ошибка автора видна сразу);
валидация синхронная — по правилу change #19.

*Альтернативы.* (а) Эскиз из журнала (`message`-фабрика произвольной
арности + отдельная схема) — теряет связь аргументов со схемой.
(б) `details` без схемы (просто тип) — ломает schema-first: OpenAPI и
клиенты остались бы без описания тела отказа. (в) Класс-наследник `Fail`
на каждый отказ — `instanceof`-идентичность, отвергнутая в журнале.

### D4. Kernel-коды — закрытый реестр ядра, входит в контракт неявно

`UNKNOWN` (`INTERNAL_ERROR`) и `VALIDATION_FAILED` (`BAD_REQUEST`) —
определения, созданные тем же `defineFail` внутри ядра и экспортируемые
как `UnknownError` / `ValidationFailed`. Страж пропускает их без
декларации. Без этого штатный 400 от `validate()`-middleware, живущего в
pre-тракте, превращался бы в 500 — прямое противоречие capability
`http-request-validation-errors`.

Реестр закрыт и растёт только вместе с ядром: у портов к нему добавится
`DEADLINE_EXCEEDED` (change #27). Пользовательского способа «объявить свой
код встроенным» нет — иначе закрытость множества снова стала бы
конвенцией.

### D5. Страж — на границе пайплайна, после ответного тракта, до `.finally`

Порядок в `executeWithHandler`:

1. pre-тракт → хендлер → `normalizeResponse` (теперь: `Fail` → error-track);
2. ответный тракт (`.ok`/`.catch`) — как сегодня;
3. **страж**: если ответ — ошибка и её `code` не входит в
   `E ∪ kernel`, ответ заменяется на `UnknownError`;
4. `computeOutcome` + `.finally`.

Страж стоит **после** `.catch`, потому что `.catch` — легальное место
превращения недекларированного отказа в контрактный; и **до** `.finally`,
чтобы наблюдатель видел ровно тот ответ, который уйдёт клиенту.

Источник множества — `ctx.endpoint.errors` (`EndpointMeta` пополняется
полем `errors?: readonly AnyFailDefinition[]`): декларация → транспорт →
контекст, никаких глобальных реестров. Пайплайн, исполняемый без
декларации (прямой вызов `executeWithHandler` в тестах), видит пустое
множество и нормализует всё, кроме kernel-кодов.

Оригинал не теряется: страж зовёт `ExecuteOptions.onUnknownFail?:
(info: { error: unknown; endpoint: EndpointMeta }) => void`. Дефолт —
`console.error` с префиксом `[nestling]`: молчаливое проглатывание хуже
шумного лога, а логгера в ядре нет по принципу минимума зависимостей.
Транспорт прокидывает свой хук туда же, где прокидывает
`exposeErrorDetails`.

`exposeErrorDetails` продолжает управлять только раскрытием
**необработанного**: при `true` тело `UnknownError` дополняется
`message`/`stack` оригинала, при `false` — generic-сообщение. Раскрытие
задекларированного отказа от флага по-прежнему не зависит.

*Альтернативы.* (а) Страж в транспорте — пришлось бы повторять в каждом
транспорте и он не увидел бы `.catch`. (б) Warn-and-pass — отвергнут в
журнале: контракт остаётся конвенцией. (в) Страж только при непустом
`errors:` — «нет декларации ⇒ нет проверки» вернуло бы implicit contract,
на который клиент успевает опереться.

### D6. Как отказ доезжает до стража: `code` в теле ответа

`ErrorDetails` получает `code?: string`; `errorToResponse` кладёт туда код
`Fail`. Страж работает над `ResponseContext` (после `.catch` исходного
объекта уже может не быть) и читает `value.code` — то есть контрактным
считается ровно тот ответ, который несёт объявленный код.

Чтобы `.catch`-юниту не приходилось конструировать `ErrorResponseContext`
руками, `CatchUnitFn` расширяется: возврат `Fail` допустим и нормализуется
рантаймом (симметрия с хендлером). Возврат `undefined`/`void` по-прежнему
оставляет ответ как есть.

### D7. `errors:` в декларации и вывод `E`

`EndpointOptions` пополняется `errors?: readonly AnyFailDefinition[]`;
`makeEndpoint` выводит из кортежа юнион отказов
(`FailsOf<E> = E[number] extends FailDefinition<infer C, infer D> ?
Fail<C, D> : never`) и подставляет его в `HandlerFn<I, O, P, E>`:

```typescript
type HandlerFn<I, O, P, E extends AnyFail = never> = (
  payload: InferInput<I>,
  meta: MetaOf<P> & { signal: AbortSignal; fail: (e: E) => never },
) => OutputSync<InferOutput<O>, E> | Output<InferOutput<O>, E>;
```

Проверки словаря при создании (в духе change #24): элемент `errors:`, не
являющийся определением, и повторяющийся `code` — ошибка **в точке
декларации**, с именем ручки и кодом в тексте. Транспортные конструкторы
(`httpEndpoint`, `cliEndpoint`) поле только пробрасывают.

### D8. `meta.fail` — тривиальный бросатель, вся сила в типе

Рантайм: `fail: (e) => { throw e }` — плюс `TypeError`, если аргумент не
`Fail` (JS-потребители). Ключ `fail` резервируется наравне с `signal`:
одноимённое поле из input перекрывается, что фиксируется требованием и
тестом.

Почему не свободная функция поверх ALS — зафиксировано в журнале: типы
лексичны и статичны, ALS динамичен и стёрт; сигнатура выродилась бы в
`fail(e: Fail)`. Тип рождается из декларации и течёт в хендлер значением
(`meta`), как и `signal`.

### D9. Словарь статусов и маппинг на HTTP

`errorStatuses` пополняется `CONFLICT`, `TIMEOUT`, `TOO_MANY_REQUESTS`.
`STATUS_MAP` в `@nestling/transport.http`: `CONFLICT → 409`,
`TOO_MANY_REQUESTS → 429`, `TIMEOUT → 504`. `504`, а не `408`: `TIMEOUT`
в ядре описывает «операция не уложилась в бюджет» (в том числе будущий
`DeadlineExceededError` портов), а `408` — про то, что клиент не дослал
запрос. CLI-транспорт печатает статус как есть — маппинга не требует.

## Risks / Trade-offs

- **Забытая декларация превращает штатный 404 в 500.** Осознанный
  трейд-офф журнала: громко и сразу (первым же тестом) лучше, чем клиент,
  опирающийся на implicit contract. → Митигация: текст сообщения хука
  называет код, ручку и подсказывает `errors:`; миграция примеров и
  гайдов делает канон видимым.
- **`Output<T, E>` контролирует возврат только при заданном `output`.**
  При `TValue = unknown` юнион поглощает `E`, и `Fail` пролезает как
  значение. → Митигация: рантайм-страж всё равно закрывает множество;
  ручки без `output` — вырожденный случай, отмечается в гайде.
- **Тип-параметр `E` увеличивает типовую нагрузку деклараций.** →
  Митигация: `E` не участвует в машинерии композиции слоёв (входит только
  в `HandlerFn`); бюджет и снапшоты change #23 прогоняются как часть
  `verify`, регрессия поймается порогом.
- **Дефолт `console.error` шумит в тестах.** → Митигация: хук
  переопределяем на уровне `ExecuteOptions`, транспорты его пробрасывают;
  в тестах ядра подставляется spy.
- **Разъезд формата тела: 400 парсинга из транспорта — без `code`,
  400 валидации из пайплайна — с `code`.** → Митигация: явный non-goal,
  унификация едет с wire-форматом; расхождение зафиксировано в спеке,
  чтобы не выглядело недосмотром.

## Migration Plan

1. **Ядро типов** — `Fail`/`Ok`/`Output` (D1, D2), словарь статусов (D9),
   `defineFail` + kernel-коды (D3, D4). Обратная совместимость: статические
   фабрики `Fail.*` сохраняются, но дают `code: undefined`.
2. **Рантайм пайплайна** — `normalizeResponse`, `errorToResponse`, страж,
   `meta.fail` (D5, D6, D8). Здесь же тесты на порядок «Fail-возврат до
   `.ok`».
3. **Декларации** — `errors:` в `makeEndpoint`, вывод `E`, проверки
   словаря (D7); транспортные конструкторы пробрасывают поле.
4. **Транспорты** — перенос `errors` в `EndpointMeta`, `STATUS_MAP`,
   проброс `onUnknownFail`.
5. **Middleware** — `validate()` бросает `ValidationFailed` вместо
   анонимного `Fail.badRequest`.
6. **Примеры и доки** — миграция `packages/examples.*`, пересверка
   гайдов, сверка `docs/design/errors.md` и `endpoints.md` с реализацией,
   правка `docs/preview` (пример `Fail.badRequest('Email already taken')`
   становится `CONFLICT`-отказом с кодом).

Отката по частям нет: шаги 1–3 — один семантический слой, ветка
мержится целиком.

## Open Questions

- **Форма `.is()` для юниона определений.** Удобен ли хелпер
  `isOneOf([A, B])(res)` для `.catch`-юнитов, разбирающих несколько кодов,
  или достаточно последовательных `A.is(res)`? Предлагается отложить до
  первого реального `.catch` в примерах.
- **`details` без схемы.** Разрешать ли `defineFail('X', { status,
  message })` с произвольным нетипизированным `details` в конструкторе?
  Предлагается **не** разрешать (schema-first), но это стоит проверить на
  миграции примеров: если половина отказов не имеет осмысленных деталей,
  форма без схемы должна быть просто «конструктор без аргументов».
- **Уточнение API `defineFail` (D3) расходится с эскизом журнала.** Оно
  закрывает открытый вопрос, зафиксированный там же, но запись в
  `decisions/ideas.md` добавляется только по явной команде пользователя —
  вынесено отдельной задачей в `tasks.md`.
