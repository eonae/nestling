# tasks — streaming-v2

Порядок групп соответствует Migration Plan из [design.md](./design.md):
пакет `@nestling/streams` → формы io → рантайм пайплайна → capability →
HTTP → CLI → примеры → доки. Внутри группы задачи упорядочены по
зависимостям.

## 1. Пакет `@nestling/streams`

- [x] 1.1 Завести пакет `packages/nestling.streams` по образцу
      существующих (`package.json`, `tsconfig`, jest, экспорты, README);
      внешних зависимостей нет
- [x] 1.2 `Topic<T>`: конструктор `{ buffer?, onSlowConsumer? }`,
      `push`, `subscribe(signal?)`, `close()`, счётчик подписчиков (D12)
- [x] 1.3 Политика медленного подписчика: буфер **per-подписчик**,
      `drop-oldest` (дефолт) со счётчиком отброшенных и `disconnect`;
      `push` не ждёт никогда
- [x] 1.4 Завершение подписки по `signal`, по `close()` и по выходу
      потребителя (`break`/`return()`); освобождение буфера и снятие
      подписки
- [x] 1.5 Утилиты итерации под `AbortSignal` (обёртка, завершающая
      итерацию по сигналу и корректно закрывающая источник)
- [x] 1.6 Реализация комбинаторов item-цепочки как функций над
      `AsyncIterable`: `tap`, `filter`, `limit`, `gapTimeout`,
      `throttle`, `batch`, `through` (D3)
- [x] 1.7 Рантайм-тесты: публикация без подписчиков; медленный
      подписчик не тормозит остальных; обе политики переполнения;
      1 000 циклов «подписался — отписался» не накапливают подписки;
      `close()` завершает все подписки нормально
- [x] 1.8 Рантайм-тесты комбинаторов: порядок применения, лимит,
      таймаут молчания, батчинг остатка на завершении потока,
      прекращение итерации закрывает источник

## 2. Формы io в ядре

- [x] 2.1 `packages/nestling.pipeline/src/core/io`: дерево форм —
      дескриптор с видом `value | stream | events | multipart`,
      неперечислимый бренд, иммутабельность (D1)
- [x] 2.2 `stream(T, opts?)` и `events(T, opts?)`: опции
      `{ validate?, onInvalid? }` с дефолтами `true`/`'fail'`; вид
      формы влияет на исход и framing, механизм общий (D2)
- [x] 2.3 Билдер item-цепочки на форме: методы возвращают **новую**
      форму; тип-параметры `StreamForm<TWire, TItem>` (D3)
- [x] 2.4 Асимметрия слотов: `output` принимает `StreamForm<T, T>`,
      `input` — `StreamForm<T, any>`; `.batch`/тип-меняющий `.through`
      в `output` — ошибка компиляции
- [x] 2.5 `multipart({ fields, files })` и `upload({ maxSize, mime,
      multiple })`; вывод payload `{ fields, files }` с файлами по
      именам полей (D8)
- [x] 2.6 Удалить `withFiles()`/`files()` и их типы; поправить все
      обращения в пакетах
- [x] 2.7 `describeForm(io)` вместо `analyzePayload`/`PayloadConfig`;
      обновить потребителей (`validate.ts`, `binding.ts`, оба
      транспорта)
- [x] 2.8 Маппинг формы на media type как функция-данные (значение →
      JSON, stream → NDJSON, events → SSE, multipart →
      `multipart/form-data`, примитивы)
- [x] 2.9 `InferInput`/`InferOutput` для дерева форм: поток даёт
      `AsyncIterableIterator<TItem>`, multipart — `{ fields, files }`,
      примитивы и схемы — как раньше
- [x] 2.10 Fail-fast формы при создании декларации: `multipart`/
      `upload()` в `output`, `upload()` вне `multipart`, потоковая
      форма без листа, конфликт имени файлового поля с полем `fields`;
      тексты называют ручку, слот и форму
- [x] 2.11 Type-тесты: вывод payload для каждой формы; `.batch` на
      входе меняет тип хендлера; `.batch` в `output` не компилируется;
      посторонний объект не принимается за форму
- [x] 2.12 Рантайм-тесты форм: иммутабельность цепочки при
      переиспользовании хелпера, описатель формы, media types

## 3. Рантайм пайплайна

- [x] 3.1 `src/core/status.ts`: статус `PAYLOAD_TOO_LARGE` (D10)
- [x] 3.2 `src/core/kernel-fails.ts`: `StreamLimitExceeded`
      (`STREAM_LIMIT_EXCEEDED`/`PAYLOAD_TOO_LARGE`) и `StreamGapTimeout`
      (`STREAM_GAP_TIMEOUT`/`TIMEOUT`) + расширение kernel-набора кодов
