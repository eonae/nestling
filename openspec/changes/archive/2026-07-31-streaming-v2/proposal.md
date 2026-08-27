# streaming-v2: `stream` ≠ `events`, io-декларация как дерево форм

## Why

Стриминга в целевом смысле в коде нет — есть один недифференцированный
модификатор. `stream(T)` (`packages/nestling.pipeline/src/core/io/io.ts`)
покрывает и конечный экспорт, и бесконечную подписку: HTTP отдаёт и то и
другое одинаковым NDJSON-потоком (`adapter.ts:66-93`), SSE не существует,
heartbeat и `Last-Event-ID` — тоже. Поэтому «открытая подписка» сегодня
неотличима от «большого ответа»: у неё нет ни своего framing'а, ни своего
нормального исхода (`disconnected`), а `computeOutcome` вызывается **до**
того, как байты ушли клиенту, — ограничение, помеченное в коде прямой
ссылкой на этот change (`src/core/types/unit.ts:29-32`).

Второй разрыв — форма io. Целевая модель («Контракт первичен» п. 5) —
дерево форм `value | stream | events | multipart` с листьями Standard
Schema; в коде вместо него плоский набор `stream`/`withFiles`/`files` +
примитивы, где multipart описан двумя разными модификаторами, лимит файла
берётся из общего `maxBodySize`, а `upload({ maxSize, mime })` отсутствует.
Поэлементная валидация есть только на входе и только в HTTP-парсере
(`parser.ts:260`) — выход не валидируется вовсе, хотя схема описывает
провод в обе стороны.

Третий разрыв — item-скоуп. Действия на каждый элемент (лимиты, таймаут
молчания, наблюдение, батчинг) выражать нечем: request-pipeline — это
фазы на весь запрос, и попытка засунуть в него поэлементную логику была
разобрана и отвергнута в журнале. Наконец, отсутствует `Topic` — примитив,
на который в целевом дизайне опираются и config (`reloadable`), и
`InProcessBus` портов, из-за чего этот change стоит в волне 3 до них.

Логика решений зафиксирована в `docs/decisions/ideas.md`, секции
«[2026-07-06] Стриминг: `stream(T)` ≠ `events(T)`, AbortSignal, источники
событий», «[2026-07-06] Два скоупа обработки: request-pipeline и
item-цепочки» и «[2026-07-13] Контракт первичен» (п. 4–5: формы io и
capability-валидация биндинга); целевое состояние описано в
[`docs/design/streaming.md`](../../../docs/design/streaming.md) и
[`docs/design/endpoints.md`](../../../docs/design/endpoints.md) §5. Это
change #6 из [roadmap](../../../docs/decisions/roadmap.md), второй и
последний в волне 3.

## What Changes

- **`stream(T)` и `events(T)` — разные формы.** `stream` — конечные
  данные (нормальный исход `completed`, HTTP-framing NDJSON); `events` —
  открытая подписка (нормальный исход `disconnected`, HTTP-framing SSE с
  heartbeat, `id:` и приёмом `Last-Event-ID`). Различие объявляется в
  декларации и определяет и framing, и семантику завершения.
- **io-декларация — дерево форм.** Верхний уровень:
  значение | `stream(T)` | `events(T)` | `multipart({ fields, files })`;
  листья — произвольные Standard Schema (примитивы `'binary'`/`'text'`
  остаются листьями). Валидация по форме: значение — целиком,
  `stream`/`events` — поэлементно **в обе стороны**, поля multipart —
  схемой. Маппинг форм на media types детерминирован.
- **`multipart({ fields, files })` + `upload({ maxSize, mime, multiple })`
  заменяют `withFiles()`/`files()`. BREAKING.** Лимит и MIME-фильтр
  применяются **во время** парсинга, без буферизации, и объявляются на
  файловом поле, а не берутся из общего `maxBodySize`. Payload
  типизируется как `{ fields, files }` с полями-файлами по именам.
