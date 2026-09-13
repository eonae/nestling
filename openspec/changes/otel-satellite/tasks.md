## 1. Каркас пакета

- [ ] 1.1 `packages/nestling.otel`: манифест по образцу `nestling.mcp`
  (`exports`, `files`, скрипты, блок `nx`), `LICENSE`, `tsconfig.json`,
  `tsconfig.build.json`, `eslint.config.js`, `jest.config.js`
- [ ] 1.2 Зависимости: `@opentelemetry/api`, `sdk-metrics`,
  `exporter-prometheus`, `sdk-trace-base`, `resources`,
  `semantic-conventions`; внутренние `app`, `container`, `transport.http`;
  в `devDependencies` — `testing` и `exporter-trace-otlp-http` для спек
- [ ] 1.3 `yarn install`, пакет виден соседям, пустой `yarn build` и
  `yarn typecheck` зелёные
- [ ] 1.4 `src/index.ts` — барель поимённым экспортом; `src/boundary.spec.ts`
  по образцу `nestling.mcp`

## 2. Метрики поверх OTel SDK

- [ ] 2.1 `src/options.ts`: `OtelOptions` и `Otel` — типы и JSDoc
- [ ] 2.2 `src/provider.ts`: `MeterProvider` с ресурсом `service.name` и
  `service.version`, `PrometheusExporter({ preventServerStart: true })`
  читалкой, читалки из опции `readers`
- [ ] 2.3 `src/metrics.ts`: реализация `Metrics` — кэш инструментов по имени,
  `Counter` на `counter`, `Histogram` на `histogram`, атрибуты без
  переименования
- [ ] 2.4 `src/metrics.spec.ts`: запись ядра попадает точкой инструмента;
  вторая запись не создаёт второго инструмента; область токена семейства
  сохраняется атрибутом `scope`

## 3. Экспозиция и плагин

- [ ] 3.1 `src/exposition.ts`: `collect()` читалки и `PrometheusSerializer` в
  текст
- [ ] 3.2 `src/plugin.ts`: `makePlugin` с endpoint'ом по `path` (умолчание
  `/metrics`), `output: 'text'`, `detached` с причиной; хендлер читает
  провайдер DI-токеном пакета
- [ ] 3.3 `src/flush.ts`: `@Resource`, чьё освобождение зовёт `forceFlush()` и
  `shutdown()` у провайдера метрик и экспортёра участков; ошибка сброса
  уходит в логгер и не срывает остановку
- [ ] 3.4 `src/exposition.spec.ts`: текст формата Prometheus со строками
  `nestling_requests`; свой `path` отвечает, `/metrics` даёт `404`; второго
  сокета в процессе нет
- [ ] 3.5 `src/flush.spec.ts`: остановка приложения вызывает сброс; отказ
  сброса не срывает остановку

## 4. Участки трассы

- [ ] 4.1 `src/span.ts`: переменная `Span`, тип `OtelSpan` с `setAttribute` и
  `addEvent`; метода закрытия наружу нет
- [ ] 4.2 `src/readable.ts`: сборка значения формы `ReadableSpan` из
  `TraceContext`, метаданных endpoint'а и часов слоя; отображение исхода в
  статус по таблице D3 дизайна
- [ ] 4.3 `src/layer.ts`: слой `makePipeline<{ trace: TraceContext }>()` с
  pre-шагом `Span.provide(…)` и `.finally`-шагом отправки; без опции `traces`
  слой работает и не отправляет ничего
- [ ] 4.4 `src/otel.ts`: вход `otel(options)`, связывающий провайдер, слой и
  плагин одним значением
- [ ] 4.5 `src/span.type-test.ts`: композиция слоя без `withTracing()` не
  компилируется, с ним — компилируется
- [ ] 4.6 `src/span.spec.ts`: идентификаторы участка равны значениям `Trace`,
  родитель равен `parentSpanId`, имя — шаблон маршрута, адрес запроса в имя
  не попадает
- [ ] 4.7 `src/span.outcome.spec.ts`: четыре исхода дают статусы по таблице,
  `disconnected` не красится в `ERROR`
- [ ] 4.8 `src/span.stream.spec.ts`: у потокового ответа участок уходит после
  закрытия итератора, длительность покрывает доставку
- [ ] 4.9 `src/span.policy.spec.ts`: `everyEndpoint().hasVar(Span)` отклоняет
  сборку без слоя с паттерном и модулем в сообщении; `detached` снимает
  проверку
- [ ] 4.10 `src/span.enrich.spec.ts`: `Ctx(Span)` даёт дописать атрибут; вне
  запроса читалка возвращает `undefined`
