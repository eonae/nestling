## 1. HTTP-транспорт: реестр контроллеров

- [ ] 1.1 `packages/nestling.transport.http/src/transport.ts`: поле
      `active: Set<AbortController>`; в `handle` контроллер запроса
      добавляется в реестр, сигнал запроса — `requestController.signal`
      без `AbortSignal.any`; запрос после начала остановки получает
      контроллер, взведённый причиной сигнала остановки
- [ ] 1.2 Обработчик `'close'` ответа удаляет контроллер из реестра до
      проверки `writableFinished`
- [ ] 1.3 `close()` взводит каждый контроллер реестра с
      `TransportClosingError` сразу после `closeController` и очищает
      реестр; JSDoc `close()`, поля `closeController` и комментарии в
      `handle` описывают реестр вместо композиции
- [ ] 1.4 `transport.integration.spec.ts`: тест «серия запросов оставляет
      реестр пустым» (размер `active` после серии равен нулю), тест
      «close() взводит сигналы нескольких запросов в полёте» с причиной
      `transport closing`; существующие тесты отмены проходят без правок
- [ ] 1.5 `yarn workspace @nestling/transport.http test` зелёный

## 2. Порты: помощник, бюджет, шина

- [ ] 2.1 Новый внутренний модуль `packages/nestling.ports/src/signal.ts`
      с `followSignal(source, target): () => void`: взводит `target`
      сразу, если `source` уже взведён, иначе ставит слушатель `abort` с
      `once` и возвращает функцию снятия; из `index.ts` не экспортируется
- [ ] 2.2 `profile.ts`, `startBudget`: собственный контроллер бюджета,
      флаг срабатывания таймера для `expired`, `followSignal` на сигнале
      вызывающего (кроме `NEVER_ABORTED`), `release()` снимает таймер и
      слушатель; JSDoc `CallBudget.signal` без слова «композиция»
- [ ] 2.3 `profile.spec.ts`: тест «release() снимает слушатель с сигнала
      вызывающего» через `getEventListeners`; тесты `expired` при
      обоих порядках взведения проходят
- [ ] 2.4 `bus.ts`, `request`: при `options.signal` — контроллер вызова,
      `followSignal`, реестр `#active`; в `finally` снятие слушателя и
      удаление из реестра; без `options.signal` — сигнал шины напрямую,
      как сейчас
- [ ] 2.5 `bus.ts`, `close()`: взводит контроллеры реестра до закрытия
      тем
- [ ] 2.6 `bus.spec.ts`: тесты «отмена вызывающим доходит до обработчика с
      той же причиной», «close() взводит сигнал вызова в полёте»,
      «завершённый вызов не оставляет ни записи в реестре, ни слушателя
      на `options.signal`»
- [ ] 2.7 `yarn workspace @nestling/ports test` зелёный

## 3. Бенчмарк и повторный замер

- [ ] 3.1 `scripts/bench/http-vs-fastify.ts`: колонки «σ req/s»
      (`requests.stddev`) и «max мс» (`latency.max`) в строке вывода;
      `scripts/bench/README.md` описывает новые колонки
- [ ] 3.2 Прогнать `yarn bench:http` на Node 22 после сборки; при
      наличии Node 24 — на нём тоже; зафиксировать условия замера

## 4. Документация и журнал решений

- [ ] 4.1 `docs/decisions/ideas.md`: запись [2026-09-05] «Сигнал отмены
      запроса: реестр контроллеров вместо `AbortSignal.any`» — контекст
      (d/10 §5, профиль), решение по трём местам, отвергнутые варианты
      (композит, слушатель на сигнале остановки, помощник в ядре),
      таблица замера с req/s, σ, p99 и max для Node 22 и Node 24, заметка
      про `AsyncContextFrame`
- [ ] 4.2 `docs/design/transports.md`: абзац про сигнал запроса описывает
      реестр контроллеров и `close()` вместо «объединяются через
      `AbortSignal.any`»; плашка дока получает ссылку на новую запись
- [ ] 4.3 `packages/nestling.pipeline/README.md`, раздел про
      ambient-контекст: Node 24 как рекомендуемая версия, флаг
      `--experimental-async-context-frame` для Node 22, одна фраза о
      цене; `packages/nestling.transport.http/README.md`: та же заметка в
      разделе «Границы пакета» или рядом с таймаутами; корневой
      `README.md`, раздел Status: строка о версии Node
- [ ] 4.4 `docs/decisions/roadmap.md`: строка 37 `abort-signal-registry`
      с сутью, размером S и статусом «в работе»; абзац об источнике
      (d/10) в преамбуле таблицы
- [ ] 4.5 `grep -rn "AbortSignal.any" docs/guide packages/*/src` —
      остаются только `@nestling/subscriptions`, `@nestling/transport.cli`
      и `@nestling/client`; главы гайда правок не требуют
- [ ] 4.6 Линтер `docs-style` по изменённым текстам — 0 запрещённых слов

## 5. Проверка

- [ ] 5.1 `yarn verify` зелёный
- [ ] 5.2 `yarn docs:audit` — 0 ERROR

## 6. Definition of Done

- [ ] 6.1 Все задачи выше отмечены
- [ ] 6.2 `yarn verify` зелёный (build + typecheck + lint + test +
      type-budget)
- [ ] 6.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 6.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [ ] 6.5 `yarn docs:audit` — 0 ERROR
- [ ] 6.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены
      с обновлённой датой в плашке «сверено с кодом» (change примеров не
      касается)
- [ ] 6.7 Линтер стиля по изменённым текстам — 0 запрещённых слов
- [ ] 6.8 Коммиты осмысленные, ветка запушена
