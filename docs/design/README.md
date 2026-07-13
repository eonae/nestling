# Целевое состояние V1

Эта папка — **полное описание целевого API и поведения Nestling V1**,
как будто он уже реализован. Единственное место, где целевой дизайн описан
целиком; при расхождении с кодом здесь — намерение, в коде — текущий факт.

## Три правила

1. **Только целевое состояние.** Доки описывают V1 в настоящем времени.
   Здесь нет статусов реализации, номеров changes и порядка работ —
   что уже реализовано и что когда делается, отвечает
   [roadmap](../decisions/roadmap.md).
2. **«Что» — здесь, «почему» — по ссылкам.** Каждый док начинается с плашки
   со ссылками на записи [журнала решений](../decisions/ideas.md) — там
   контекст, логика и отвергнутые варианты. Дизайн без записи в журнале
   в эту папку не попадает.
3. **Никакого «v2».** Разрабатывается V1. Осознанно исключённое из V1
   описывается в [deferred](../decisions/deferred.md) и открытых вопросах
   записей журнала, а не здесь.

## Карта

| Док | О чём |
|---|---|
| [principles.md](./principles.md) | опорные принципы и сквозные границы |
| [container.md](./container.md) | DI: токены, провайдеры, token families, модули, видимость |
| [composition.md](./composition.md) | composition root: `assemble`, фазы жизненного цикла, features/`select`, L0–L4 |
| [pipeline.md](./pipeline.md) | request-pipeline: фазы, слои, `compose`, формы юнитов |
| [endpoints.md](./endpoints.md) | декларации: контракт первичен, per-transport конструкторы, формы io, HTTP-канон |
| [contracts.md](./contracts.md) | контракты и порты, шина, dispatch-политики, внешние клиенты |
| [config.md](./config.md) | конфиг: секции, keys-capability, источники, reloadable, секреты |
| [errors.md](./errors.md) | модель ошибок: `Ok`/`Fail`, `defineFail`, `E ∪ UnknownError` |
| [schemas.md](./schemas.md) | Standard Schema на границах, OpenAPI/AsyncAPI через конвертеры |
| [streaming.md](./streaming.md) | стриминг: `stream`/`events`, item-цепочки, `Topic`, граница с RxJS |
| [transports.md](./transports.md) | транспорты: `serve(dispatch)`, сантехника, парсинг по io-декларации |
| [testing.md](./testing.md) | `@nestling/testing`: `assembleTest`, стабы, `.check()` |
