# Задачи: пробы

## 1. Контейнер: `health` у ресурса

- [ ] 1.1 Добавить поле `health?: (value, signal) => Promise<HealthStatus>` в
  `ResourceProviderDefinition` и в словарь `resourceProvider`; тип статуса
  объявить локально (контейнер не зависит от `@nestling/app`)
- [ ] 1.2 Переносить метод `health` прототипа класса-ресурса в поле
  определения провайдера тем же приёмом, каким переносится `release`
  (`classProvider`, ветка роли `resource`)
- [ ] 1.3 Добавить читающий метод `ContainerBuilder.healthResources()`:
  перечень `{ token, id }` провайдеров-ресурсов с `health`
- [ ] 1.4 Спеки: метод класса, поле функциональной формы, ресурс без
  `health`, ветка `when` в `providers:` (перечень видит раскрытую ветку)

## 2. Ядро: семейство, узел, секция

- [ ] 2.1 `src/health/tokens.ts`: семейство `HealthCheck$` и DI-токен `Health$`
- [ ] 2.2 `src/health/interface.ts`: `HealthStatus`, `HealthCheck`,
  `HealthCheckResult`, `HealthReport`, `ReadinessStatus`
- [ ] 2.3 `src/health/config.ts`: секция `nestlingHealth` с
  `NESTLING_HEALTH_TIMEOUT` и `NESTLING_HEALTH_CACHE`, схемы целых с
  умолчаниями, экспорт `healthConfigKeys`
- [ ] 2.4 `src/health/node.ts`: реализация узла — `liveness()`,
  `readiness(signal)`, параллельный прогон с таймаутом, кэш исходов,
  один прогон на всех, запись оригинала в `Logger$('nestling:health')`
- [ ] 2.5 `src/health/kernel.ts`: `healthKernel({ phase })` — провайдер
  `Health$` и члены-вклады ресурсов из `builder.healthResources()`
- [ ] 2.6 `src/health/index.ts` и `src/index.ts`: публичные DI-токены, типы и
  `healthConfigKeys`; реализация и DI-токен секции остаются приватными

## 3. Ядро: фаза приложения

- [ ] 3.1 Тип `AppPhase` и приватное поле фазы в `AssembledApp`; переходы в
  `run()` (INIT → WIRE → START → RUN) и в `close()` (SHUTDOWN)
- [ ] 3.2 Регистрация `healthKernel({ phase: () => … })` в `#assemble` рядом с
  остальными kernel-модулями; вклады ресурсов регистрируются после модулей
- [ ] 3.3 Тестовый шов (`wireApp`) сообщает фазу `'RUN'`
- [ ] 3.4 Спеки ядра: итог по фазе и критичности, пустое семейство, кэш,
  таймаут, один прогон на всех, отчёт без деталей ошибки, вклад ресурса

## 4. HTTP-транспорт: плагин проб

- [ ] 4.1 `src/probes.ts`: `httpProbes({ liveness, readiness })` — два
  `httpEndpoint` без пайплайна, с `detached` и `doc.hidden`, хендлеры
  `@Handler([Health$])`
- [ ] 4.2 Отказ `NotReady = makeFail('service_unavailable:not_ready')` в
  `errors:` декларации `readyz`; `details` — отчёт
- [ ] 4.3 Экспорт из `src/index.ts`
- [ ] 4.4 Спеки: коды 200 и 503, тело отчёта, свои пути, отсутствие в
  документе OpenAPI, независимость liveness от итога readiness

## 5. Примеры

- [ ] 5.1 `examples/app-with-http`: удалить `features/ops/health.endpoint.ts`,
  убрать `Health` из фичи `ops`, подключить `httpProbes()` в корне
- [ ] 5.2 `examples/container`: удалить учебное семейство
  `src/health/registry.ts`, перевести `DatabaseHealthCheck` и `ApiHealthCheck`
  на `HealthCheck$`, заменить `HealthService` чтением `Health$` в демонстрации
- [ ] 5.3 Прогнать оба примера (`start:dev`) и сверить вывод, который цитируют
  главы гайда

## 6. Документация

- [ ] 6.1 README `@nestling/app`: раздел про пробы, таблицы экспортов и
  kernel-секций
- [ ] 6.2 README `@nestling/container`: `health` у ресурса и
  `healthResources()`; пример семейства `.all` без имени `HealthCheck`
- [ ] 6.3 README `@nestling/transport.http`: `httpProbes()` в перечне
  экспортов и в разделе границы пакета
- [ ] 6.4 README `@nestling/testing`: фаза `'RUN'` в тестовом прогоне
- [ ] 6.5 Гайд: глава 22 (`.all` на ядерном семействе), глава 24 (пробы
  плагином вместо endpoint'а `Health`), упоминания в главах 9 и 10
- [ ] 6.6 `docs/glossary.md` — сверить статью «Пробы» с реализацией
- [ ] 6.7 Сверить `design/composition.md` §6, `design/transports.md` §4.3 и
  `design/container.md` с кодом; расхождения — в код или в дизайн-док

## 7. Definition of Done

- [ ] 7.1 Все задачи выше отмечены
- [ ] 7.2 `yarn verify` зелёный (build, typecheck, lint, test, type-budget)
- [ ] 7.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 7.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [ ] 7.5 `yarn docs:audit` — 0 ERROR
- [ ] 7.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с
  обновлённой датой в плашке «сверено с кодом»
- [ ] 7.7 Коммиты осмысленные, ветка запушена
