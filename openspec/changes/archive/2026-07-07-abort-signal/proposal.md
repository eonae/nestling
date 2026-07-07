# abort-signal — `meta.signal` как first-class примитив контекста запроса

## Why

Сейчас у хендлера нет способа узнать, что его результат больше никому не нужен:
отвал клиента HTTP-транспорт никак не сигнализирует (слушателей `'close'` на
запросе нет вообще), а `App.close()` не оповещает in-flight запросы — дренаж
работает только на уровне сокетов node:http (таймер `closeTimeout` из
`transport-hardening`). Без единого механизма отмены бесконечные подписки
непринципиально завершить, а `close()` на живых соединениях спасает только
принудительный обрыв по таймауту.

Решение зафиксировано в
[ideas.md, раздел «AbortSignal — first-class примитив контекста»](../../../docs/decisions/ideas.md):
в `meta` каждого запроса есть `signal: AbortSignal`, который взводят транспорт
(дисконнект клиента) и приложение (graceful shutdown). Это change #3 из
[roadmap](../../../docs/decisions/roadmap.md) и прямая предпосылка для
`streaming-v2` (#6): item-цепочки и `events(T)` описаны в терминах
`meta.signal`.

## What Changes

- **@nestling/pipeline**: в `meta`, которое получает каждый хендлер вторым
  аргументом, появляется гарантированное поле `signal: AbortSignal`
  (не опциональное — транспорт без своей семантики отмены даёт
  никогда-не-взводимый сигнал). Сигнал доступен и middleware через контекст.
- **@nestling/transport.http**: на каждый запрос создаётся `AbortController`;
  закрытие соединения клиентом (событие `'close'` до завершения ответа)
  взводит его. Транспорт ведёт реестр in-flight контроллеров.
- **@nestling/transport.http**: `close()` абортит все in-flight запросы
  (сигналы взводятся сразу, до дренажа), после чего существующий механизм
  дренажа (`closeTimeout` → `closeAllConnections()`) остаётся последней
  линией обороны, а не единственным механизмом.
- **@nestling/app**: `App.close()` доводит отмену до всех транспортов —
  каждый транспорт, поддерживающий отмену, абортит свои in-flight запросы.
  Итоговый сигнал запроса — комбинация транспортного и app-уровневого
  (семантика `AbortSignal.any`).
- **@nestling/transport.cli**: `meta.signal` появляется и здесь (взводится
  при `close()` транспорта); полноценная обработка Ctrl-C в REPL — вне scope.

### Non-goals

- `stream(T)` / `events(T)`, `Topic`, SSE, item-цепочки — change #6
  (`streaming-v2`).
- Реестр подписок (`@nestling/subscriptions`, админский kill) — change #7.
- Изменения модели фаз pipeline (`.pre/.ok/...`, `compose`) — change #4
  (`pipeline-v2`).
- Словарь исходов завершения (`completed | disconnected | aborted | failed`)
  и finish-фаза — вместе со streaming-v2.
- Автоматическое прерывание работы хендлера: signal — кооперативный
  механизм, хендлер обязан уважать его сам; форсированное завершение
  не вводится.

## Capabilities

### New Capabilities

- `request-abort-signal`: контракт per-request сигнала отмены в pipeline —
  `meta.signal` всегда присутствует, кто и когда его взводит, доступность
  в middleware и хендлере.
- `http-request-cancellation`: HTTP-транспорт взводит сигнал при дисконнекте
  клиента и абортит все in-flight запросы при `close()`.
- `app-shutdown-abort`: `App.close()` инициирует отмену in-flight запросов
  во всех транспортах до уничтожения контейнера.
- `cli-request-cancellation`: CLI-транспорт даёт `meta.signal`, взводимый
  при `close()` транспорта.

### Modified Capabilities

- `http-transport-limits`: требование «Graceful close drains connections»
  уточняется — дренаж начинается с аборта in-flight сигналов; принудительное
  закрытие сокетов по `closeTimeout` остаётся fallback-механизмом.

## Impact

- `packages/nestling.pipeline`: `ExtendableContext` / `makeEmptyContext`
  (`src/core/types/context.ts`), проброс `signal` в `meta` в
  `Pipeline.executeWithHandler` (`src/core/pipeline.ts`). Для существующих
  хендлеров изменение аддитивно; для авторов кастомных транспортов сигнатура
  `makeEmptyContext` расширяется опциональным параметром (не breaking).
- `packages/nestling.transport.http`: `handle()` и `close()` в
  `src/transport.ts` — контроллер на запрос, реестр in-flight, порядок
  «abort → drain → force-close».
- `packages/nestling.app`: `close()` в `src/app.ts`; контракт `ITransport`
  (`packages/nestling.transport/src/interfaces.ts`) — транспортам нужен
  способ получить команду отмены (расширение `close()` / новый опциональный
  метод — решается в design.md).
- `packages/nestling.transport.cli`: проброс сигнала в `execute()`.
- Тесты: рантайм-тесты pipeline (`pipeline.runtime.spec.ts` — обязательны
  по правилам конфига), интеграционные тесты HTTP
  (`transport.integration.spec.ts` — дисконнект клиента, abort при close),
  тесты App (`app.spec.ts` + расширение `MockTransport`).
- Новых зависимостей нет: `AbortController` / `AbortSignal.any` — нативные
  в Node.js 22.
