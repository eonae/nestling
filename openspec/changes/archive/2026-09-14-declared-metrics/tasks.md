## 1. Объявление метрик и каталог

- [x] 1.1 `packages/nestling.app/src/metrics/declaration.ts`: `makeMetrics`,
  конструкторы `counter` и `histogram`, пометка `open`, типы группы и
  писателя (`MetricsGroup`, `MetricsOf`)
- [x] 1.2 Проверки создания группы: пустой префикс, пустой ключ,
  неупорядоченные границы корзин — ошибки с текстом, называющим метрику
- [x] 1.3 `declaration.type-test.ts`: значение вне перечня, лишний ключ
  атрибута и отсутствующий член группы не компилируются
- [x] 1.4 `metrics/catalog.ts`: сборка каталога из вкладов, полное имя,
  ряды как произведение перечней, индекс ряда, отказ на совпадение имён
- [x] 1.5 Поле `metrics:` в декларациях фичи, модуля и плагина
  (`root/feature.ts`, `root/plan.ts`, типы деклараций)
- [x] 1.6 Группа как DI-токен: рецепт писателя, отказ сборки «группа
  запрошена, но не подключена вкладом `metrics:`»
- [x] 1.7 `catalog.spec.ts`: каталог выбранного состава, выпадение групп
  невыбранной фичи и невыбранной ветки переключателя, совпадение имён

## 2. Store

- [x] 2.1 `metrics/store.ts`: плоское хранилище рядов по индексам, словарь
  рядов открытых атрибутов, агрегат гистограммы (счётчик, сумма, корзины)
- [x] 2.2 `snapshot()`: согласованный снимок с каталожными полями метрики
- [x] 2.3 Выход store один — `snapshot()`. Поток записей (`tap(sink)`,
  `MetricSink`) написан и снят по ходу change'а: push по OTLP собирает
  точки из снимка, и выход остался бы без потребителя (D7, deferred.md)
- [x] 2.4 `MetricAttributes` и типы снимка в барели пакета; интерфейс
  `Metrics` удалён
- [x] 2.5 `MetricsStore$` — узел графа kernel-модулем, ошибка дубля на
  провайдер приложения под ним
- [x] 2.6 `store.spec.ts`: нули до записи, ряд открытого атрибута по факту
  записи, снимок не меняется задним числом

## 3. Ядро переходит на декларации

- [x] 3.1 `metrics/kernel-group.ts`: группа `nestling` с четырьмя метриками;
  `metrics/names.ts` удалён
- [x] 3.2 Перечни `transport`, `pattern` и `operation` вычисляются из
  деклараций сборки и топологии операций
- [x] 3.3 `pipeline/core/pipeline.ts`: `recordRequest` и `settle` пишут
  членами группы ядра; поле писателя в `ExecuteOptions` обязательно
- [x] 3.4 `transport/dispatch.ts`: `MakeDispatchOptions` принимает писателя
  рядом с `logger`, условные ветки `...(metrics === undefined ? {} : …)`
  сняты
- [x] 3.5 `ports/observe.ts` и `ports/kernel.ts`: обёртка вызывателя ставится
  всегда, запись идёт членами группы ядра
- [x] 3.6 `root/app.ts`: регистрация store и группы ядра; `#registerRootMetrics`,
  опция `metrics` в `AppSpec`, `RootMetrics$`, `Metrics$`, `noopMetrics` и
  `configuredMetrics` удалены
- [x] 3.7 `metrics/index.ts` и барель пакета: поимённый экспорт нового
  состава
- [x] 3.8 `pipeline.metrics.spec.ts` и `ports/kernel.spec.ts` переписаны на
  чтение store; спека `root/metrics.spec.ts` заменена спекой каталога и
  группы ядра
- [x] 3.9 Ряды ядра есть в снимке до первого запроса — спека на пустом
  приложении с endpoint'ами и портами

## 4. Тестовый пакет

- [x] 4.1 `packages/nestling.testing/src/metrics.ts`: `spyMetrics()` удалён,
  появляется чтение снимка тестового приложения и адресация ряда членом
  группы с атрибутами
- [x] 4.2 Шов тестового корня отдаёт store; подмена `[RootMetrics$, …]`
  удалена из `test-composition-root`
- [x] 4.3 `metrics.spec.ts` пакета переписана; README пакета обновлён

## 5. Пакет `@nestlingjs/prometheus`

- [x] 5.1 `packages/nestling.prometheus`: манифест по образцу
  `nestling.mcp`, `LICENSE`, `tsconfig.json`, `tsconfig.build.json`,
  `eslint.config.js`, `jest.config.js`
- [x] 5.2 `yarn install`, пакет виден соседям, пустые `yarn build` и
  `yarn typecheck` зелёные
