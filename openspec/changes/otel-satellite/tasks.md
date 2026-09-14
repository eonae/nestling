> **Change идёт после `declared-metrics`.** Сателлит читает `MetricsStore$`
> и его снимок, а экспозицию Prometheus не трогает: и то, и другое приходит
> с тем change'ем. Пока он не в `main`, разделы 2, 4 и 5 не на чем собирать;
> разделы 1 и 3 от него не зависят.
>
> Что ведёт `declared-metrics`, чтобы не делать дважды: главу 22 гайда,
> раздел «Метрики ядра» в `docs/design/container.md`, сужение строки 85
> roadmap, строку `@nestlingjs/prometheus` в таблице пакетов и метрическую
> половину дельты `example-apps`.

## 1. Каркас пакета

- [x] 1.1 `packages/nestling.otel`: манифест по образцу `nestling.prometheus`
  (`exports`, `files`, скрипты, блок `nx`), `LICENSE`, `tsconfig.json`,
  `tsconfig.build.json`, `eslint.config.js`, `jest.config.js`
- [x] 1.2 Зависимости: `@opentelemetry/api`, `sdk-trace-base`,
  `sdk-metrics`, `resources`, `semantic-conventions`; внутренние `app` и
  `container`. Ни `transport.http`, ни `exporter-prometheus`: своего
  endpoint'а у пакета нет. В `devDependencies` — `testing`,
  `exporter-trace-otlp-http` и `exporter-metrics-otlp-http` для спек
- [x] 1.3 `yarn install`, пакет виден соседям, пустой `yarn build` и
  `yarn typecheck` зелёные
- [x] 1.4 `src/index.ts` — барель поимённым экспортом; `src/boundary.spec.ts`
  по образцу `nestling.prometheus`

## 2. Метрики по OTLP поверх store

- [x] 2.1 `src/options.ts`: `OtelOptions` и `Otel` — типы и JSDoc
- [x] 2.2 `src/resource.ts`: атрибуты ресурса `service.name` и
  `service.version`, общие для трасс и метрик
- [x] 2.3 `src/points.ts`: перевод `MetricsSnapshot` в `ResourceMetrics` —
  счётчик суммой, гистограмма `count`, `sum` и корзинами ряда; `help` и
  `unit` из ряда; привязка кумулятивная
- [x] 2.4 `src/push.ts`: `@Resource` с зависимостью от `MetricsStore$` —
  таймер на `intervalMs`, `snapshot()` и отправка `PushMetricExporter`;
  без опции `metrics` ресурс не подписывается и таймера не заводит
- [x] 2.5 `src/points.spec.ts`: корзины точки совпадают с объявленными
  границами; `unit` и `help` доходят; ряды видны до первой записи
- [x] 2.6 `src/push.spec.ts`: интервал отправляет снимок; инструментов SDK
  не создаётся; без `metrics` вызовов экспортёра нет

## 3. Участки трассы

- [x] 3.1 `src/span.ts`: переменная `Span`, тип `OtelSpan` с `setAttribute` и
  `addEvent`; метода закрытия наружу нет
- [x] 3.2 `src/readable.ts`: сборка значения формы `ReadableSpan` из
  `TraceContext`, метаданных endpoint'а и часов слоя; отображение исхода в
  статус по таблице D3 дизайна
- [x] 3.3 `src/layer.ts`: слой `makePipeline<{ trace: TraceContext }>()` с
  pre-шагом `Span.provide(…)` и `.finally`-шагом отправки; без опции `traces`
  слой работает и не отправляет ничего
- [x] 3.4 `src/otel.ts`: вход `otel(options)`, связывающий слой, плагин,
  экспортёров и ресурс одним значением
- [x] 3.5 `src/span.type-test.ts`: композиция слоя без `withTracing()` не
  компилируется, с ним — компилируется
- [x] 3.6 `src/span.spec.ts`: идентификаторы участка равны значениям `Trace`,
  родитель равен `parentSpanId`, имя — шаблон маршрута, адрес запроса в имя
  не попадает
- [x] 3.7 `src/span.outcome.spec.ts`: четыре исхода дают статусы по таблице,
  `disconnected` не красится в `ERROR`
- [x] 3.8 `src/span.stream.spec.ts`: у потокового ответа участок уходит после
  закрытия итератора, длительность покрывает доставку
- [x] 3.9 `src/span.policy.spec.ts`: `everyEndpoint().hasVar(Span)` отклоняет
  сборку без слоя с паттерном и модулем в сообщении; `detached` снимает
  проверку
- [x] 3.10 `src/span.enrich.spec.ts`: `Ctx(Span)` даёт дописать атрибут; вне
  запроса читалка возвращает `undefined`