- [x] 3.3 `src/core/types/context.ts`: `summary` в `ExtendableContext`,
      создание в `makeEmptyContext` (D7)
- [x] 3.4 `bindInputStream(form, source, ctx)`: поэлементная валидация
      до цепочки, `onInvalid`, счётчик `itemsIn`, шаги цепочки,
      завершение по `signal` (D4, D5, D14)
- [x] 3.5 `normalizeResponse`: при потоковой форме `output` обернуть
      значение — цепочка → валидация после цепочки → счётчик
      `itemsOut` (D4)
- [x] 3.6 Finish-обёртка: `.finally`-юниты выполняются при завершении
      потока (конец, ошибка, `return()`), ровно один раз; исход
      вычисляется в этот момент с учётом вида формы (D6)
- [x] 3.7 `computeOutcome` учитывает вид формы: нормальный исход
      `events` при отвале клиента — `disconnected`, самозавершение
      источника — `completed`
- [x] 3.8 `src/middlewares/validate.ts`: потоковые и multipart-формы
      пропускаются (валидация живёт в обёртках форм)
- [x] 3.9 Рантайм-тесты пайплайна: `.finally` после последнего элемента;
      один вызов при обрыве; исходы `completed`/`disconnected`/
      `aborted`/`failed`; `.catch` не вызывается mid-stream; счётчики
      `itemsIn`/`itemsOut`; `summary` у не-потоковой ручки — нули
- [x] 3.10 Рантайм-тесты kernel-отказов: `.limit` даёт 413 с кодом,
      `.gapTimeout` — 504 с кодом; страж границы их не нормализует
