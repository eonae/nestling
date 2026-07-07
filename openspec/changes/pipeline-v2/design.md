# pipeline-v2 — design

## Context

Текущее ядро (`packages/nestling.pipeline/src/core/pipeline.ts`) — иммутабельный
builder `definePipeline().use(mw)`, где middleware — before-only функции/классы,
возвращающие добавку к накопленному `input`. Рантайм — один метод
`executeWithHandler(handler, ctx, options)`: цикл по middleware → извлечение
`payload`/`meta` → вызов хендлера → нормализация `Ok`/`Fail`/ошибок.
Ответного тракта нет. Дизайн целевой модели, включая логику принятия решений
и отвергнутые альтернативы, зафиксирован в
[ideas.md, «Pipeline v2»](../../../docs/decisions/ideas.md) — этот документ
не перепридумывает его, а фиксирует технические решения реализации.

Что «держит» текущий API (из аудита): `executeWithHandler` вызывается ровно
из двух транспортов; `EndpointDefinition.pipeline?: Pipeline<P>` протянут
через `IEndpoint`/`HandlerFn`/`HttpEndpointMetadata`/router; 673 строки
type-тестов; 5 встроенных middleware; middleware-registry — мёртвый код
(DI-резолв не реализован); examples — 3 пакета с пайплайнами-константами.

## Goals / Non-Goals

**Goals:**

- Словарь фаз `.pre/.ok/.catch/.after/.finally` с честной опциональностью
  ctx и type-state билдера.
- Слои + `compose` с compile-time проверкой требований к внешнему контексту.
- `TNeeds`: юниты-классы, резолв App'ом на старте; двухуровневость
  фреймворка в типах.