## 4. Остановка и два процесса

- [x] 4.1 `src/shutdown.spec.ts`: освобождение ресурса снимает таймер,
  отправляет последний снимок и закрывает экспортёров; отказ отправки уходит
  в логгер и не срывает остановку
- [x] 4.2 `src/app.integration.spec.ts`: приложение с сателлитом — запрос
  проходит, подставной `SpanExporter` получает участок, подставной
  `PushMetricExporter` получает точки
- [x] 4.3 Там же: две картины совпадают — корзины точки OTLP равны корзинам
  строк `@nestlingjs/prometheus` на одном и том же store
- [x] 4.4 Там же: два приложения с трассой по сети — участки несут один
  `traceId`, родитель второго равен `spanId` первого
- [x] 4.5 Открытый вопрос 1 дизайна: чем доказывается совместимость
  экспорта; решение записать в `design.md`
- [x] 4.6 Открытый вопрос 2 дизайна: имя `service` против `serviceName`;
  решение записать в `design.md`

## 5. Примеры

Экспозиция там уже подключена пакетом формата — этот change её не трогает.

- [x] 5.1 `examples/microservice/src/observability.ts`: слой композирован с
  `telemetry.spans`; `src/app.ts` получает `otel(…)` и `hasVar(Span)` в
  `policies:`
- [x] 5.2 `examples/modular-app/src/base.ts`: то же, слой в обоих процессах
- [x] 5.3 Спека примера: участок, полученный подставным `SpanExporter`, и
  общий `traceId` у двух процессов
- [x] 5.4 Своего `.finally`-шага с отправкой участка в `examples/` не
  осталось (grep пустой)
- [x] 5.5 README обоих примеров: строка про экспорт трассы
- [x] 5.6 `yarn verify` зелёный по обоим примерам

## 6. Документация

- [x] 6.1 Новая глава `docs/guide/23-tracing.md` и пара
  `docs/en/guide/23-tracing.md`: слой, политика `hasVar(Span)`, `Ctx(Span)`,
  просмотр дерева в Jaeger
- [x] 6.2 Оглавления `docs/guide/README.md` и `docs/en/guide/README.md`:
  строка главы 23
- [x] 6.3 `docs/guide/22-metrics.md` и пара: абзац про push по OTLP рядом с
  экспозицией. Саму главу ведёт `declared-metrics` — дописывать поверх
  результата, а не переписывать; плашка «сверено с кодом» с новой датой
- [x] 6.4 `docs/design/container.md` и пара: строка про экспорт участков
  рядом с разделом «Метрики ядра»
- [x] 6.5 README пакета: `packages/nestling.otel/README.md` и `README.ru.md`
  с плашкой статуса и разделами по шаблону
- [x] 6.6 `docs/README.md`: строка `@nestlingjs/otel` в таблице пакетов
- [x] 6.7 `docs/compatibility.md` и пара: строка про экспорт телеметрии
- [x] 6.8 `docs/glossary.md` и пара: термин «участок трассы» уже есть —
  сверить формулировку с реализацией
- [x] 6.9 `node .claude/skills/docs-style/scripts/lint.mjs` на все изменённые
  тексты — 0 запрещённых слов

## 7. Роадмап и журнал решений

- [ ] 7.1 `docs/decisions/roadmap.md`: строка 85 переведена в **done** со
  ссылкой на архив и спеки. Сужение строки до трасс и push по OTLP сделал
  `declared-metrics` — дописать исход, а не сужать второй раз
- [x] 7.2 Запись `ideas.md` [2026-09-12] «Разбор обзоров d/10 и d/13»
  получает пометку «РЕАЛИЗОВАНО» по пункту 2 в части сателлита
- [x] 7.3 Оглавление `ideas.md` обновлено
  (`node .claude/skills/docs-audit/scripts/ideas-toc.mjs`)
- [x] 7.4 Если участок на вызов порта решено делать позже — строка в
  `deferred.md` с причиной и условием возврата из решения D5

## 8. Definition of Done

- [ ] 8.1 Все задачи выше отмечены
- [ ] 8.2 `yarn verify` зелёный
- [ ] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 8.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [ ] 8.5 Запись `ideas.md`, по которой шёл change, несёт пометку
  «РЕАЛИЗОВАНО» с тем, что вышло целиком, что уехало дальше и чем реализация
  уточнила решение
- [ ] 8.6 `yarn docs:audit` — 0 ERROR
- [ ] 8.7 Затронутые `examples/*` мигрированы, главы гайда пересверены с
  обновлённой датой в плашке «сверено с кодом»
- [ ] 8.8 `main` не тронут: слияние делает Merger после `/opsx:archive`
