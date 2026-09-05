# Целевое состояние V1

Эта папка — **полное описание целевого API и поведения Nestling V1**,
как будто он уже реализован. Единственное место, где целевой дизайн описан
целиком; при расхождении с кодом здесь — намерение, в коде — текущий факт.

Правила ведения этой папки — вместе с остальными правилами документации
в [docs/README.md](../README.md), раздел «Правила ведения».

## Карта

| Док | О чём |
|---|---|
| [principles.md](./principles.md) | опорные принципы и сквозные границы |
| [container.md](./container.md) | DI: токены, провайдеры, token families, модули, видимость |
| [composition.md](./composition.md) | composition root: `makeApp`, `assemble(select)`, фазы жизненного цикла, features/`select`, L0–L4 |
| [pipeline.md](./pipeline.md) | request-pipeline: фазы, слои, `compose`, формы юнитов |
| [endpoints.md](./endpoints.md) | декларации: операция первична, per-transport конструкторы, формы io, HTTP-канон |
| [operations.md](./operations.md) | операции и порты, шина, dispatch-политики, внешние клиенты |
| [config.md](./config.md) | конфиг: секции, keys-capability, источники, reloadable, секреты |
| [errors.md](./errors.md) | модель ошибок: `Ok`/`Fail`, `makeFail`, коды с категорией, `E ∪ InternalError` |
| [schemas.md](./schemas.md) | Standard Schema на границах, OpenAPI/AsyncAPI через конвертеры |
| [streaming.md](./streaming.md) | стриминг: `stream`/`events`, item-цепочки, `Topic`, граница с RxJS |
| [transports.md](./transports.md) | транспорты: `serve(dispatch)`, байтовый уровень (сжатие, CORS, парсинг по io-декларации) |
| [testing.md](./testing.md) | `@nestling/testing`: `assembleTest(app, …)`, стабы, `check(select)` |
