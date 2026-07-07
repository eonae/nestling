# abort-signal — design

## Context

Целевой дизайн зафиксирован в
[ideas.md, «AbortSignal — first-class примитив контекста»](../../../docs/decisions/ideas.md):
`meta.signal` взводят транспорт (дисконнект) и приложение (shutdown), хендлер
обязан уважать сигнал кооперативно.

Текущее состояние:

- В pipeline нет носителя per-request сигнала: `meta`, которое получает
  хендлер, — это накопленный `input` без `payload`
  (`pipeline.ts`, `executeWithHandler`, деструктуризация
  `const { payload, ...meta } = finalInput`).
  Контекст запроса создаётся транспортом через `makeEmptyContext(raw, endpoint)`
  (`core/types/context.ts`).
- HTTP-транспорт никак не отслеживает отвал клиента (нет слушателей `'close'`),
  а `close()` дренирует только на уровне сокетов node:http
  (`server.close()` → `closeTimeout` → `closeAllConnections()`).
- `App.close()` вызывает `transport.close?.()` для всех транспортов, затем
  `container.destroy()`; про in-flight запросы App не знает.
- `AbortSignal`/`AbortController` в исходниках не используются вообще —
  фича гринфилд, но с готовым дизайном в доках.

## Goals / Non-Goals

**Goals:**

- `meta.signal: AbortSignal` присутствует в каждом вызове хендлера,
  безусловно (без опциональности).
- HTTP: дисконнект клиента взводит сигнал; `close()` взводит сигналы всех
  in-flight запросов до дренажа.
- App: `close()` доводит отмену до in-flight запросов всех транспортов
  (через `transport.close()`), контейнер уничтожается после.
- CLI: сигнал взводится при `close()` транспорта.
- Рантайм-тесты ядра pipeline и интеграционные тесты HTTP.

**Non-Goals:**

- Стриминговая модель (`stream`/`events`, `Topic`, SSE, словарь исходов
  `completed | disconnected | aborted | failed`) — streaming-v2.
- Реестр подписок и админский kill — subscriptions-registry.
- Принудительное прерывание хендлера: сигнал кооперативный, force-close
  сокетов по `closeTimeout` остаётся последней линией обороны.
- Ctrl-C/SIGINT-эргономика REPL в CLI-транспорте.

## Decisions

### D1. Сигнал живёт в контексте: `ExtendableContext.signal`

`ExtendableContext` получает поле `readonly signal: AbortSignal` (рядом с
`raw` и `endpoint`), `makeEmptyContext(raw, endpoint, signal?)` — опциональный
третий параметр. Так сигнал видят и middleware (через `ctx.signal`),
и pipeline.

Альтернативы:

- **`Raw.signal`** — отклонено: `Raw` описан как «нормализованные данные
  входа»; сигнал — не данные, а канал управления. К тому же `raw` концептуально
  сериализуем.
- **`ExecuteOptions.signal`** — отклонено: options — это политика выполнения
  (`exposeErrorDetails`), а middleware их не видят; сигнал же нужен
  и middleware (rate-limit, ожидания с отменой).
- **Инъекция middleware'ом** (`withSignal()`) — отклонено: рушит инвариант
  «сигнал есть всегда», требует явного подключения в каждый pipeline.

### D2. Инвариант «сигнал есть всегда»: never-aborted дефолт

Если транспорт не передал сигнал, `makeEmptyContext` подставляет общий
never-aborted сигнал (модульная константа `new AbortController().signal`).
Хендлеры пишут `meta.signal` без проверок на undefined; кастомные транспорты
не ломаются (параметр опциональный).

### D3. Инъекция в `meta` на уровне `executeWithHandler`; ключ `signal` зарезервирован

После накопления input pipeline собирает meta как
`{ ...metaFromInput, signal: ctx.signal }` — инъецированный сигнал
перекрывает одноимённое поле из input. Тип меты в сигнатурах хендлера
(`executeWithHandler`, `IEndpoint.handle`, `HandlerFn`) расширяется
пересечением `& { signal: AbortSignal }`. Ключ `signal` документируется
как зарезервированный.

Альтернатива — требовать от транспортов класть сигнал в `input` — отклонена:
инвариант D2 стал бы ответственностью каждого транспорта, а конфликт типов
с middleware остался бы.

### D4. HTTP: transport-level контроллер + per-request контроллер, композиция `AbortSignal.any`

- На транспорт — один `closeController: AbortController`
  (создаётся в `listen()`).
- На запрос — свой `requestController`; сигнал запроса =
  `AbortSignal.any([requestController.signal, closeController.signal])`.