- [ ] 4.11 Открытый вопрос 1 дизайна: решить, чем доказывается совместимость
  экспорта, и закрыть его в `design.md`
- [ ] 4.12 Открытый вопрос 2 дизайна: оставить ли поле `readers` без
  потребителя; решение записать в `design.md`
- [ ] 4.13 Открытый вопрос 3 дизайна: имя `service` против `serviceName`;
  решение записать в `design.md`

## 5. Приложение в двух процессах

- [ ] 5.1 `src/app.integration.spec.ts`: приложение с сателлитом, запрос
  проходит, экспозиция отдаёт числа, подставной `SpanExporter` получает
  участок
- [ ] 5.2 Там же: два приложения с трассой по сети — участки несут один
  `traceId`, родитель второго равен `spanId` первого

## 6. Примеры

- [ ] 6.1 `examples/microservice`: `src/metrics.ts` удалён, `src/app.ts`
  переведён на `otel({ service: 'microservice' })`
- [ ] 6.2 `examples/microservice/src/observability.ts`: слой композирован с
  `telemetry.spans`; в `policies:` добавлен `hasVar(Span)`
- [ ] 6.3 `examples/modular-app`: `src/metrics.ts` удалён, `src/app.ts` и
  `src/base.ts` переведены на сателлит, политика добавлена
- [ ] 6.4 `examples/modular-app/src/metrics.spec.ts` переписан против
  сателлита: экспозиция и участок подставным `SpanExporter`
- [ ] 6.5 Имён `MetricsExporter`, `MetricsExporter$`, `prometheusExporter` и
  `metricsPlugin` в `examples/` не осталось (grep пустой)
- [ ] 6.6 README обоих примеров: строка про телеметрию сателлитом
- [ ] 6.7 `yarn verify` зелёный по обоим примерам

## 7. Документация

- [ ] 7.1 `docs/guide/22-metrics.md` и английская пара: раздел «Адаптер и
  endpoint `/metrics`» переписан на сателлит; плашка «сверено с кодом» с новой
  датой и коммитом
- [ ] 7.2 Новая глава `docs/guide/23-tracing.md` и пара
  `docs/en/guide/23-tracing.md`: слой, политика `hasVar(Span)`, `Ctx(Span)`,
  просмотр дерева в Jaeger
- [ ] 7.3 Оглавления `docs/guide/README.md` и `docs/en/guide/README.md`:
  строка главы 23
- [ ] 7.4 `docs/design/container.md` и пара, раздел «Метрики ядра»: последний
  пункт называет сателлит; про экспорт участков — строка рядом
- [ ] 7.5 README пакета: `packages/nestling.otel/README.md` и `README.ru.md`
  с плашкой статуса и разделами по шаблону
- [ ] 7.6 `docs/README.md`: строка `@nestlingjs/otel` в таблице пакетов
- [ ] 7.7 `docs/compatibility.md` и пара: строка про экспорт телеметрии
- [ ] 7.8 `docs/glossary.md` и пара: термин «участок трассы» уже есть —
  сверить формулировку с реализацией
- [ ] 7.9 `node .claude/skills/docs-style/scripts/lint.mjs` на все изменённые
  тексты — 0 запрещённых слов

## 8. Роадмап и журнал решений

- [ ] 8.1 `docs/decisions/roadmap.md`: строка 85 переведена в **done** со
  ссылкой на архив и новые спеки
- [ ] 8.2 Запись `ideas.md` [2026-09-12] «Разбор обзоров d/10 и d/13»
  получает пометку «РЕАЛИЗОВАНО» по пункту 2 в части сателлита; запись
  [2026-09-13] «Разбор фидбэка по коду d/15» — по пункту 1
- [ ] 8.3 Оглавление `ideas.md` обновлено
  (`node .claude/skills/docs-audit/scripts/ideas-toc.mjs`)
- [ ] 8.4 Если участок на вызов порта решено делать позже — строка в
  `deferred.md` с причиной и условием возврата из решения D5

## 9. Definition of Done

- [ ] 9.1 Все задачи выше отмечены
- [ ] 9.2 `yarn verify` зелёный
- [ ] 9.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 9.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [ ] 9.5 Записи `ideas.md`, по которым шёл change, несут пометку
  «РЕАЛИЗОВАНО» с тем, что вышло целиком, что уехало дальше и чем реализация
  уточнила решение
- [ ] 9.6 `yarn docs:audit` — 0 ERROR
- [ ] 9.7 Затронутые `examples/*` мигрированы, главы гайда пересверены с
  обновлённой датой в плашке «сверено с кодом»
- [ ] 9.8 `main` не тронут: слияние делает Merger после `/opsx:archive`
