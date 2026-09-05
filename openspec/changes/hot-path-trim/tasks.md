## 1. Базовая линия

- [x] 1.1 `BENCH_SERVERS=nestling,fastify BENCH_ROUNDS=3 BENCH_DURATION=6
      yarn bench:http` на Node 24 до правок; числа записаны для таблицы
      ideas.md

## 2. Транспорт: заголовки и тело

- [x] 2.1 `adapter.ts`, `sendResponse`: для формы `value` один объект
      заголовков (`content-type` формы, заголовки `Ok` в нижнем регистре,
      `content-length`), `writeHead(status, headers)`, тело буфером,
      `countBytes` по длине буфера; потоковые формы без изменений
- [x] 2.2 `transport.integration.spec.ts`: тесты «JSON-ответ несёт
      `content-length`» и «`Ok.created(v, { 'Content-Type': … })` даёт один
      заголовок»
- [x] 2.3 Замер после пункта; результат в таблицу

## 3. Транспорт: адрес и запись маршрута

- [x] 3.1 `router.ts`: запись маршрута с `declaration`, `binding`,
      `inputForm`, `outputForm`, `needsBody`, `readsQuery`, вычисленными в
      `route()`; `find()` возвращает запись и `params`
- [x] 3.2 `transport.ts`, `handle`: путь срезом до `?`, `URLSearchParams`
      только при `readsQuery` и наличии `?`; `raw.pattern` из сырого
      пути; поля запроса берутся из записи маршрута
- [x] 3.3 `transport.integration.spec.ts`: тест `raw.pattern` для пути с
      `%20` и query; существующие тесты query проходят без правок
- [x] 3.4 README `@nestling/transport.http`: строка о `raw.pattern` как
      сыром пути
- [x] 3.5 Замер после пункта; результат в таблицу

## 4. Пайплайн: инварианты в конструктор

- [x] 4.1 `pipeline.ts`, `PipelineImpl`: поля `unresolvedUnit` и
      `hasFinals` вычисляются в конструкторе; `execute` бросает по полю
- [x] 4.2 `execute`: счётчик активированных слоёв вместо массива, обход
      ответной фазы и `.finally` по индексу с конца; `.finally` не
      вызывается при `hasFinals === false`
- [x] 4.3 Спеки `@nestling/pipeline` проходят без правок
- [x] 4.4 Замер после пункта; результат в таблицу

## 5. Меньше `async`-обёрток

- [x] 5.1 `pipeline.ts`: `executeWithHandler` без `async`, возвращает
      промис `execute`
- [x] 5.2 `dispatch.ts`: `call` без `return await`
- [x] 5.3 Спеки `@nestling/pipeline`, `@nestling/transport`,
      `@nestling/transport.http`, `@nestling/ports` проходят
- [x] 5.4 Замер после пункта; результат в таблицу

## 6. Контекст в одном объекте

- [x] 6.1 `execute`: результат pre-юнита дописывается в `ctx.input`
      через `Object.assign`; ячейка создаётся на тот же объект, отдельное
      обновление после юнита убрано; неиспользуемые импорты сняты
- [x] 6.2 Спеки пайплайна и `@nestling/testing` проходят; тесты, которые
      проверяли снимок контекста, правятся с объяснением
- [x] 6.3 Замер после пункта с пайплайном из двух pre-юнитов и `.finally`
      (отдельный сервер `nestling-layers` в `servers.ts`, если нужен для
      замера) и без него; результат в таблицу

## 7. Документация и запись

- [x] 7.1 `docs/decisions/ideas.md`: запись [2026-09-05] «Горячий путь:
      что убрано и что осталось» с таблицей по пунктам (req/s до и после,
      отношение к Fastify), отвергнутыми вариантами и списком того, что
      не трогали
- [x] 7.2 `scripts/bench/README.md`: числа в разделе «Почему Nestling
      медленнее Fastify» и список оставшихся причин
- [x] 7.3 `docs/decisions/roadmap.md`: строка 38 `hot-path-trim`
- [x] 7.4 Линтер `docs-style` по изменённым текстам — 0 запрещённых слов

## 8. Проверка

- [x] 8.1 `yarn verify` зелёный под Node 24
- [x] 8.2 `yarn docs:audit` — 0 ERROR

## 9. Definition of Done

- [x] 9.1 Все задачи выше отмечены
- [x] 9.2 `yarn verify` зелёный (build + typecheck + lint + test +
      type-budget)
- [x] 9.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 9.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [x] 9.5 `yarn docs:audit` — 0 ERROR
- [x] 9.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены
      с обновлённой датой в плашке «сверено с кодом» (change примеров не
      касается)
- [x] 9.7 Линтер стиля по изменённым текстам — 0 запрещённых слов
- [ ] 9.8 Коммиты осмысленные, ветка запушена