- [x] 5.3 `src/serialize.ts`: имя ряда, метки в устойчивом порядке, `# HELP`
  и `# TYPE`, корзины `_bucket`, `_sum` и `_count`
- [x] 5.4 `src/plugin.ts`: `makePrometheus(options?)`, endpoint `output: 'text'`
  с пометкой `detached`, чтение `MetricsStore$`
- [x] 5.5 `src/index.ts` — барель поимённым экспортом; `boundary.spec.ts` по
  образцу `nestling.mcp`
- [x] 5.6 Спеки пакета: нули до трафика, описание метрики в экспозиции,
  гистограмма корзинами, отсутствие пути в документе OpenAPI

## 6. Примеры

- [x] 6.1 `examples/microservice`: `src/metrics.ts` удалён, группа метрик
  примера объявлена, `makePrometheus()` в `plugins:`, `src/app.ts` обновлён
- [x] 6.2 `examples/modular-app`: то же плюс переписанная `src/metrics.spec.ts`
  против store и экспозиции
- [x] 6.3 Имён `MetricsExporter`, `MetricsExporter$`, `prometheusExporter` и
  `metricsPlugin` в `examples/` не осталось
- [ ] 6.4 `e2e` примеров проходят; экспозиция свежеподнятого примера
  содержит нулевые ряды — нулевые ряды проверены спекой `modular-app`,
  сами `e2e` пропущены: docker в этой среде недоступен, база не поднята

## 7. Документация

- [x] 7.1 `docs/guide/22-metrics.md` и английская пара переписаны:
  объявление группы, писатель из графа, каталог, нули, экспозиция пакетом
- [x] 7.2 `docs/design/container.md` раздел «Метрики ядра» и пара: каталог,
  store, два выхода, отсутствие опции корня
- [x] 7.3 `docs/design/pipeline.md` §2 и пара: запись рантайма без условия
  «метрики настроены»
- [x] 7.4 `docs/design/operations.md` §2.3 и пара: обёртка вызывателя всегда
- [x] 7.5 `docs/README.md`: строка `@nestlingjs/prometheus` в таблице пакетов
- [x] 7.6 `docs/compatibility.md` и пара: строка про экспозицию метрик
- [x] 7.7 `docs/glossary.md` и пара: термины «группа метрик», «ряд», «каталог
  метрик»
- [x] 7.8 README `@nestlingjs/app`, `@nestlingjs/testing` и нового пакета —
  на двух языках, с плашками статуса
- [x] 7.9 `node .claude/skills/docs-style/scripts/lint.mjs` на все изменённые
  тексты — 0 запрещённых слов

## 8. Роадмап и журнал решений

- [x] 8.1 `docs/decisions/roadmap.md`: строка 85 `otel-satellite` сужена до
  трасс и push по OTLP из снимка. Строка на этот change готова в
  `roadmap-row.md` и вставляется на `/opsx:archive`: до архива ссылки на
  него и на влитые спеки битые, и `docs:audit` ловит их как ERROR
- [x] 8.2 Запись `ideas.md` о декларативных метриках получает пометку
  «РЕАЛИЗОВАНО» с тем, что вышло целиком и чем реализация уточнила решение
- [x] 8.3 Оглавление `ideas.md` обновлено
  (`node .claude/skills/docs-audit/scripts/ideas-toc.mjs`)
- [x] 8.4 Отложенное записано в `deferred.md` с причиной и условием
  возврата: `gauge`, политика на каталог, перечень значений из конфига
- [x] 8.5 Сессии `change/otel-satellite` сообщено, что метрическая часть
  перевыпускается: опция корня снята, экспозиция живёт в отдельном пакете

## 9. Definition of Done

- [x] 9.1 Все задачи выше отмечены, кроме 6.4: `e2e` примеров требуют
  PostgreSQL, а docker в этой среде недоступен
- [x] 9.2 `yarn verify:fresh` зелёный по всем 27 проектам. Отставший
  `@nestlingjs/schema.zod:test` (пятый порог `silent`) починен в `main`
  и приехал сюда ребейзом
- [x] 9.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 9.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [x] 9.5 Записи `ideas.md`, по которым шёл change, несут пометку
  «РЕАЛИЗОВАНО» с тем, что вышло целиком, что уехало дальше и чем реализация
  уточнила решение
- [x] 9.6 `yarn docs:audit` — 0 ERROR
- [x] 9.7 Затронутые `examples/*` мигрированы, глава 22 и её пара
  пересверены; точки сверки остальных глав доливает Merger после
  merge-коммита
- [x] 9.8 `main` не тронут: слияние делает Merger после `/opsx:archive`