- **Item-цепочки на io-декларации.** Закрытый инфраструктурный словарь
  комбинаторов: `.tap`, `.filter`, `.limit`, `.gapTimeout`, `.throttle`,
  `.batch`, `.through`. Асимметрия по schema-first: входная цепочка может
  менять тип (её результат — форма хендлера), выходная — только `T → T`
  (оба конца зафиксированы схемой). Фаз у цепочки нет — это линейная
  последовательность трансформаций.
- **`summary` для наблюдателей.** Рантайм считает `itemsIn`/`itemsOut`
  (и байты там, где их знает транспорт) и отдаёт их `.finally`-юнитам
  через контекст — вместо хака «счётчики в мутируемом ctx».
- **Исход потокового ответа честен. BREAKING (уточнение семантики).**
  Для потоковых форм `.finally` вызывается **после** того, как поток
  дотёк или оборвался, а не после ответной фазы: `completed` для
  дотёкшего `stream`, `disconnected` при отвале клиента, `failed` при
  mid-stream ошибке. Для не-потоковых ответов поведение прежнее.
- **`Topic` — broadcast-примитив источников событий.** Bounded buffer +
  `AbortSignal`, политика `onSlowConsumer` (`drop-oldest` | `disconnect`),
  подписка — обычный `AsyncIterable`. Публикация не зависит от наличия
  подписчиков; горячий источник не ждёт медленного клиента. Живёт в новом
  пакете **`@nestling/streams`** без внешних зависимостей — его же
  переиспользуют config (`reloadable`, #9) и `InProcessBus` (#11).
- **Mid-stream отказ.** Ответ уже течёт → статус сменить нельзя: для
  NDJSON поток обрывается, для SSE уходит именованное событие `error` с
  телом отказа, в обоих случаях исход `finally` — `failed`, оригинал — в
  диагностический хук. Закрывает non-goal change'а #15 («`Fail` посреди
  стрима — к #6»).
- **Kernel-отказы цепочек.** `.limit()` и `.gapTimeout()` отказывают
  встроенными определениями (`STREAM_LIMIT_EXCEEDED`,
  `STREAM_GAP_TIMEOUT`), входящими в kernel-набор — иначе страж границы
  превращал бы штатный отказ лимита в `500 UNKNOWN`. Словарь статусов
  пополняется `PAYLOAD_TOO_LARGE` (HTTP 413).
- **Capability-валидация биндинга (fail-fast на ASSEMBLE).** Транспорт
  объявляет поддерживаемые формы (`capabilities`); декларация с формой,
  которую транспорт не умеет, падает **при регистрации, до приёма
  запросов**, с внятным текстом («транспорт `cli` не умеет `events` в
  `output`»). Богатство объявляется в контракте — проверяется на сборке.
- **Отмена доводится до итератора.** Дисконнект и graceful shutdown не
  только взводят `meta.signal`, но и закрывают потребляемый итератор
  (`return()`), чтобы `try/finally` в хендлере-генераторе и отписка от
  `Topic` отработали детерминированно.

### Non-goals

- **Реестр подписок** — отдельный change #7 `subscriptions-registry`,
  satellite поверх публичных примитивов (signal + finish-хуки + `Topic`).
  Здесь появляются только сами примитивы.
- **Стриминг по шине портов** — в V1 это ровно fail-fast на ASSEMBLE
  (шина объявляет только value-формы); дизайн стриминга через шину
  проектируется вместе с AsyncAPI после #11.
- **RxJS на публичных границах** — границы остаются `AsyncIterable`;
  комбинаторы с реордерингом времени, слиянием потоков и higher-order
  streams (`merge`, `switchMap`, `combineLatest`) в словарь item-цепочек
  не входят и не войдут. Rx доступен внутри хендлера как обычная
  зависимость приложения.
- **DI в комбинаторах item-цепочки** — io-декларация создаётся вне
  контейнера; комбинаторы остаются функциями/замыканиями (открытый
  вопрос журнала, v1-ответ — «логике с DI место в хендлере или
  request-юните»).
- **AsyncAPI-документация событийных контрактов** и раскладка форм в
  OpenAPI — change #20; здесь фиксируется только детерминированный
  маппинг форм на media types как вход для генератора.
- **Streaming-клиент** (`makeClient` поверх `stream`/`events`) — после
  #22, явно помечен там как «v2 (после 6)».
- **`serve(dispatch, signal)` вместо `listen()`** — change #10
  `features`; здесь `capabilities` добавляется к текущему интерфейсу
  транспорта.
- **Gate / ранний успешный выход из цепочки** — открытый вопрос журнала,
  в V1 не вводится.

## Capabilities

### New Capabilities

- `io-forms`: io-декларация как дерево форм — `value`/`stream(T)`/
  `events(T)`/`multipart({ fields, files })`, `upload({ maxSize, mime,
  multiple })`, листья Standard Schema и примитивы; вывод типов
  payload/output из формы; поэлементная валидация входа и выхода,
  политика невалидного элемента (`onInvalid`, дефолт `fail`) и opt-out
  для горячих потоков; детерминированный маппинг форм на media types;
  fail-fast формы при создании декларации (`multipart` в `output`,
  `upload()` вне `multipart`, `events` без схемы и т. п.).
- `stream-item-chains`: item-скоуп — закрытый словарь комбинаторов
  (`tap`/`filter`/`limit`/`gapTimeout`/`throttle`/`batch`/`through`),
  асимметрия входа и выхода, отсутствие фаз, эскалация ошибок цепочки в
  request-pipeline, kernel-отказы `STREAM_LIMIT_EXCEEDED` и
  `STREAM_GAP_TIMEOUT`, стандартные счётчики в `summary`,
  переиспользование цепочек функциями-хелперами, семантика
  per-connection.
- `event-sources-topic`: `Topic<T>` в новом пакете `@nestling/streams` —
  bounded buffer, `onSlowConsumer`, `subscribe(signal): AsyncIterable`,
  независимость публикации от подписчиков, закрытие подписок по сигналу
  и при `close()`; источник событий — обычный singleton-провайдер, а не
  особый вид endpoint'а.
- `http-streaming-framing`: HTTP-framing форм — NDJSON/chunked для
  `stream`, SSE для `events` (заголовки, heartbeat, `id:`, приём
  `Last-Event-ID` в типизированный стартовый контекст), парсинг
  `multipart` с лимитами `upload()` во время разбора, mid-stream политика
  отказа, закрытие итератора при дисконнекте.
- `transport-form-capabilities`: транспорт объявляет поддерживаемые формы
  io раздельно для входа и выхода; регистрация декларации с
  неподдерживаемой формой — ошибка на сборке (до приёма запросов) с
  указанием ручки, транспорта и формы; способности HTTP и CLI
  зафиксированы.

### Modified Capabilities

- `pipeline-phase-model`: исход потокового ответа вычисляется после
  завершения отдачи потока (а не после ответной фазы) — `.finally`
  для потоковых форм откладывается до конца стрима; в контексте
  появляется `summary`; выходная item-цепочка и поэлементная валидация
  выхода применяются при нормализации ответа.
- `endpoint-declarations`: словарь декларации принимает формы io и
  item-цепочки; проверки формы выполняются при создании значения
  наравне с остальным словарём.
- `http-input-binding`: `describeInput`/bind-карта работают с новым
  деревом форм (`multipart` вместо `withFiles`/`files`); правила
  несовместимости `rawBody` и `bind` формулируются в терминах форм.
- `http-transport-limits`: лимит файла берётся из `upload({ maxSize })`
  декларации, а не только из общего `maxBodySize`; лимит длины
  NDJSON-строки сохраняется и распространяется на SSE-вход; heartbeat не
  участвует в лимитах.
- `http-request-cancellation`: дисконнект во время потокового ответа
  закрывает итератор хендлера (`return()`) и доводит отмену до подписок;
  graceful `close()` завершает открытые `events`-соединения.
- `error-values`: словарь статусов пополняется `PAYLOAD_TOO_LARGE`
  (HTTP 413).
- `domain-fail-definitions`: kernel-набор кодов пополняется
  `STREAM_LIMIT_EXCEEDED` и `STREAM_GAP_TIMEOUT`.

## Impact

**Публичный API (BREAKING):**
- `withFiles()`/`files()` и типы `WithFilesModifier`/`FilesModifier`
  удаляются — их место занимают `multipart()`/`upload()`; payload
  multipart-ручки меняет форму (`{ data, files }` → `{ fields, files }`
  с файлами по именам полей).
- `analyzePayload`/`PayloadConfig` (API для авторов транспортов)
  заменяются описателем формы, знающим `events` и `multipart`.
- `.finally` у потоковых ручек вызывается позже, чем сейчас, и видит
  исход, вычисленный по факту доставки; код, полагавшийся на прежний
  момент вызова, изменит поведение.
- `ITransport` получает обязательное поле `capabilities`; сторонние
  транспорты обязаны его объявить.

**Новый пакет:** `@nestling/streams` — `Topic`, реализация комбинаторов
item-цепочек и утилиты работы с `AsyncIterable` под `AbortSignal`; без
внешних зависимостей. Зависимость `@nestling/pipeline` → `@nestling/streams`.

**Код:** `packages/nestling.pipeline` — `src/core/io/*` (дерево форм,
цепочки, вывод типов), `src/core/status.ts` (`PAYLOAD_TOO_LARGE`),
`src/core/kernel-fails.ts` (два новых определения),
`src/core/pipeline.ts` (нормализация потокового ответа, отложенный
`finally`, `summary`), `src/core/types/context.ts` (`summary` в
контексте), `src/core/types/unit.ts` (уточнение `Outcome`),
`src/middlewares/validate.ts` (пропуск потоковых форм),
`src/metadata/endpoint.ts` (проверки формы при создании);
`packages/nestling.transport` (`capabilities` в `ITransport`);
`packages/nestling.transport.http` (`parser.ts` — multipart с
`upload()`-лимитами и поэлементный разбор, `adapter.ts` — NDJSON и SSE,
`transport.ts` — приём форм, mid-stream политика, закрытие итератора,
`binding.ts` — формы в `describeInput`);
`packages/nestling.transport.cli` (объявление способностей, stdin как
`stream`, NDJSON-выход); `packages/nestling.app` (capability-проверка при
регистрации).

**Примеры и доки:** `packages/examples.app-with-http`
(`upload-avatar.endpoint.ts` — на `multipart`/`upload`; export/import
users — item-цепочки; новая SSE-ручка поверх `Topic`),
`packages/examples.simple-http-server`, `packages/examples.simple-cli`;
`docs/guides/http-functional.md` и `docs/guides/cli.md` (пересверка с
датой плашки), `docs/design/streaming.md` и `docs/design/endpoints.md`
(сверка с реализацией: `summary`, опции форм, mid-stream политика),
`docs/design/transports.md` (capabilities), `docs/preview/*`, README
пакетов `@nestling/pipeline`, `@nestling/transport.http`,
`@nestling/transport.cli` и нового `@nestling/streams`,
`docs/decisions/roadmap.md` (статус #6).

**Зависимости:** новых внешних нет (SSE и NDJSON пишутся руками, busboy
остаётся). Апстрим — #3 `abort-signal` (сигнал насквозь), #4
`pipeline-v2` (фазы), #15 `error-model` (kernel-коды и страж границы),
#21/#24 (bind-карта и форма деклараций). Даунстрим — #7
`subscriptions-registry` (signal + finish-хуки), #9 `config-module` и
#11 `ports` (`Topic`), #20 `openapi` (маппинг форм на media types), #22
`contract-clients` (streaming-клиент).