- [x] 3.11 Прогнать `type-budget` и снапшоты диагностик (change #23):
      новые тип-параметры форм не должны сдвинуть порог

## 4. Capability транспортов

- [x] 4.1 `@nestling/transport`: `TransportCapabilities` и обязательное
      поле `capabilities` в `ITransport` (D13)
- [x] 4.2 Kernel-функция `assertFormsSupported(definition,
      capabilities, where)` с единым текстом ошибки (ручка, транспорт,
      слот, форма, список поддерживаемых форм)
- [x] 4.3 `@nestling/app`: вызов проверки при регистрации endpoint'ов
      (до гашения зависимостей), текст дополняется именем модуля
- [x] 4.4 Вызов той же проверки транспортами в `endpoint()`/`route()`
      для standalone-пути
- [x] 4.5 Тесты: `events` на CLI падает на старте; multipart на
      транспорте без него падает и через `App`, и напрямую;
      поддерживаемая форма регистрируется; сервер не начинает слушать
      при несовместимой декларации

## 5. HTTP-транспорт

- [x] 5.1 `capabilities` HTTP: вход `value`/`stream`/`multipart`, выход
      `value`/`stream`/`events`
- [x] 5.2 `adapter.ts`: framing по форме — NDJSON (`application/x-ndjson`,
      chunked) для `stream`, SSE (`text/event-stream`, `no-cache`,
      `keep-alive`) для `events`; общий «любой AsyncIterable → NDJSON»
      убрать
- [x] 5.3 SSE-кадры: `data:`, опциональные `id:`/`event:` из секции
      `sse` HTTP-словаря, heartbeat-комментарии (опция транспорта
      `sseHeartbeat`, дефолт 15s) (D11)
- [x] 5.4 Проверки секции `sse` при создании декларации: `sse` без
      `events`-выхода, зарезервированное имя события `error`
- [x] 5.5 `Last-Event-ID` → типизированный стартовый контекст
      (`lastEventId?: string`) для деклараций с `events`-выходом
- [x] 5.6 `parser.ts`: NDJSON-вход отдаёт поток значений без
      собственной валидации (её делает `bindInputStream`); лимит длины
      строки сохраняется
- [x] 5.7 `parser.ts`: multipart по форме — файлы под именами
      объявленных полей, `maxSize`/`mime` каждого поля применяются во
      время разбора, незаявленное файловое поле отвергается, второй
      файл в single-поле отвергается
- [x] 5.8 `transport.ts`: приём по `describeForm` вместо switch по
      старым типам; подмешивание path/query к `fields` multipart;
      `STATUS_MAP` пополняется `PAYLOAD_TOO_LARGE → 413`
- [x] 5.9 Mid-stream политика: NDJSON — обрыв соединения, SSE — кадр
      `event: error` с телом отказа и закрытие; исход `failed`;
      нормализация незадекларированного и хук диагностики как обычно
      (D9)
- [x] 5.10 Закрытие итератора ответа (`return()`) при дисконнекте,
      ошибке записи и `close()`; дренаж входного потока при отказе
- [x] 5.11 Байты в `summary` (`bytesIn`/`bytesOut`) там, где транспорт
      их знает
- [x] 5.12 Интеграционные тесты: NDJSON-ответ и SSE-ответ (кадры, id,
      event, heartbeat); реконнект с `Last-Event-ID`; multipart с
      лимитами полей (413/400); mid-stream обрыв и `event: error`;
      дисконнект закрывает итератор и снимает подписку; `close()`
      завершает SSE-соединение

## 6. CLI-транспорт

- [x] 6.1 `capabilities` CLI: вход `value`/`stream`, выход
      `value`/`stream`
- [x] 6.2 Приём stdin через `describeForm` и `bindInputStream`
      (`stream('binary')` остаётся рабочей формой)
- [x] 6.3 Потоковый выход: NDJSON в stdout, завершение по концу потока
      и по сигналу
- [x] 6.4 Тесты: потоковый вход и выход, отказ регистрации для
      `events`/`multipart`

## 7. Примеры

- [x] 7.1 `examples.app-with-http/…/upload-avatar.endpoint.ts` — на
      `multipart({ fields, files: { avatar: upload({ maxSize, mime }) } })`
- [x] 7.2 `examples.app-with-http` — item-цепочки в
      `import-users`/`export-users` (лимит, таймаут молчания, `tap`)
- [x] 7.3 `examples.app-with-http` — новая SSE-ручка поверх `Topic`:
      хаб-провайдер, `output: events(...)`, `sse: { id, event }`,
      `.finally`-наблюдатель с `ctx.summary`
- [x] 7.4 `examples.simple-http-server` и `examples.simple-cli` —
      сверить с новыми формами
- [x] 7.5 Прогнать примеры руками: NDJSON-стрим, SSE (`curl -N`),
      загрузка файла с превышением лимита, обрыв клиента посреди
      подписки

## 8. Документация

- [x] 8.1 `docs/design/streaming.md` — сверить с реализацией: опции
      форм (`validate`/`onInvalid`), состав `summary`, mid-stream
      политика, момент вызова `.finally`, политика `Topic`
- [x] 8.2 `docs/design/endpoints.md` §5 — `multipart`/`upload`, секция
      `sse` в HTTP-словаре, `lastEventId` в стартовом контексте
- [x] 8.3 `docs/design/transports.md` — `capabilities` транспорта и
      правило проверки биндинга; `docs/design/pipeline.md` —
      отложенный `.finally` и `summary`
- [x] 8.4 README пакетов: новый `@nestling/streams`, обновление
      `@nestling/pipeline`, `@nestling/transport.http`,
      `@nestling/transport.cli` (включая плашки статуса)
- [x] 8.5 `docs/guides/http-functional.md` и `docs/guides/cli.md` —
      примеры стриминга и загрузки файлов, дата в плашке «сверено с
      кодом»
- [x] 8.6 `docs/preview/` — упоминания стриминга привести в
      соответствие (`stream` vs `events`, SSE)
- [x] 8.7 Открытые вопросы, оставшиеся после реализации (гранулярность
      байтов, `events` во входе, семантика `throttle` при
      переполнении), — в `docs/decisions/deferred.md` с триггером
      возврата
- [ ] 8.8 Запись в `docs/decisions/ideas.md` — **только по явной
      просьбе пользователя**: предложить запись, закрывающую открытые
      вопросы журнала (политика `Topic` для медленного подписчика;
      дефолт и форма opt-out поэлементной валидации; политика
      невалидного элемента) — иначе решения остаются в артефактах
      change'а и в `archlog.md` при архивации — *запись подготовлена и
      предложена пользователю; без явного «запиши» в `ideas.md` не
      вносится (правило CLAUDE.md)*
- [x] 8.9 Отметить статус change #6 в `docs/decisions/roadmap.md`

## 9. Definition of Done

- [x] 9.1 Все задачи выше отмечены — кроме 8.8, ожидающего явной
      просьбы пользователя (см. пометку там)
- [x] 9.2 `yarn verify` зелёный (`build` + `lint` + `test` +
      `type-budget` по всем пакетам, включая новый `@nestling/streams`)
- [x] 9.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 9.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [x] 9.5 `yarn docs:audit` — 0 ERROR
- [x] 9.6 Затронутые `packages/examples.*` мигрированы, гайды
      пересверены с обновлённой датой в плашке «сверено с кодом»
- [ ] 9.7 Коммиты осмысленные, ветка запушена — *коммиты готовы (8 шт.);
      push не прошёл по той же причине, что у change 15: `git@github.com`
      отвергает единственный доступный ключ (`Permission denied
      (publickey)`, ssh-agent пуст), `gh` не установлен. Требуется push
      с машины пользователя*
