## 1. HTTP-транспорт: реестр контроллеров

- [x] 1.1 `packages/nestling.transport.http/src/transport.ts`: поле
      `active: Set<AbortController>`; в `handle` контроллер запроса
      добавляется в реестр, сигнал запроса — `requestController.signal`
      без `AbortSignal.any`
- [x] 1.2 Обработчик `'close'` ответа удаляет контроллер из реестра до
      проверки `writableFinished`
- [x] 1.3 `close()` взводит каждый контроллер реестра с
      `TransportClosingError` сразу после `closeController` и очищает
      реестр; JSDoc `close()`, поля `closeController` и комментарии в
      `handle` описывают реестр вместо композиции
- [x] 1.4 `transport.integration.spec.ts`: тест «серия запросов оставляет
      реестр пустым» (размер `active` после серии равен нулю), тест
      «close() взводит сигналы нескольких запросов в полёте» с причиной
      `transport closing`; существующие тесты отмены проходят без правок
- [x] 1.5 `yarn workspace @nestling/transport.http test` зелёный

## 2. Порты: помощник, бюджет, шина

- [x] 2.1 Новый внутренний модуль `packages/nestling.ports/src/signal.ts`
      с `followSignal(source, target): () => void`: взводит `target`
      сразу, если `source` уже взведён, иначе ставит слушатель `abort` с
      `once` и возвращает функцию снятия; из `index.ts` не экспортируется
- [x] 2.2 `profile.ts`, `startBudget`: собственный контроллер бюджета,
      флаг срабатывания таймера для `expired`, `followSignal` на сигнале
      вызывающего (кроме `NEVER_ABORTED`), `release()` снимает таймер и
      слушатель; JSDoc `CallBudget.signal` без слова «композиция»
- [x] 2.3 `profile.spec.ts`: тест «release() снимает слушатель с сигнала
      вызывающего» через `getEventListeners`; тесты `expired` при
      обоих порядках взведения проходят
- [x] 2.4 `bus.ts`, `request`: при `options.signal` — контроллер вызова,
      `followSignal`, реестр `#active`; в `finally` снятие слушателя и
      удаление из реестра; без `options.signal` — сигнал шины напрямую,
      как сейчас
- [x] 2.5 `bus.ts`, `close()`: взводит контроллеры реестра до закрытия
      тем
- [x] 2.6 `bus.spec.ts`: тесты «отмена вызывающим доходит до обработчика с
      той же причиной», «close() взводит сигнал вызова в полёте»,
      «завершённый вызов не оставляет ни записи в реестре, ни слушателя
      на `options.signal`»
- [x] 2.7 `yarn workspace @nestling/ports test` зелёный

## 3. Бенчмарк и повторный замер

- [x] 3.1 `scripts/bench/http-vs-fastify.ts`: колонки «σ req/s»
      (`requests.stddev`) и «max мс» (`latency.max`) в строке вывода;
      `scripts/bench/README.md` описывает новые колонки
- [x] 3.2 Прогнать `yarn bench:http` на Node 22 после сборки; при
      наличии Node 24 — на нём тоже; зафиксировать условия замера

## 4. Документация и журнал решений

- [x] 4.1 `docs/decisions/ideas.md`: запись [2026-09-05] «Сигнал отмены
      запроса: реестр контроллеров вместо `AbortSignal.any`» — контекст
      (d/10 §5, профиль), решение по трём местам, отвергнутые варианты
      (композит, слушатель на сигнале остановки, помощник в ядре),
      таблица замера с req/s, σ, p99 и max для Node 22 и Node 24, заметка
      про `AsyncContextFrame`
- [x] 4.2 `docs/design/transports.md`: абзац про сигнал запроса описывает
      реестр контроллеров и `close()` вместо «объединяются через
      `AbortSignal.any`»; плашка дока получает ссылку на новую запись
- [x] 4.3 `packages/nestling.pipeline/README.md`, раздел про
      ambient-контекст: Node 24 как рекомендуемая версия, флаг
      `--experimental-async-context-frame` для Node 22, одна фраза о
      цене; `packages/nestling.transport.http/README.md`: та же заметка в
      разделе «Границы пакета» или рядом с таймаутами; корневой
      `README.md`, раздел Status: строка о версии Node
- [x] 4.4 `docs/decisions/roadmap.md`: строка 37 `abort-signal-registry`
      с сутью, размером S и статусом «в работе»; абзац об источнике
      (d/10) в преамбуле таблицы
- [x] 4.5 `grep -rn "AbortSignal.any" docs/guide packages/*/src` —
      остаются только `@nestling/subscriptions`, `@nestling/transport.cli`
      и `@nestling/client`; главы гайда правок не требуют
- [x] 4.6 Линтер `docs-style` по изменённым текстам — 0 запрещённых слов

## 7. Бенчмарк: четыре сервера в отдельных процессах

- [x] 7.1 `express`, `@types/express`, `hono`, `@hono/node-server` —
      devDependencies корня
- [x] 7.2 `scripts/bench/servers.ts`: фабрики серверов nestling, fastify,
      express, hono с одной парой endpoint'ов; `scripts/bench/server.ts`:
      точка входа дочернего процесса, печатает `NODE=` и `PORT=`
- [x] 7.3 `scripts/bench/http.ts`: раннер поднимает серверы по очереди в
      дочерних процессах (`tsx/cli` под `BENCH_NODE`), прогоняет
      autocannon, печатает таблицу на сценарий и сводку с отношением к
      Fastify; флаг `--markdown`; `BENCH_SERVERS`; `bench:http` в
      `package.json` указывает на него, `http-vs-fastify.ts` удалён
- [x] 7.4 `scripts/bench/README.md`: файлы, переменные, колонки, раздел
      «Почему Nestling медленнее Fastify» по профилю
- [x] 7.5 Прогон на Node 22 и Node 24; результат добавлен к записи
      ideas.md [2026-09-05]

## 8. Node 24 и честный бенчмарк

- [x] 8.1 Репозиторий рассчитан только на Node 24: `.nvmrc`, `engines` в
      корневом `package.json`, контекст `openspec/config.yaml`; README
      корня, `@nestling/pipeline` и `@nestling/transport.http` без
      упоминания флага для Node 22; `yarn verify:fresh` зелёный под Node 24
- [x] 8.2 `servers.ts`: у Fastify, Hono и Express по два варианта — с теми
      же обязанностями, что у Nestling (проверка path-параметра той же
      zod-схемой, область `AsyncLocalStorage` на запрос), и голый
- [x] 8.3 `http.ts`: `BENCH_ROUNDS` с медианой по прогонам,
      `BENCH_REFERENCE` для колонки отношения; условия замера печатают
      число прогонов
- [x] 8.4 README бенчмарка: два яруса серверов, новые переменные, раздел
      «Почему медленнее» по замеру с равными обязанностями; запись
      ideas.md [2026-09-05] с таблицей только для Node 24; запись о
      целевой версии Node

## 5. Проверка

- [x] 5.1 `yarn verify` зелёный
- [x] 5.2 `yarn docs:audit` — 0 ERROR

## 6. Definition of Done

- [x] 6.1 Все задачи выше отмечены
- [x] 6.2 `yarn verify` зелёный (build + typecheck + lint + test +
      type-budget)
- [x] 6.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 6.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [x] 6.5 `yarn docs:audit` — 0 ERROR
- [x] 6.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены
      с обновлённой датой в плашке «сверено с кодом» (change примеров не
      касается)
- [x] 6.7 Линтер стиля по изменённым текстам — 0 запрещённых слов
- [x] 6.8 Коммиты осмысленные, ветка запушена
