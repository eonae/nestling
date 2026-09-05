# hot-path-trim

## Why

После change'а `abort-signal-registry` бенчмарк с равными обязанностями
(`scripts/bench/http.ts`, Node 24) даёт Nestling 0.80 от Fastify на
`GET /users/:id` и 1.00 на `POST /users`. Fastify с той же проверкой
параметра и областью `AsyncLocalStorage` теряет против голого 2%, то есть
разрыв даёт не цена гарантий, а обвязка запроса: разбор адреса через
`new URL`, вычисления по декларации на каждый запрос, заголовки через
несколько `setHeader`, копии массивов слоёв и проверка инвариантов
пайплайна в `execute`, лишние `await`. Разбор по профилю — запись
ideas.md [2026-09-05] «Сигнал отмены запроса» и
`scripts/bench/README.md`, раздел «Почему Nestling медленнее Fastify»;
список пунктов — d/10 §5.5. Цель change'а не догнать Fastify, а убрать
всё, что убирается без потери гарантий и без нового кода на горячем пути.

## What Changes

- `@nestling/transport.http`, `sendResponse`: ответ формы `value` уходит
  одним `writeHead(status, headers)` с `content-type`, `content-length` и
  заголовками `Ok`, тело передаётся буфером. Заголовок хендлера
  по-прежнему перекрывает заголовок формы: имена приводятся к нижнему
  регистру до слияния.
- `@nestling/transport.http`, `handle`: адрес разбирается без `new URL`;
  query-строка разбирается только когда её читает bind-карта и она есть в
  запросе. `raw.pattern` несёт путь запроса как прислан клиентом, без
  нормализации.
- `@nestling/transport.http`, `HttpRouter`: bind-карта, формы `input` и
  `output`, признаки «нужно тело» и «читает query» вычисляются один раз
  при регистрации маршрута и лежат в его записи.
- `@nestling/pipeline`, `execute`: проверка нерезолвленных юнитов
  переезжает в конструктор, список активированных слоёв заменяется
  счётчиком, ответная фаза обходит слои по индексу без копий массивов,
  `.finally` не вызывается при пустом списке.
- `@nestling/pipeline`, `@nestling/transport`: `executeWithHandler` и
  `dispatch.call` возвращают промис без лишней `async`-обёртки.
- `@nestling/pipeline`, накопление контекста: результат pre-юнита
  дописывается в один объект `input` вместо двойного spread; ячейка
  контекста ссылается на тот же объект и не обновляется отдельно.
- Каждый пункт принимается по замеру `BENCH_SERVERS=nestling,fastify
  BENCH_ROUNDS=3` до и после; результат записывается в ideas.md.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

- `http-transport-boundary`: новое требование к ответу формы `value`
  (одна запись заголовков с `content-length`, заголовок `Ok` перекрывает
  заголовок формы по имени без учёта регистра) и к `raw.pattern` (путь
  запроса без query, как прислан клиентом).

## Impact

- `packages/nestling.transport.http/src/adapter.ts`, `transport.ts`,
  `router.ts`; `transport.integration.spec.ts` — тесты заголовков и
  `raw.pattern`.
- `packages/nestling.pipeline/src/core/pipeline.ts`; спеки пайплайна
  проходят без правок.
- `packages/nestling.transport/src/dispatch.ts`.
- `docs/decisions/ideas.md` — запись с замером по пунктам;
  `packages/nestling.transport.http/README.md` — строка про `raw.pattern`;
  `scripts/bench/README.md` — обновлённые числа в разделе «Почему».

## Non-goals

- Сериализатор из схемы `output`, замена `find-my-way`, ленивый
  `AbortController`, отказ от `AsyncLocalStorage`, кэш ответов.
- Изменение публичных типов `EndpointMeta` и `ExtendableContext`: формы
  io в `EndpointMeta` не добавляются, выигрыш меньше 0.05 µs.
- Потоковые ответы: их путь не горячий, `writeSse` и `writeNdjson` не
  трогаются.