- Сохранить: контракт `meta.signal` (change #3), политику
  `exposeErrorDetails`, `Ok`/`Fail`, io-модификаторы, монотонное
  типизированное накопление input.
- Минимизировать изменение контракта транспортов: сигнатура точки
  выполнения остаётся `executeWithHandler(handler, ctx, options)`.

**Non-Goals:**

- Item-цепочки, `stream`/`events`, точная стрим-семантика момента
  «всё дотекло» — streaming-v2.
- Реализация токен-формы юнитов — после token-families (#5).
- Gate (ранний успех) и восстановление `Fail → Ok` — ограничения v1.
- Слой обратной совместимости со старым API — chистый break (pre-1.0).

## Decisions

### D1. Типовая модель: `Pipeline<TReq, TAcc, TNeeds>`

Три параметра (вместо нынешнего одного):

- `TReq` — требования слоя к внешнему контексту, задаются явно:
  `makePipeline<{ identity: User }>()`. Дефолт — `{}`.
- `TAcc` — накопленный собственным pre-трактом input (начинается с `TReq`,
  каждый `.pre()` добавляет поля — та же монотонная машинерия
  `ConflictingKeys`/`ExtractAddition`, что сейчас).
- `TNeeds` — union отложенных зависимостей (конструкторы классов-юнитов).
  Дефолт `never`; чистый пайплайн — `Pipeline<TReq, TAcc, never>`.

`compose(outer, inner)` типизируется так: `inner.TReq extends outer.TAcc`
(иначе ошибка компиляции в точке композиции с указанием недостающих полей —
паттерн сообщений как в текущем `CheckMiddlewareCompatibility`), результат —
`Pipeline<outer.TReq, outer.TAcc & inner.TAcc, outer.TNeeds | inner.TNeeds>`.
Вариадическая форма `compose(a, b, c)` — рекурсивное применение попарной.

Альтернатива «TReq хранить внутри TAcc» отклонена: в точке композиции
нужно отличать «слой требует» от «слой предоставляет», иначе проверка
невыразима.

### D2. Фазы: сигнатуры юнитов

Хендлерный тракт работает с тем же `ExtendableContext` (contract
`endpoint/raw/signal/input` сохраняется). Ответный тракт получает ответ
и контекст с честной типизацией:

| Фаза | Сигнатура юнита | ctx.input |
|---|---|---|
| `.pre(u)` | `(ctx: ExtendableContext<TAcc>) => TAdd \| Promise<TAdd>` | накопленный, полный |
| `.ok(u)` | `(res: SuccessResponseContext, ctx) => SuccessResponseContext \| void` | полный `TAcc` |
| `.catch(u)` | `(res: ErrorResponseContext, ctx) => ErrorResponseContext \| void` | `TReq & Partial<TOwn>` |
| `.after(u)` | `(res: ResponseContext, ctx) => ResponseContext \| void` | `TReq & Partial<TOwn>` |
| `.finally(u)` | `(outcome: Outcome, res: ResponseContext, ctx) => void` | `TReq & Partial<TOwn>` |

- `TOwn = TAcc без TReq` — поля собственного pre-тракта; на ответном
  тракте они `Partial` (pre мог не дойти), внешние (`TReq`) — полные
  (слой исполняется только если pre внешних слоёв прошли).
- Ответные юниты «могут заменить ответ»: возврат нового ResponseContext
  заменяет текущий, `void`/`undefined` — оставляет. `.ok` не может вернуть
  ошибку, `.catch` не может вернуть успех (типами) — ограничение v1
  «успех приходит только из хендлера».
- Юниты ответного тракта исполняются строго в порядке объявления;
  юнит применяется по применимости к ТЕКУЩЕМУ ответу (после замены
  `Fail → Fail'` следующий `.catch` видит `Fail'`).

### D3. Рантайм: сигнатура `executeWithHandler` сохраняется

Точка выполнения остаётся `executeWithHandler(handler, ctx, options)` с тем
же контрактом для транспортов (`makeEmptyContext` не меняется, options —
`exposeErrorDetails`). Внутри — новый порядок: pre-тракты слоёв снаружи
внутрь → хендлер → ответная фаза изнутри наружу → `finally` изнутри наружу.
Падение pre слоя N ⇒ хендлер и внутренние слои не исполняются, ответный
тракт начинается со слоя N (его ответные юниты видят свой Partial),
внешние слои получают ответ штатно.

Обоснование: транспорты — единственные потребители рантайма; сохранение
сигнатуры сводит их миграцию к типам. Альтернатива (новое имя `run`)
отклонена как переименование без содержания.

### D4. `.finally` в v1: сразу после ответной фазы, с вычисленным исходом

`Outcome = 'completed' | 'disconnected' | 'aborted' | 'failed'`.
Вычисление v1: `meta.signal.aborted` с reason «client disconnected» →
`disconnected`; aborted по иной причине (shutdown) → `aborted`; иначе —
`completed`/`failed` по `isSuccess` итогового ответа. `finally` вызывается
рантаймом сразу после ответной фазы, до фактической отправки транспортом.

Это осознанное приближение: точный момент (c) «всё дотекло» требует
обратного канала от транспорта (flush/стримы) и вводится в streaming-v2
вместе с item-цепочками — контракт транспортов не хочется менять дважды.
Ограничение документируется в спеке фазовой модели.

### D5. Формы юнитов и `TNeeds`

`.pre(u)` (и ответные методы) принимают:

1. **функцию** — базовый случай, `TNeeds` не меняется;
2. **инстанс** (`new WithTracing(...)`) — объект с `handle` (мост: класс
   без DI), `TNeeds` не меняется;
3. **класс** (конструктор) — юнит объявлен, но не создан: `TNeeds |=
   typeof WithTracing`. Исполнять такой пайплайн нельзя, пока needs
   не резолвлены.

Резолв: `pipeline.bind(resolve: (ctor: Constructor) => object)` →
`Pipeline<TReq, TAcc, never>`. App вызывает `bind` в
`#registerEndpoints`, резолвя через контейнер (ошибка старта, если класс
не зарегистрирован — та же семантика, что сейчас для endpoint-классов).
Транспорты в `EndpointDefinition` принимают только `Pipeline<любой, любой,
never>` — standalone-использование без App остаётся полностью
функциональным. Токен-форма из ideas.md — расширение `bind`/`TNeeds`
после #5; тип `TNeeds` проектируется как union разнородных «требований»,
чтобы токены добавились без ломки.

Контракт юнитов: юнит — синглтон, per-request состояние только в ctx.

### D6. Встроенные middleware → юниты; validate() остаётся pre-юнитом

`validate`, `withRequestId`, `withIdentity`, `withPermissions`,
`withRequestLogging` переоформляются как pre-юниты (их сигнатура —
`(ctx) => addition` — уже совпадает с формой pre). `withRequestLogging`
дополнительно получает парный `.finally`-юнит в примерах (демонстрация
ответного тракта). Имена и экспорт сохраняются.

### D7. Удаление мёртвой middleware-ветки

`metadata/middleware.ts` (`@Middleware`), middleware-registry
(`registerMiddleware/getAllMiddleware/clearMiddlewareRegistry`),
`AppModule.middleware` — удаляются. Их роль (DI для юнитов) выполняет
`TNeeds` + обычная регистрация провайдеров. `IMiddleware`/`MiddlewareFn`
удаляются вместе с `middleware.before.ts`; тип юнита получает собственные
имена (`PipelineUnit`/`PreUnit` и т.п.).

### D8. Чистый break, миграция одним change

Слой совместимости (`definePipeline` поверх `makePipeline`) не делается:
проект pre-1.0, потребители — свой монорепозиторий; двойной API удвоил бы
типовую машинерию. Миграция идёт слоями: ядро (+ тесты ядра зелёные) →
транспорты (+ интеграционные тесты) → app → examples → доки. Между
шагами репозиторий не собирается целиком — это нормально для одной ветки,
коммит по завершении миграции.

## Risks / Trade-offs

- **[Сложность типов compose/TNeeds]** — вывод типов вариадической
  композиции и union-накопление needs могут упереться в пределы inference.
  Митигация: попарная рекурсия с аккуратными кондишеналами (паттерн уже
  отработан в `ValidateMiddleware`); type-тесты пишутся ПЕРВЫМИ (TDD для
  типов), включая негативные случаи с читаемыми сообщениями об ошибках.
- **[Partial ctx эргономика]** — `TReq & Partial<TOwn>` в `.catch/.after`
  заставит писать проверки. Это цена честности (осознанная, из ideas.md);
  документируется паттерн «объявляй раньше — используй позже» (нужное
  ответному юниту поле выноси во внешний слой).
- **[Обновление 673 строк type-тестов]** — большой объём ручной работы.
  Митигация: структура старых тестов (накопление, конфликты, порядок)
  переносится сценарий-в-сценарий на новый API + добавляются сценарии
  фаз/слоёв.
- **[.finally до фактической отправки]** — аудит «ответ отправлен» в v1
  формально врёт на величину flush. Задокументировано; исправляется в #6.
- **[Скрытые потребители старого API]** — grep-аудит покрыл монорепо;
  внешних потребителей нет (пакеты не публикуются).

## Migration Plan

1. Ядро: типы юнитов/билдера/compose → type-тесты → рантайм → рантайм-тесты.
2. `metadata/endpoint.ts` + удаление middleware-ветки; `IEndpoint`/
   `HandlerFn` — тип меты не меняется (по-прежнему выводится из
   накопленного input + `signal`).
3. Транспорты: типы (`Pipeline<_, _, never>` в definition), вызов рантайма
   без изменений сигнатуры; интеграционные тесты — замена
   `definePipeline().use(validate())` → `makePipeline().pre(validate())`.
4. App: `bind` через контейнер в `#registerEndpoints`; удаление
   `AppModule.middleware`; тесты.
5. Examples (3 пакета), гайды, README, archlog.

Rollback: revert ветки `change/pipeline-v2` (в main не попадает до полной
зелёной сборки).

## Open Questions

- Имена типов юнитов в публичном API (`PipelineUnit` vs `Unit` vs
  `PreUnit/OkUnit/...`) — решится в ходе реализации, на семантику
  не влияет.
- Нужен ли `.after` доступ к outcome (сейчас — нет, только `.finally`) —
  оставляем как в ideas.md, вернёмся при первом реальном кейсе.
