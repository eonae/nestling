# abort-signal — tasks

## 1. Ядро pipeline (nestling.pipeline)

- [x] 1.1 `core/types/context.ts`: поле `readonly signal: AbortSignal` в
  `ExtendableContext`; `makeEmptyContext(raw, endpoint, signal?)` с
  never-aborted дефолтом (модульная константа); JSDoc о зарезервированном
  ключе `signal`
- [x] 1.2 `core/pipeline.ts` (`executeWithHandler`): собирать meta как
  `{ ...meta, signal: ctx.signal }`; расширить тип меты в сигнатуре
  пересечением `& { signal: AbortSignal }`
- [x] 1.3 Обновить типы хендлеров: `IEndpoint.handle` / `HandlerFn`
  (`core/types/endpoint.ts`) — meta включает `signal: AbortSignal`
- [x] 1.4 Рантайм-тесты (`pipeline.runtime.spec.ts`): сигнал транспорта
  доходит до хендлера; дефолтный never-aborted сигнал при старой сигнатуре
  `makeEmptyContext`; `ctx.signal` доступен middleware и совпадает с
  `meta.signal`; поле `signal` из middleware перекрывается сигналом контекста
- [x] 1.5 Обновить type-тесты (`pipeline.spec.ts`), если расширение типа меты
  их сломало (не потребовалось — все type-тесты зелёные без правок)

## 2. HTTP-транспорт (nestling.transport.http)

- [x] 2.1 `transport.ts`: `closeController: AbortController` (создание в
  `listen()`); per-request `AbortController` в `handle()`; сигнал запроса =
  `AbortSignal.any([request, close])`
- [x] 2.2 Дисконнект: `nativeRes.on('close', ...)` → abort per-request
  контроллера при `!nativeRes.writableFinished`, reason
  `Error('client disconnected')`
- [x] 2.3 Прокинуть сигнал: `makeEmptyContext(raw, endpointMeta, signal)` в
  pipeline-ветке; `meta = { signal }` в fallback-ветке без pipeline
- [x] 2.4 `close()`: `closeController.abort(new Error('transport closing'))`
  первым шагом, до `server.close()`; существующий дренаж
  (`closeIdleConnections` → `closeTimeout` → `closeAllConnections`) без
  изменений

## 3. App и CLI

- [x] 3.1 Проверить порядок в `App.close()` (транспорты →
  `container.destroy()`) и зафиксировать его тестом в `app.spec.ts`;
  расширить `MockTransport` (`helpers.ts`) наблюдаемым `close()`
- [x] 3.2 `CliTransport`: transport-level `AbortController`; сигнал в
  `makeEmptyContext` в `execute()` и в meta fallback-ветки; abort в `close()`
  перед закрытием readline

## 4. Интеграционные тесты (реальный node:http)

- [x] 4.1 Дисконнект клиента: raw-сокет обрывает соединение посреди долгого
  запроса → хендлер наблюдает abort (`meta.signal`); штатное завершение
  (включая keep-alive) сигнал не взводит
- [x] 4.2 Shutdown: `close()` с in-flight хендлером, уважающим сигнал, →
  завершается дренажом заметно раньше `closeTimeout`; хендлер, игнорирующий
  сигнал, → force-close по `closeTimeout` (существующий тест остаётся
  зелёным). Попутно закрыта дыра дренажа: соединение, ставшее idle после
  начала `close()`, теперь закрывается периодическим `closeIdleConnections`
  (см. design, D5)
- [x] 4.3 Fallback-endpoint без pipeline получает `meta.signal`, взводимый
  при дисконнекте
- [x] 4.4 Отсутствие накопления: серия последовательных запросов не
  увеличивает число слушателей transport-level сигнала
  (`getEventListeners(closeSignal, 'abort')` из `node:events`)
- [x] 4.5 App-уровень: `App.close()` с in-flight HTTP-запросом — сигнал
  взводится, `@OnDestroy` выполняется после остановки транспорта
  (в `nestling.app` добавлена devDependency `@nestling/transport.http`)

## 5. Финализация

- [x] 5.1 Прогнать e2e в `examples.app-with-http` (`e2e/`)
- [x] 5.2 Документация: README `nestling.pipeline` (контракт `meta.signal`,
  зарезервированный ключ) и `nestling.transport.http` (семантика отмены);
  гайд `docs/guides/http-app-di.md` (описание `meta`)
- [x] 5.3 Запись в `docs/decisions/archlog.md` (появление `meta.signal`,
  поведенческое изменение `close()`); статус #3 в
  `docs/decisions/roadmap.md` → implemented