- Дисконнект клиента: `nativeRes.on('close', ...)` — событие приходит и после
  нормального завершения, поэтому abort только при
  `!nativeRes.writableFinished` (ответ не дописан → это обрыв).
- `close()` транспорта: `closeController.abort(reason)` одной строкой —
  `AbortSignal.any` сам доставит отмену всем in-flight запросам.
  **Реестр in-flight контроллеров не нужен.**

Альтернатива — `Set<AbortController>` активных запросов, обход в `close()` —
отклонена: `AbortSignal.any` даёт ту же семантику декларативно, без
бухгалтерии add/delete и рисков утечки при исключениях.

Сигнал передаётся в `makeEmptyContext` в pipeline-ветке и кладётся в meta
(`{ signal }`) в fallback-ветке без pipeline.

### D5. Порядок в `close()`: abort → drain → force-close

`closeController.abort()` выполняется в начале `close()`, до `server.close()`.
Кооперативные хендлеры (включая бесконечные подписки) успевают завершиться
в окно дренажа, и дренаж становится основным механизмом; принудительный
`closeAllConnections()` по `closeTimeout` — fallback для хендлеров,
игнорирующих сигнал. Существующая семантика `closeTimeout` не меняется.

Уточнение по факту реализации: keep-alive соединение, освободившееся
уже после начала `close()` (запрос дорешался кооперативно), Node сам
не закрывает — единичный вызов `closeIdleConnections()` в начале дренажа
его не застаёт, и `close()` ждал бы keep-alive таймаута клиента. Поэтому
в окно дренажа добавлена периодическая зачистка idle-соединений
(`closeIdleConnections()` раз в 100мс, unref-интервал).

### D6. App: без изменения `ITransport`

`App.close()` уже вызывает `transport.close?.()` до `container.destroy()`.
Отмена in-flight — обязанность транспорта внутри его `close()` (D5).
«Комбинация app-уровневого и транспортного сигналов» из ideas.md реализуется
внутри транспорта: `closeController` и есть канал shutdown, транспортный
`requestController` — канал дисконнекта.

Альтернатива — расширить `ITransport` (метод `abort()` или параметр
`close(signal)`) — отклонена: дублирует семантику `close()`, увеличивает
поверхность контракта без нового поведения. Если streaming-v2/subscriptions
потребуют более тонкого управления — расширим там.

### D7. CLI: transport-level контроллер

`CliTransport` держит один `AbortController`, его сигнал передаётся
в `makeEmptyContext` в `execute()` (и в `{}`-meta fallback-ветки),
`close()` взводит его перед закрытием readline.

### D8. Причина аборта — информативная, без формального словаря

`abort(reason)` получает `Error` с человекочитаемым сообщением
(`'client disconnected'` / `'transport closing'`). Формальный словарь исходов
(`disconnected | aborted | ...`) — вместе с finish-фазой в streaming-v2.

## Risks / Trade-offs

- **[Ключ `signal` уже мог использоваться middleware]** → инъекция D3
  молча перекроет его в meta. Митигация: зарезервированность документируется
  в JSDoc `ExtendableContext` и README pipeline; на уровне типов пересечение
  `& { signal: AbortSignal }` сделает несовместимое поле видимым.
- **[Семантика `res.on('close')` зависит от версии Node / keep-alive]** →
  интеграционные тесты на реальном node:http с raw-сокетом (обрыв соединения
  посреди ответа), а не только юнит-моки.
- **[Утечка слушателей `AbortSignal.any` на долгоживущем `closeController`]** →
  в Node 20+ `AbortSignal.any` использует weak-ссылки; per-request контроллер
  и композитный сигнал собираются GC после завершения запроса. Проверяется
  тестом на большое число последовательных запросов (без роста слушателей).
- **[Хендлер игнорирует сигнал]** → поведение не хуже текущего: force-close
  по `closeTimeout` остаётся (D5).
- **[Расширение типа меты сломает type-тесты pipeline]** → ожидаемо;
  обновление `pipeline.spec.ts` — явная задача, не побочный эффект.

## Migration Plan

Изменение аддитивное, breaking-изменений нет:

- существующие хендлеры продолжают работать (лишнее поле в meta);
- `makeEmptyContext` расширяется опциональным параметром;
- кастомные транспорты без сигнала получают never-aborted дефолт.

Rollback — откат коммитов change; публичных контрактов, требующих миграции
потребителей, не появляется.

## Open Questions

- Нет блокирующих. Таксономия причин аборта и её отражение в finish-фазе —
  сознательно отложены до streaming-v2 (#6).
