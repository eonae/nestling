# Roadmap доработок до целевого состояния

План работ по приведению кода к целевому дизайну из [ideas.md](./ideas.md).
Каждая строка — отдельный OpenSpec change (`openspec/changes/<имя>/`);
статус обновляется по ходу (это живой документ, в отличие от append-only
журнала решений).

Составлен 2026-07-06 по итогам аудита и серии архитектурных сессий;
дополнен 2026-07-08 (changes 8–13) по сессии модульного монолита —
логика в [discussions/05](../history/discussions/05-modular-monolith-features-ports.md);
14–18 добавлены 2026-07-10, 19–20 — 2026-07-13 по записям в [ideas.md](./ideas.md);
21–22 — 2026-07-13 по дизайну типизированных клиентов
([d/07](../history/discussions/07-typed-clients.md));
23–27 — 2026-07-13 по итогам критического ревью, пп. 5–7
([d/06](../history/discussions/06-critical-design-review.md)); 24
(`endpoint-model`) детализирован дискуссией
[d/08](../history/discussions/08-endpoint-declarations-and-styles.md);
28 — 2026-07-14 по записи «Policy-check на собранном графе» (закрывает
d/06 П.3). Состав breaking-окна фиксации публичного API V1 закрыт:
17, 19, 21, 23, 24 ([ideas.md [2026-07-14]](./ideas.md) «Kernel 1.0»).
29 и 30 добавлены 2026-09-01 — первые change'ы после закрытия волны 6:
29 по записи [ideas.md [2026-08-29]](./ideas.md) о проверке входа рантаймом,
30 по записи [ideas.md [2026-09-01]](./ideas.md) «Модуль без `exports`».
32 добавлен 2026-09-03 по первому ревью гайда: три записи
[ideas.md [2026-09-03]](./ideas.md) («Декларация приложения», «Код отказа»,
«Поле `handler`») и [conventions.md](../conventions.md).
33–36 добавлены 2026-09-04 по ревью фреймворка
([d/09](../history/discussions/09-framework-review.md)): шесть записей
[ideas.md [2026-09-04]](./ideas.md).
37 добавлен 2026-09-05 по второму ревью
([d/10](../history/discussions/10-framework-review-2.md), профиль горячего
пути): запись [ideas.md [2026-09-05]](./ideas.md) «Сигнал отмены запроса:
реестр контроллеров вместо `AbortSignal.any`».
38 добавлен 2026-09-05 по d/10 §5.5 и бенчмарку с равными обязанностями:
второй эшелон горячего пути без потери гарантий.
39 добавлен 2026-09-05 по разбору раскладки монорепы: первый из трёх
change'ей, разделяющих публикуемые пакеты и примеры.
40 добавлен 2026-09-05 по разбору всей документации
([d/11](../history/discussions/11-docs-structure-and-site.md)): первая из пяти
волн уборки, только инфраструктура.
41 и 42 добавлены 2026-09-05 по записи
[ideas.md [2026-09-05]](./ideas.md) «Раскладка монорепы»: второй и третий
change'ы серии, начатой `examples-out`.
44–53 добавлены 2026-09-06 по ревью жизненного цикла и композиции
([d/12](../history/discussions/12-lifecycle-and-composition-review.md)):
десять записей [ideas.md [2026-09-06]](./ideas.md). Порядок: 44 и 42
первыми (термины и раскладка пакетов), затем 45 и 46 как фундамент, на
нём 49, 50 и 53; 47, 48, 51 и 52 независимы.
55–61 добавлены 2026-09-09 по сверке роадмапа с журналом: работа, которую
записи называли будущим change'ем, но строкой здесь не была. 55 — дефект
рантайма потоков из замера [2026-08-01](./ideas.md), 56 — седьмой пункт
записи [2026-07-13](./ideas.md) «Контракт первичен», 57 — четыре места
границы ядра из замера [2026-09-07](./ideas.md), 58–61 — волны 2–5 уборки
документации по записи [2026-09-05](./ideas.md) «Структура документации».
66–70 добавлены 2026-09-12 по первому внешнему прогону: агент вне
репозитория написал сервис по скиллу 0.1.3 и оставил восемнадцать
предложений ([d/14](../history/discussions/14-first-external-run.md));
пять записей [ideas.md [2026-09-12]](./ideas.md) и одна запись
[deferred.md [2026-09-12]](./deferred.md). Порядок: 66 и 67 первыми и
независимо друг от друга, 68 после них, 70 после 68; 69 независим.
71 добавлен 2026-09-12 по записи [ideas.md [2026-09-12]](./ideas.md)
«Транзакционный приём»: вторая половина гарантии outbox'а, идёт после 57.
72 добавлен 2026-09-12 на apply change'а 68: статики по HTTP-методу
вынесены из него отдельной строкой, потому что множества мест не
пересекаются — 39 против ~305. Идёт после 68.
73 добавлен 2026-09-11 по записи [ideas.md [2026-09-11]](./ideas.md)
«Соединение с базой: сателлит `drizzle.pg`»: база — первая инфраструктура
каждого сервиса, и примитивов для неё не было ни одного.

| # | Change | Суть | Размер | Статус |
|---|---|---|---|---|
| 1 | `transport-hardening` | утечка stack trace в 500-ответах, лимит body, таймауты, 400 вместо 500 для ошибок входа, дренаж `close()` | S | **done** — [архив](../../openspec/changes/archive/2026-07-07-transport-hardening/) |
| 2 | `container-fixes` | module-метаданные функциональных провайдеров, накопление lifecycle-метаданных per-instance, JSDoc `get()` | S | **done** — [архив](../../openspec/changes/archive/2026-07-07-container-fixes/) |
| 3 | `abort-signal` | `meta.signal` (AbortSignal) насквозь: транспорт (дисконнект) + App (shutdown) | S–M | **done** — [архив](../../openspec/changes/archive/2026-07-07-abort-signal/) |
| 4 | `pipeline-v2` | фазы `.pre/.ok/.catch/.after/.finally`, `makePipeline`, слои + `compose`, `TNeeds`, рантайм-тесты ядра | L, breaking | **done** — [архив](../../openspec/changes/archive/2026-07-13-pipeline-v2/) |
| 5 | `token-families` | `makeTokenFamily`, `.auto`, `familyProvider`; ~~опционально `strictExports`~~ — СУПЕРСИД 2026-09-01 (change `remove-module-exports`). **Покрывает и конфиг (`Config(key)`), и on-demand-клиенты (`GrpcClient(server)` + unbound properties)** — см. [discussions/05 §15](../history/discussions/05-modular-monolith-features-ports.md#15) | M | **done** — [архив](../../openspec/changes/archive/2026-07-29-token-families/) |
| 6 | `streaming-v2` | `stream` ≠ `events`, item-цепочки на io-декларации, `Topic`, `summary`, SSE; io-декларация как дерево форм (`value`/`stream`/`events`/`multipart` + `upload()`, листья — Standard Schema), поэлементная валидация; capability-валидация биндинга: формы контракта vs способности транспорта, fail-fast на ASSEMBLE | L | **done** — [архив](../../openspec/changes/archive/2026-07-31-streaming-v2/), [ideas.md [2026-07-06]](./ideas.md), новый пакет `@nestling/streams` (влит в [`@nestling/operations`](../../packages/nestling.operations/) change'ем `package-consolidation`) |
| 7 | `subscriptions-registry` | пакет реестра подписок поверх signal + finish-хуков (dogfooding публичных примитивов): слой `tracked` из двух класс-юнитов, `meta.subscription.signal` = `AbortSignal.any(запрос, админский)`, `CloseReason = Outcome \| 'killed'`, лента на `Topic`, факты `event`-контрактами (opt-in), параметризованный модуль; ядро не тронуто ни строкой | M | **done** — [архив](../../openspec/changes/archive/2026-08-01-subscriptions-registry/), новый пакет [`@nestling/subscriptions`](../../packages/nestling.subscriptions/), [гайд](../history/superseded/guides/subscriptions.md), отчёт о замере [ideas.md [2026-08-01]](./ideas.md) |
| 8 | `endpoint-discovery` | эндпоинты и транспорты — дискавери из дерева зарегистрированных модулей вместо глобального registry (чинит протечку глобального `Set` при любом импорте). Предпосылка фич | S | **done** — [архив](../../openspec/changes/archive/2026-07-29-endpoint-discovery/), [d/05 §1](../history/discussions/05-modular-monolith-features-ports.md) |
| 9 | `config-module` | `makeConfig('prefix', schema)` + `from`; источники = объекты `ConfigSource` в одной приватной читалке (env — база, координаты из примордиального env); приватность = keys-capability (токен секции не экспортируется, наружу — branded-хэндл `.keys`; без `configs:`-регистрации и build()-проверки владения); привязка в корне плоским списком `config: [[src, keys \| glob]]`; reloadable (`Topic`/`AbortSignal`, живой хэндл); on-demand/unbound + доки из реестра (тег фичи из графа + флаг). Поверх `token-families` (5) | M–L | **done** — [архив](../../openspec/changes/archive/2026-07-31-config-module/), новый пакет `@nestling/config` (влит в [`@nestling/app`](../../packages/nestling.app/) change'ем `package-consolidation`), [d/05 §11,§15](../history/discussions/05-modular-monolith-features-ports.md), ревизия владения [ideas.md [2026-07-10]](./ideas.md), форма секции — рекорд полей [ideas.md [2026-07-14]](./ideas.md) |
| 10 | `features` | `makeFeature`/`select`/`assemble`; `@OnStart`/go-live (гарантия `dispatch`: `serve(dispatch, signal)` вместо `listen()`); транспорты как провайдеры; capability = DI + fail-fast | L | **done** — [архив](../../openspec/changes/archive/2026-07-31-features/), [`@nestling/app`](../../packages/nestling.app/), [d/05 §2,§7–§10](../history/discussions/05-modular-monolith-features-ports.md) |
| 11 | `ports` | `makeContract` (request/command/event), `Port`/`Emitter`, `IMessageBus`, `InProcessBus`, dispatch-policy; local/remote-биндинг на сборке (co-located, L3) | L | **done** — [архив](../../openspec/changes/archive/2026-07-31-ports/), новый пакет `@nestling/ports` (влит в [`@nestling/app`](../../packages/nestling.app/) change'ем `package-consolidation`), [гайд](../history/superseded/guides/ports.md), [ideas.md [2026-07-31]](./ideas.md), [d/05 §3](../history/discussions/05-modular-monolith-features-ports.md) |
| 12 | `transport.nats` | NATS как inbound+outbound транспорт; queue-groups для реплик; remote-биндинг портов; JetStream для `durable` (split, L4) | M | **done** — [архив](../../openspec/changes/archive/2026-07-31-transport-nats/), новый пакет [`@nestling/transport.nats`](../../packages/nestling.transport.nats/), пример [`split-nats`](../../examples/split-nats/), [ideas.md [2026-07-31] «NATS: шина приложения»](./ideas.md), [d/05 §3](../history/discussions/05-modular-monolith-features-ports.md) |
| 13 | `plugins` | cross-cutting: инфра = параметризованные модули (конвенция, нового примитива нет); `plugins:` в корне не будет — перечень полей `assemble` закрыт; идентичность модуля — значение, одноимённые разные значения — ошибка сборки; pipeline-слои + policy-check вместо ambient middleware; feature-scoped инфра едет с фичей | S | **done** — [архив](../../openspec/changes/archive/2026-07-31-plugins/), [d/05 §16](../history/discussions/05-modular-monolith-features-ports.md) |
| 14 | `multi-injection` | `Family.all` — синтетический узел-агрегат: массив всех зарегистрированных членов семейства на `build()` (multi-injection без `multi: true`; вклады — обычные провайдеры с членскими токенами) | S | **done** — [архив](../../openspec/changes/archive/2026-07-29-multi-injection/), [ideas.md [2026-07-10]](./ideas.md) |
| 15 | `error-model` | Fail — значение (возврат ≡ бросок; фикс `normalizeResponse`: возвращённый `Fail` сейчас уезжает как `200 OK`); `Output<T>` включает `Fail`, дискриминант `isFail`; словарь статусов (`CONFLICT`, `TIMEOUT`, `TOO_MANY_REQUESTS`) + `code`/`cause`; `defineFail` (code-идентичность вместо instanceof); `errors:` в контракте endpoint'а, типизированный канал (`Output<T, E>` + бросатель `meta.fail`); граница нормализует незадекларированное в `UnknownError` → закрытый контракт `E ∪ UnknownError` | M | **done** — [архив](../../openspec/changes/archive/2026-07-31-error-model/), [ideas.md [2026-07-10]](./ideas.md) |
| 16 | `async-context` | `contextVar<T>()('key')` + писатель `Var.provide(…)` + инжектируемые ридеры `Ctx(Var)` (token family); read-only ALS-проекция накопленного `input` (+ `signal`), писатель ячейки — только рантайм пайплайна; `get()/peek()` (зеркало полный/Partial); opt-in policy-check присутствия — предикат `hasVar` на `build()`; `contextValue` в тестовом корне | M | **done** — [архив](../../openspec/changes/archive/2026-07-31-async-context/), [ideas.md [2026-07-10]](./ideas.md); `propagate` через remote-порты — вместе с 12 |
| 17 | `pipeline-drop-after` | убрать `.after` из билдера/типов/рантайма (`ResponsePhase` = `'ok' \| 'catch'`); словарь ответного тракта — Promise-тройка `ok`/`catch`/`finally`; правка спеков и доков (`docs/preview`) | S, breaking | **done** — [архив](../../openspec/changes/archive/2026-07-29-pipeline-drop-after/), [ideas.md [2026-07-10]](./ideas.md) |
| 18 | `testing-package` | `@nestling/testing`: `assembleTest` (`overrides` только в тестовом корне; подстановка на ASSEMBLE + прунинг осиротевших поддеревьев; фазы 0–3 без START → in-proc `app.call`/`app.emit` по схемам; `await using` → SHUTDOWN), `vars()` (объектный `ConfigSource` c `watch`/`set`), `stub(Contract, impl)` (фейк-порт, валидируемый схемой контракта), `familyOverride`, `.check()` (фазы 0–1, матрица `select`-топологий в CI), `testModule()`; конвенция `./testing`-subpath (conditional export) | M | **done** — ядро: [архив](../../openspec/changes/archive/2026-07-31-testing-package/); остаток (`stub(Contract, impl)`, `app.emit`, `app.stubbed`): [архив](../../openspec/changes/archive/2026-08-01-testing-stub-contract/); пакет [`@nestling/testing`](../../packages/nestling.testing/), [ideas.md [2026-07-10]](./ideas.md) |
| 19 | `standard-schema` | ядро принимает `StandardSchemaV1` вместо `z.ZodType`: `parsePayload`/`DomainType` через `~standard.validate`/`InferOutput`; `SchemaValidationError` несёт стандартные `issues` вместо `ZodError`; zod → devDependency; Promise из `validate` = ошибка | S–M, breaking | **done** — [архив](../../openspec/changes/archive/2026-07-29-standard-schema/), [ideas.md [2026-07-13]](./ideas.md) |
| 20 | `openapi` | `@nestling/openapi`: генерация OpenAPI из деклараций endpoints; конвертеры `SchemaDocConverter` — явные, по `~standard.vendor`, отдельными пакетами (`@nestling/openapi.zod`, …); boot-time проверка конвертируемости всех схем; `jsonSchema`-override; `errors:` → responses; предпосылка — bind-карта (21) | M–L | **done** — [архив](../../openspec/changes/archive/2026-08-01-openapi/), новые пакеты [`@nestling/openapi`](../../packages/nestling.openapi/) и [`@nestling/openapi.zod`](../../packages/nestling.openapi.zod/), [гайд](../history/superseded/guides/openapi.md), [ideas.md [2026-07-13]](./ideas.md) |
| 21 | `input-bind` | канон размещения HTTP-input + bind-карта: детерминированное `(pattern, метод, пометки) → path/query/body`; сахар-пометки `query()` (заголовки — только по пометке, `header()` отложен в deferred.md) → плоская bind-карта — несущий уровень для транспорта/OpenAPI/клиента; разворачивание и fail-fast на создании декларации; strict-приём вместо merge (уходит `PayloadConflictError`); query-массивы (фикс last-wins); opt-in `rawBody: true` в HTTP-словаре — байты в типизированном стартовом контексте (webhook-подписи) | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-07-30-input-bind/), [ideas.md [2026-07-13]](./ideas.md) |
| 22 | `contract-clients` | `@nestling/contracts` (ныне `@nestling/operations`) (`makeContract` с `http:`-биндингом, `defineFail`; zero runtime deps — только Standard Schema types) + `@nestling/client`: `makeClient(record, { baseUrl, headers })` → API-объект, возврат `Ok\|Fail` (call-site ≡ порту); рематериализация `Fail` по `code`; валидация ответа по `output`-схеме (`~standard.validate`); streaming-клиент — v2 (после 6) | M → L | **done** — [архив](../../openspec/changes/archive/2026-08-01-contract-clients/), идея [ideas.md [2026-07-13]](./ideas.md), реализация [ideas.md [2026-08-01]](./ideas.md) |
| 23 | `pipeline-type-dx` | бюджет на DX типов pipeline: типы-ошибки в точке `compose` (читаемый литерал `__error` + `missing` вместо трассировки дженериков), snapshot-тесты текстов диагностик по фикстурам неправильных композиций, бенчмарк tsserver (~50 слоёв) с порогом в CI; попутно — сигнатура `compose` на прямой вывод тип-параметров (`TS2589` на 20 слоях уходит) | S–M | **done** — [архив](../../openspec/changes/archive/2026-07-31-pipeline-type-dx/), [ideas.md [2026-07-13]](./ideas.md) |
| 24 | `endpoint-model` | уход классовых endpoint-деклараций: канон — декларации-значения через per-transport конструкторы (`httpEndpoint`/`cliEndpoint` — типизированный словарь: path-параметры, bind-карта из 21); `deps`-инжект + формы хендлера (функция / каррированная фабрика / класс-хендлер через контейнер); `endpoints:` модуля принимает значения; удаление `@Endpoint`/`@HttpEndpoint`/`IEndpoint`/endpoint-registry; standalone-гарантия в типах (`route` — только deps-free); перевод `examples.app-with-http` и гайдов; классы остаются DI-формой провайдеров/юнитов/хендлеров; онтология — контракт первичен: конструкторы = сахар «анонимный контракт + `implement`»; CLI-биндинг — политика сбора недостающего input из схемы (`missing: 'prompt'`) — **вне scope этого change'а** | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-07-30-endpoint-model/), [ideas.md [2026-07-13]](./ideas.md) |
| 25 | `config-secrets` | `secret(leaf)` в `makeConfig` (каноническая композиция `secret(from(...))`; редактирование в трёх поверхностях: текст **и объект** `ConfigValidationError`, display-хуки проекции `toJSON`/`inspect.custom`, снимок реестра; незаданный ключ не редактируется); семантика общих ключей: независимая валидация каждой секцией, fail-fast на несогласованном `reloadable` в границах сборки, секретность по объединению **объявленных** читателей, перечень читателей в `describeConfig()` | S | **done** — [архив](../../openspec/changes/archive/2026-08-01-config-secrets/), идея [ideas.md [2026-07-13]](./ideas.md), реализация [ideas.md [2026-08-01]](./ideas.md) |
| 26 | `contract-versioning` | версия явно в имени контракта; `describeContract` → дескриптор-значение (листья — через `SchemaDocConverter`, без конвертера честно непрозрачны); `snapshotContracts` сводит `.check()`-матрицу объединением топологий; `diffContracts` с закрытым словарём `breaking`/`additive`/`unknown` и направлением по слоту; отчёт-значение плюс `formatCompatibility` и подсказка bump'а — подсвечивает, не блокирует (флага блокировки не существует) | S–M | **done** — [архив](../../openspec/changes/archive/2026-07-31-contract-versioning/), [гайд](../history/superseded/guides/ports.md), [ideas.md [2026-07-31]](./ideas.md), [ideas.md [2026-07-13]](./ideas.md) |
| 27 | `port-deadline-idempotency` | `meta.deadline` (gRPC-модель: абсолютный момент `Date` в процессе, относительный `timeoutMs` по проводу, пересчёт на приёме; fail-fast до вызова и до обработки, отмена в полёте; встроенный код `DEADLINE_EXCEEDED`, определение `DeadlineExceeded` — в `@nestling/pipeline`, где живёт закрытый набор); `idempotencyKey` в meta **только** у `command` (`MetaOf<C>` по виду; ключ чеканит вызыватель, если не дан; провоз конвертом шины; дедупликация — satellite, не ядро); профиль двумя каналами — `raw.attributes` и переменные `Deadline`/`IdempotencyKey` | M | **done** — [архив](../../openspec/changes/archive/2026-07-31-port-deadline-idempotency/), [гайд](../history/superseded/guides/ports.md), [ideas.md [2026-07-31]](./ideas.md), [ideas.md [2026-07-13]](./ideas.md) |
| 28 | `policy-check` | инварианты на собранном графе: `assemble({ policies })`, `everyEndpoint(фильтр).hasLayer(ref)` (идентичность слоя — по ссылке); `detached: '<причина>'` (строка обязательна) + печать detached-ручек на старте; ESLint-правило как editor-фидбек; машинерия для 13 (plugins) и 16 (async-context), прогон в `.check()`-матрице (18) | S–M | **done** — [архив](../../openspec/changes/archive/2026-07-31-policy-check/), новый пакет [`@nestling/eslint-plugin`](../../packages/nestling.eslint-plugin/), [ideas.md [2026-07-14]](./ideas.md) |
| 29 | `input-validation-builtin` | проверка входа по `input` — обязанность рантайма: одна точка после всех `.pre`-юнитов и перед хендлером, кандидат — `payload` из контекста или `raw.payload`, отказ от проверки объявляется схемой `z.unknown()`; **BREAKING** — юнит `validate()` удалён, ветка «без пайплайна» в `dispatch` заменена пустым пайплайном (один путь исполнения), копия проверки `multipart` убрана из HTTP-транспорта; новый kernel-код `PAYLOAD_TOO_LARGE` доводит 413 лимита потокового входа до клиента на обоих видах деклараций | M | **done** — [архив](../../openspec/changes/archive/2026-09-01-input-validation-builtin/), идея [ideas.md [2026-08-29]](./ideas.md), реализация [ideas.md [2026-09-01]](./ideas.md) |
| 30 | `remove-module-exports` | удаление `Module.exports` и опции `strictExports`: модуль остаётся меткой принадлежности и единицей упаковки, границу держат ES-модули и границы пакетов; `metadata.exported` уходит из узла графа, вклад в семейство объявляется одним провайдером в `providers` | S, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-01-remove-module-exports/), [ideas.md [2026-09-01]](./ideas.md) |
| 31 | `composition-model` | три роли слоя приложения: модуль (метка принадлежности, `dependsOn` вместо `imports`, без `endpoints`), фича (`makeFeature`, без `dependsOn`) и плагин (`makePlugin`, поле корня `plugins:`); граница фичи проверяется обходом собранного графа; токен становится объектом с идентичностью по ссылке, члены семейств хранят принадлежность полями; `select: { features, includeDeps }`; `intercom:` назначает роль переносчика операций ссылкой на объявленный транспорт; транспорты — именованные экземпляры с `on:` в декларации; `makeContract({ kind })` заменён на `makeRequest`/`makeCommand`/`makeEvent`, `.port` → `.caller`; слово «контракт» ушло из словаря целиком — пакет `@nestling/contracts` стал `@nestling/operations` | L, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-02-composition-model/), [ideas.md [2026-09-02]](./ideas.md) |
| 32 | `guide-review-1` | декларация приложения `makeApp` → `app.assemble(select)` → `AssembledApp`, `check(select)` на декларации, `assembleTest(app, …)`; код отказа `category:detail` вместо `status` + `code`, `makeFail`, отказы ядра голой категорией, `E ∪ InternalError`, статусы в нижнем регистре; поле `handler` с тремя формами, endpoint создаёт класс-хендлер сам, `meta.fail` удалён, `Output<T, typeof Def>`; заголовки `Ok` не зависят от транспорта; главы 1–5 гайда переписаны по ревью (health в плагине, глава «Хендлер как класс», DI после неё, `conventions.md`), примеры мигрированы; превью собирается из `docs/guide` | L, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-03-guide-review-1/), [ideas.md [2026-09-03]](./ideas.md) |
| 33 | `handler-two-forms` | удаление объектной формы `{ deps, handle }`: две формы хендлера — функция без зависимостей и класс; уходят перегрузки `httpEndpoint`/`cliEndpoint`/`implement`, позиционный `resolve(instances)`, ветка discovery; `@Injectable` сверяет длину списка зависимостей с конструктором; type-tests диагностик `httpEndpoint` в `transport.http`; примеры и главы 5, 12, 13, 17, приложение А | S–M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-05-handler-two-forms/), [ideas.md [2026-09-04]](./ideas.md) «Две формы хендлера», «`@Injectable` сверяет длину списка» |
| 34 | `layer-fails` | отказы слоя: `.pre(unit, { errors })`, `TFails` у пайплайна и множество определений на значении, канал `return` у pre-юнита, эффективное множество `errors` endpoint'а (граница, OpenAPI, `Output`), проверка «отказы пайплайна входят в `errors:` операции» в типах и при создании декларации; `Output<T, E>` допускает отказы ядра, `void` у хендлера без `output`; главы 3, 9, 13, приложение А | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-05-layer-fails/), [ideas.md [2026-09-04]](./ideas.md) «Отказы слоя», «`Output<T, E>` допускает отказы ядра» |
| 35 | `http-transport-boundary` | граница `@nestling/transport.http` в README пакета (обещания и то, что не входит: HTTP/2, WebSocket, TLS); байтовые части как публичная поверхность — satellite-транспорт поверх своего `node:http`-сервера собран из одних публичных экспортов в спеке пакета, экспорт `HTTP_CAPABILITIES`; бенчмарк относительно Fastify с записью результата в ideas.md | S | **done** — [архив](../../openspec/changes/archive/2026-09-05-http-transport-boundary/), новая спека [`http-transport-boundary`](../../openspec/specs/http-transport-boundary/spec.md), [ideas.md [2026-09-04]](./ideas.md) «Граница `@nestling/transport.http`» |
| 36 | `guide-concept-map` | README гайда: приложение Б вторым документом сразу после вводного абзаца, раздел «Карта понятий» — таблица «понятие, одно предложение, глава» на 25 строк по частям 1–4; спека `docs-preview-guide` получила требование о разделах README вне «Часть N.»/«Приложения» | S | **done** — [архив](../../openspec/changes/archive/2026-09-05-guide-concept-map/), [ideas.md [2026-09-04]](./ideas.md) «Подача гайда»; формулировка прогрессивного раскрытия в `principles.md` синхронизирована раньше и в объём change'а не входила |
| 37 | `abort-signal-registry` | сигнал запроса без `AbortSignal.any`: реестр контроллеров в `transport.http`, контроллер вызова со слушателем в бюджете и in-process шине `@nestling/ports`; бенчмарк печатает разброс и максимум латентности; Node 24 в README | S | **done** — [архив](../../openspec/changes/archive/2026-09-05-abort-signal-registry/), [ideas.md [2026-09-05]](./ideas.md) «Сигнал отмены запроса», «Целевая версия Node — 24» |
| 38 | `hot-path-trim` | обвязка запроса без лишней работы: `writeHead` с `content-length` и тело буфером, адрес без `new URL`, запись маршрута с bind-картой и формами, инварианты пайплайна в конструкторе, меньше `await`, контекст в одном объекте; каждый пункт по замеру `nestling,fastify` | S–M | **done** — [архив](../../openspec/changes/archive/2026-09-05-hot-path-trim/), [ideas.md [2026-09-05]](./ideas.md) «Горячий путь» |
| 39 | `examples-out` | шесть примеров из `packages/examples.<name>` в `examples/<name>`: `packages/` содержит только публикуемые пакеты, имена `@examples/<name>`, `private: true` у каждого; `smoke.mjs` обходит `packages/` без фильтра по префиксу, `docs-audit` резолвит пример из плашки главы как `examples/<name>`; 278 подписей сниппетов и 25 плашек гайда переписаны на новый путь | S | **done** — [архив](../../openspec/changes/archive/2026-09-05-examples-out/), новая спека [`examples-layout`](../../openspec/specs/examples-layout/spec.md); первый change серии из трёх (`examples-out`, `common-inline`, `package-consolidation`) |
| 40 | `docs-layout-cleanup` | уборка документации, волна 1: генератор и тема сайта в `scripts/site/`, вывод в `docs/.site/` вне git, команды `docs:build` и `docs:dev`; правила ведения одним экземпляром в `docs/README.md`, корневые README без таблиц пакетов, примеров и глав, приложение В удалено; `docs:audit` проверяет, что сгенерированный HTML не отслеживается git | S | **done** — [архив](../../openspec/changes/archive/2026-09-05-docs-layout-cleanup/), новая спека [`docs-site`](../../openspec/specs/docs-site/spec.md) вместо `docs-preview-guide`, [d/11](../history/discussions/11-docs-structure-and-site.md) |
| 41 | `packaging-cleanup` | два дефекта упаковки: `tsconfig.build.json` не исключал `*.type-test.ts` и `__fixtures__`, и они попадали в `dist` вместе с импортом двух `devDependencies`; манифесты семи пакетов расходились с фактическими импортами | S | **done** — [архив](../../openspec/changes/archive/2026-09-05-packaging-cleanup/), новая спека [`packages-layout`](../../openspec/specs/packages-layout/spec.md); сплошная сверка добавила к семи расхождениям ещё два и две правки в манифестах `examples/`, [ideas.md [2026-09-05]](./ideas.md) «Раскладка монорепы» |
| 42 | `package-consolidation` | ядро в три пакета: `container`, `operations` (+ формы io, `streams`), `app` (+ `pipeline`, `config`, `ports`, `transport`); три пакета `@common/*` остаются под своими именами; 22 каталога `packages/` становятся 17, 63 ребра — 29, восемь уровней глубины — шесть; приложение импортирует из трёх пакетов вместо восьми; направление зависимостей держит правило, миграция примеров, глав гайда, README и `design/composition.md` | L, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-06-package-consolidation/), новая спека [`core-package-layout`](../../openspec/specs/core-package-layout/spec.md), [ideas.md [2026-09-05]](./ideas.md) «Раскладка монорепы»; третий change серии из трёх (`examples-out`, `packaging-cleanup`, `package-consolidation`) |
| 43 | `guide-single-file` | гайд одним файлом: `yarn docs:build` кладёт в `docs/.site/` один `index.html` вместо двадцати восьми страниц; тема и поведение встраиваются в него, ссылки между главами становятся якорями с приставкой главы (`#06-config--секреты`), подсветка кода выполняется на сборке | S, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-06-guide-single-file/), спека [`docs-site`](../../openspec/specs/docs-site/spec.md) переписана на один файл |
| 44 | `docs-di-token` | термин «DI-токен» везде: гайд, README пакетов, JSDoc, комментарии и сообщения ошибок; линтер стиля ловит голое «токен»; токен доступа в главе 9 — «Bearer-токен» | S | **done** — [архив](../../openspec/changes/archive/2026-09-07-docs-di-token/), новая спека [`docs-terminology`](../../openspec/specs/docs-terminology/spec.md), [ideas.md [2026-09-06]](./ideas.md) «Термины и гайд» |
| 45 | `sync-assemble` | фаза 0 BOOTSTRAP отдельно: источники читаются в снимок до сборки, секции считаются из снимка; `build()` синхронный и без I/O; `factoryProvider` и фабрики провайдеров модулей только синхронные, Promise из фабрики — ошибка сборки; `check()` принимает `config` | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-06-sync-assemble/), новые спеки [`config-bootstrap-snapshot`](../../openspec/specs/config-bootstrap-snapshot/spec.md) и [`synchronous-assembly`](../../openspec/specs/synchronous-assembly/spec.md), [ideas.md [2026-09-06]](./ideas.md) «Фаза 0 BOOTSTRAP» |
| 46 | `resources-and-roles` | `@Component`, `@Resource`, `@Handler` с брендами позиций; `resourceProvider`; экземпляры создаются на INIT, `acquire` и `release`, `@OnInit` и `@OnDestroy` удалены, `@Injectable` удалён; `classProvider` вместо перегрузки с DI-токеном; `capabilities` на объявлении транспорта; глава 5 гайда с `Database` как ресурсом | L, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-07-resources-and-roles/), новые спеки [`class-roles`](../../openspec/specs/class-roles/spec.md), [`resource-lifecycle`](../../openspec/specs/resource-lifecycle/spec.md) и [`instantiation-on-init`](../../openspec/specs/instantiation-on-init/spec.md), [ideas.md [2026-09-06]](./ideas.md) «Ресурсы и роли классов» |
| 47 | `switches` | `makeSwitch`, `pick` и `when` во всех списках единиц, `switches:` корня, типизированный аргумент `assemble`, измерение в `check()` и `checkTopologies`, `.schema` для `RootConfig`; формы корня `{ endpoints, providers? }`, `{ endpoints, modules? }`, `{ features }`; глава о композиции после главы 1, главы 2 и 5 в шаг-форме | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-07-switches/), новая спека [`composition-switches`](../../openspec/specs/composition-switches/spec.md), [ideas.md [2026-09-06]](./ideas.md) «Переключатели состава» |
| 48 | `kernel-logger` | интерфейс `Logger` с тремя формами вызова и `child`, `RootLogger$` с умолчанием ядра, семейство `Logger$` с `.auto`; ядро пишет только через него, `onWarn` и `onUnknownFail` удалены; секция `nestlingLog`; глава 8 гайда | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-06-kernel-logger/), новая спека [`kernel-logger`](../../openspec/specs/kernel-logger/spec.md), [ideas.md [2026-09-06]](./ideas.md) «Логгер ядра» |
| 49 | `http-server` | `httpServer({ name })` как ресурс, `http({ server })`, секция порта семейством по имени сервера, опция `port` удалена, `listen` последним на START; дубликат «транспорт, паттерн» падает на ASSEMBLE | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-07-http-server/), новые спеки [`http-server-resource`](../../openspec/specs/http-server-resource/spec.md) и [`pattern-uniqueness`](../../openspec/specs/pattern-uniqueness/spec.md), [ideas.md [2026-09-06]](./ideas.md) «HTTP-сервер как ресурс» |
| 50 | `http-handler-form` | `Handler<Op>`, `HttpHandler<Op>`, `HandlerMeta`, `HttpHandlerMeta`, `HttpOutput`, `HttpResponse`; `Ok` без заголовков; стартовый контекст транспорта и юниты `withHeader`, `withClientIp`, `httpAccessLog`; `implement` принимает только хендлер без `http` | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-08-http-handler-form/), новые спеки [`http-handler-form`](../../openspec/specs/http-handler-form/spec.md) и [`transport-pipeline-units`](../../openspec/specs/transport-pipeline-units/spec.md), [ideas.md [2026-09-06]](./ideas.md) «HTTP-хендлер явной формой» |
| 51 | `config-derived` | `derived([deps], fn)` с наследованием секретности и пересчётом, `env({ prefix })`, `describeConfig({ converters })`; глава 6 гайда | S–M | **done** — [архив](../../openspec/changes/archive/2026-09-07-config-derived/), расширены спеки [`config-sections`](../../openspec/specs/config-sections/spec.md), [`config-secrets`](../../openspec/specs/config-secrets/spec.md), [`config-reloadable`](../../openspec/specs/config-reloadable/spec.md), [`config-registry`](../../openspec/specs/config-registry/spec.md) и [`config-sources-binding`](../../openspec/specs/config-sources-binding/spec.md), [ideas.md [2026-09-06]](./ideas.md) «Конфиг: `derived`…» |
| 52 | `openapi-declaration` | `app.discover(args?)` — фаза 0 без продолжения на декларации, вход генератора вместо ручного `discoverEndpoints`; фаза 0 одной функцией `resolveComposition` на сборку и на метод; `discoverEndpoints` уходит из публичных экспортов; скрипт `openapi` в примере `app-with-http` | S, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-09-openapi-declaration/), обновлены спеки [`endpoint-discovery`](../../openspec/specs/endpoint-discovery/spec.md) и [`openapi-document`](../../openspec/specs/openapi-document/spec.md), [ideas.md [2026-09-06]](./ideas.md) «Документ OpenAPI без запуска» |
| 53 | `health` | `HealthCheck$` и `Health$` в ядре, флаг `critical`, таймаут и кэш через `nestlingHealth`; `httpProbes()`; `health` у ресурса; главы 1, 9 и 23 гайда | M | **done** — [архив](../../openspec/changes/archive/2026-09-09-health/), новые спеки [`health-probes`](../../openspec/specs/health-probes/spec.md) и [`http-probes`](../../openspec/specs/http-probes/spec.md), [ideas.md [2026-09-06]](./ideas.md) «Пробы»; закрывает [deferred [2026-07-14]](./deferred.md) |
| 54 | `outbox` | Пакет `@nestling/outbox`: семейство `outboxed(Op)`, интерфейс `OutboxStore` с реализацией в памяти, relay ресурсом с `drain()`, секция конфига, факты `outbox.published` и `outbox.stuck`, политика `requiresTransaction`; глава 27 гайда | L | **done** — [архив](../../openspec/changes/archive/2026-09-07-outbox/), новая спека [`transactional-outbox`](../../openspec/specs/transactional-outbox/spec.md), [ideas.md [2026-09-07]](./ideas.md) «Транзакционный outbox»; закрывает [deferred [2026-07-13]](./deferred.md) в части outbox'а |
| 55 | `stream-finish` | `.finally` у потокового ответа, закрытого до первого элемента: `withFinish` — объект-итератор вместо асинхронного генератора, закрытие доводит до источника обёртка формы `bindOutputStream`, `untilAborted` закрывает источник и в ветке «сигнал уже взведён»; тест границы `core-limits.spec.ts` удалён | S | **done** — [архив](../../openspec/changes/archive/2026-09-09-stream-finish/), обновлены спеки [`pipeline-phase-model`](../../openspec/specs/pipeline-phase-model/spec.md), [`http-request-cancellation`](../../openspec/specs/http-request-cancellation/spec.md) и [`subscription-registry`](../../openspec/specs/subscription-registry/spec.md), находка №4 записи [ideas.md [2026-08-01]](./ideas.md) «Реестр подписок» |
| 56 | `cli-input-prompt` | политика сбора недостающего входа в CLI: `missing: 'prompt'` достраивает payload из схемы `input` вопросами в терминале | M | план — п. 7 записи [ideas.md [2026-07-13]](./ideas.md) «Контракт первичен»; вынесен из scope change'а 24, отсылка стоит комментарием в `packages/nestling.transport.cli` |
| 57 | `kernel-boundary-outbox` | четыре места границы ядра из замера outbox'а закрыты правкой ядра: `Var.provide(deps, compute)` — писатель переменной с зависимостями из контейнера, `EmitMeta` с ключом идемпотентности у события, `makeToken(id, { hint })` с печатью подсказок в ошибке о недостающих зависимостях, тип-параметр словаря `meta` у `Port` и `Emitter`; outbox: раздел аргументом `emit`, `core-limits.spec.ts` удалён | S–M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-12-kernel-boundary-outbox/), новая спека [`dependency-hints`](../../openspec/specs/dependency-hints/spec.md), раздел «Результат замера границы» записи [ideas.md [2026-09-07]](./ideas.md) «Транзакционный outbox» |
| 58 | `docs-package-readmes` | волна 2 уборки: шесть разделов README пакета в фиксированном порядке и потолок 120 строк; восемнадцать README переписаны — 1142 строки вместо 6277; четыре инварианта в `docs:audit`, включая совпадение перечня экспортов с барелем в обе стороны; барели `app` и `operations` переписаны поимённым `export` | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-09-docs-package-readmes/), новая спека [`docs-package-readme`](../../openspec/specs/docs-package-readme/spec.md), расширена [`packages-layout`](../../openspec/specs/packages-layout/spec.md), [ideas.md [2026-09-05]](./ideas.md) «Структура документации» |
| 59 | `docs-guide-recipes` | волна 3 уборки: разделение гайда на путь `guide/` и рецепты `recipes/`, деление главы 12, переезд «Что проверяется до первого запроса» и приложения Б в корень `docs/` | M | план — [ideas.md [2026-09-05]](./ideas.md) «Структура документации»; после 40, от волны 4 не зависит |
| 60 | `docs-site-sections` | волна 4 уборки: разделы сайта, URL-пути, ссылки на GitHub, подсветка на сборке, поиск, стартовая страница, метаданные | M–L | план — [ideas.md [2026-09-05]](./ideas.md) «Структура документации»; после 58 и 59 — генератор правится один раз, когда структура папок устоялась |
| 61 | `docs-publish` | волна 5 уборки: публикация через GitHub Actions и Pages, домен, новые инварианты `docs:audit` | S–M | план — [ideas.md [2026-09-05]](./ideas.md) «Структура документации»; после 60 |
| 62 | `barrels-by-name` | остальные шестнадцать барелей поимённым `export`: правило `packages-layout` действует на все пакеты, а `export *` остался везде, кроме `app` и `operations` | S | план — открытый вопрос записи [ideas.md [2026-09-09]](./ideas.md) «Публичное имя — имя с читателем»; после 58 |
| 63 | `npm-publish` | скоуп `@nestlingjs` на все пакеты, внутренние с `common.` в имени, `LICENSE` и `files` в каждом манифесте, поле `main` удалено, проверка упаковки `pack:check` установкой тарболов вне репозитория, релиз тегом `v*` из GitHub Actions | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-11-npm-publish/), новая спека [`package-publication`](../../openspec/specs/package-publication/spec.md), расширены [`packages-layout`](../../openspec/specs/packages-layout/spec.md) и [`testing-subpath-convention`](../../openspec/specs/testing-subpath-convention/spec.md), [ideas.md [2026-09-10]](./ideas.md) «Публикация в npm» |
| 64 | `agent-skill` | пакет `@nestlingjs/agent-skill`: скилл Claude Code про Nestling, команда `npx @nestlingjs/agent-skill`, сниппеты скилла компилируемыми файлами и проверка `bin` в `pack-check` | M | **done** — [архив](../../openspec/changes/archive/2026-09-11-agent-skill/), новые спеки [`agent-skill-content`](../../openspec/specs/agent-skill-content/spec.md), [`agent-skill-package`](../../openspec/specs/agent-skill-package/spec.md) и [`agent-skill-snippet-check`](../../openspec/specs/agent-skill-snippet-check/spec.md), [ideas.md [2026-09-11]](./ideas.md) «Скилл для агента» |
| 65 | `trusted-publishing` | публикация по OIDC-обмену с доверенным издателем вместо ключа доступа, права `publish` и `stage publish` у издателя, первая версия нового имени с рабочей машины режимом `--interactive`, коммит подъёма версии проверяется один раз | S | **done** — [архив](../../openspec/changes/archive/2026-09-12-trusted-publishing/), обновлены спеки [`package-publication`](../../openspec/specs/package-publication/spec.md) и [`examples-layout`](../../openspec/specs/examples-layout/spec.md), [ideas.md [2026-09-10]](./ideas.md) «Публикация в npm» |
| 66 | `skill-setup` | скилл после первого внешнего прогона: спека собирает `app` из сниппетов через `assembleTest`, новые `references/setup.md` (tsconfig, скрипты, `tsx` для разработки, условие `testing`, конфиг `@nestlingjs/eslint-plugin`) и `references/http.md` (`redirect:`, `HttpResponse`, `Ok.created`), правила 6 и 7 в SKILL.md, таблица шести пакетов в «Where to look next», вариант `node:test` | S–M | **done** — [архив](../../openspec/changes/archive/2026-09-12-skill-setup/), обновлены спеки [`agent-skill-content`](../../openspec/specs/agent-skill-content/spec.md) и [`agent-skill-snippet-check`](../../openspec/specs/agent-skill-snippet-check/spec.md), [ideas.md [2026-09-12]](./ideas.md) «Скилл после первого внешнего прогона», [d/14](../history/discussions/14-first-external-run.md) пункты A1–A3, A5–A7, B8 |
| 67 | `feedback-polish` | пять починок по первому внешнему прогону: runtime-строки на английском во всех пакетах и проверка линтером, страховка от `any` в `ValidComponentShape`, JSDoc без `Ok.of`, `content-length: 0` у пустого ответа, `find-my-way` 9.7 и новее, раздел «когда Nestling не нужен» в корневом README | S | **done** — [архив](../../openspec/changes/archive/2026-09-12-feedback-polish/), новая спека [`runtime-message-language`](../../openspec/specs/runtime-message-language/spec.md), расширены [`class-roles`](../../openspec/specs/class-roles/spec.md) и [`http-transport-boundary`](../../openspec/specs/http-transport-boundary/spec.md), [ideas.md [2026-09-12]](./ideas.md) «Runtime-строки на английском и четыре починки» (помечена РЕАЛИЗОВАНО), [d/14](../history/discussions/14-first-external-run.md) пункты B2, B4, B6, B7, B9, B10 |
| 68 | `http-endpoint-two-names` | реализация операции получает своё имя `httpEndpoint.implement(Operation, { … })`, у `httpEndpoint` остаётся форма со своим адресом: по две перегрузки на имя вместо четырёх, ложная ошибка на `pipeline:` исчезает; брендированный тип `ValidateHandlerFails` в слоте `handler` называет незаявленный отказ; снапшоты диагностик, миграция примеров, глав и скилла, `references/diagnostics.md` в скилле | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-12-http-endpoint-two-names/), [ideas.md [2026-09-12]](./ideas.md) «Две декларации HTTP вместо четырёх перегрузок»; статики по HTTP-методу вынесены в 72 |
| 69 | `openapi-query-parsed-form` | параметр path и query описывается разобранной формой схемы, если она скалярная: второй прогон конвертера с `io: 'output'` в `planInput`, `z.stringbool()` даёт `type: boolean`; тело запроса без изменений | S–M | **done** — [архив](../../openspec/changes/archive/2026-09-12-openapi-query-parsed-form/), обновлена спека [`openapi-document`](../../openspec/specs/openapi-document/spec.md), [ideas.md [2026-09-12]](./ideas.md) «Документ OpenAPI: параметр в разобранной форме» (помечена РЕАЛИЗОВАНО), [d/14](../history/discussions/14-first-external-run.md) пункт B5 |
| 70 | `eslint-deps-sync` | правило `dependency-list` в `@nestlingjs/eslint-plugin`: список DI-токенов декоратора выводится из типов параметров конструктора по синтаксической таблице, расхождение чинится автофиксом, непрозрачный тип оставляет правило молчать | M | план — [ideas.md [2026-09-12]](./ideas.md) «Правило линтера: список зависимостей из параметров конструктора»; после 68 |
| 71 | `inbox` | пакет `@nestlingjs/inbox`: плагин `inbox({ transaction, store })` со слоем для подписчиков, интерфейс `InboxStore` с реализацией в памяти, составной ключ «подписчик + ключ идемпотентности», политика `requiresInbox`; глава 27 гайда | M | план — [ideas.md [2026-09-12]](./ideas.md) «Транзакционный приём»; после 57 — слой читает типизированный `meta.idempotencyKey` события |
| 72 | `http-method-constructors` | восемь статиков по HTTP-методу у `httpEndpoint`: `httpEndpoint.get(path, { … })` и остальные семь, метод уходит из словаря в имя конструктора; миграция ~305 мест | M, breaking | план — [deferred [2026-09-03]](./deferred.md) «Конструктор HTTP-декларации с методом в имени»; после 68 — имя `httpEndpoint` уже стало пространством имён со статиком `.implement` |
| 73 | `drizzle-pg` | пакет `@nestlingjs/drizzle.pg`: соединение значением `drizzlePg({ schema })` с DI-токеном, переменной транзакции, конструктором слоя `db.transaction()`, политикой `requiresTransaction` и ключами конфига семейства `database`; пул — ресурс с пробой; адаптер `OutboxStore` подпутём `./outbox`, таблица записей объявлением drizzle и строкой DDL; пример `users-service` на PostgreSQL | L | **done** — [архив](../../openspec/changes/archive/2026-09-12-drizzle-pg/), новые спеки [`database-connections`](../../openspec/specs/database-connections/spec.md), [`request-transaction`](../../openspec/specs/request-transaction/spec.md) и [`sql-outbox-store`](../../openspec/specs/sql-outbox-store/spec.md), [ideas.md [2026-09-11]](./ideas.md) «Соединение с базой: сателлит `drizzle.pg`» |

## Порядок и зависимости

```
базовая ветка (pipeline/streaming):
  1 transport-hardening ─┐
  2 container-fixes ─────┼─ независимы, можно сразу
  3 abort-signal ────────┴─→ 6 streaming-v2 ─→ 7 subscriptions-registry
  4 pipeline-v2 ────────────↗
  5 token-families — после 4 (или параллельно)
  14 multi-injection (Family.all) — после 5, аддитивно
  15 error-model — после 4 (normalizeResponse, Output); нужен 11 ports (ре-гидрация Fail)
  16 async-context — после 4 и 5 (Ctx — token family); propagate нужен 12 transport.nats
  17 pipeline-drop-after — после 4, до фиксации публичного API V1 (пока .after никто не использует)
  19 standard-schema — после 4, до фиксации публичного API V1 (breaking: SchemaValidationError)
  21 input-bind — после 4 (декларации); несущий уровень для 20 и 22
  20 openapi — после 19, 8 (дискавери) и 21 (bind-карта); errors: → responses требует 15
  22 contract-clients — после 11 (makeContract), 15 (defineFail/errors:), 19 и 21
  23 pipeline-type-dx — после 4, до фиксации публичного API V1
  24 endpoint-model — после 4, рядом с 8 (реестр умирает вместе с @Endpoint); до фиксации публичного API V1

ветка «модульный монолит» (сессия 2026-07-08):
  8 endpoint-discovery ─┐
                        ├─→ 10 features ─→ 11 ports ─→ 12 transport.nats
  5 token-families ─→ 9 config-module ─┘        │
  4 pipeline-v2 ────────────────────────────────┼─→ 13 plugins
  6 streaming-v2 (Topic) ── переиспользуется 11 (InProcessBus) и 9 (reloadable)
  18 testing-package — ядро после 9+10 (assemble, фазы, vars); stub(Contract) — после 11
  25 config-secrets — после 9 (makeConfig, describeConfig(), реестр ключей)
  26 contract-versioning — после 11 (makeContract); отчёт живёт в .check()-матрице (18)
  27 port-deadline-idempotency — после 11 (dispatch); wire-часть — вместе с 12
  28 policy-check — после 4 (слои-значения) и 8 (полный граф endpoints); используется 13 и 16
```

Базовая ветка:

- 1 и 2 — быстрые исправления, не зависят от целевого дизайна.
- 3 — маленькая предпосылка для 6 (и полезна сама по себе: чинит вечный
  `close()` на живых соединениях).
- 4 — самый большой и ломающий; см. миграционную сложность в ideas.md.
- 6 требует 3 (signal) и 4 (item-цепочки описаны в терминах новой модели);
  io-формы и capability-валидация биндинга — [ideas.md [2026-07-13]](./ideas.md)
  «Контракт первичен» (формы = вход для media types в 20 и fail-fast
  порта/шины в 11).
- **7 `subscriptions-registry`** — **сделан**, последним по плану: тест того, что
  публичных примитивов достаточно. Результат: пакет собран целиком поверх них,
  `git diff` по kernel-пакетам за весь change пуст, внешних зависимостей нет.
  Четыре находки (зарезервированный `signal`, `Outcome` без `killed`, кластерное
  управление, `.finally` у непрочитанного потока) закрыты записями журнала, а не
  правками ядра — [ideas.md [2026-08-01]](./ideas.md).
- **15 `error-model`** — можно сразу после 4; ре-гидрация remote-`Fail` —
  вклад в 11 (`ports`), но не блокирует ядро change'а.
- **16 `async-context`** — после 5 (ридеры `Ctx(Var)` — члены семейства);
  `propagate` реализуется вместе с 12 (`transport.nats`); policy-check
  присутствия — та же машинерия, что startup policy-check в 13 (`plugins`).
- **19 `standard-schema`** — после 4; желательно до фиксации публичного API V1, пока
  на `SchemaValidationError.zodError` никто не опёрся (breaking сменой формата
  на стандартные `issues`).
- **20 `openapi`** — после 19 (конвертеры), 8 (дискавери endpoints из дерева)
  и 21 (bind-карта разрешает бывший дизайн-блокер «разложение merged payload»);
  `errors:` → responses приезжает из 15.
- **21 `input-bind`** — после 4 (декларации endpoints); breaking для приёма
  «поле отовсюду». Несущий уровень для 20 (`parameter` vs `requestBody`)
  и 22 (сборка запроса клиентом). Логика — [ideas.md [2026-07-13]](./ideas.md)
  «Канонизация HTTP-input», согласовано в
  [d/06 П.4](../history/discussions/06-critical-design-review.md).
  `rawBody` — пометка словаря, меняющая **тип** стартового контекста
  декларации: слой проверки подписи объявляет `{ rawBody }` требованием,
  забытая пометка = ошибка в точке композиции («Контракт первичен», п. 6).
- **22 `contract-clients`** — **сделан**. После 11 (`makeContract`), 15
  (`defineFail`, `errors:`), 19 (`~standard.validate` на клиенте) и 21
  (bind-карта). Упаковка учтена буквально: декларативный слой **переехал** в
  zero-deps `@nestling/contracts`, а `@nestling/ports` `makeContract` не
  реэкспортирует. Streaming-клиент — v2, после 6. Логика —
  [ideas.md [2026-07-13]](./ideas.md) «Типизированные клиенты из контрактов»
  и [ideas.md [2026-08-01]](./ideas.md) «Клиенты из контрактов: реализация»,
  дискуссия — [d/07](../history/discussions/07-typed-clients.md).
- **23 `pipeline-type-dx`** — после 4, **до фиксации публичного API V1**: типы-ошибки
  и пороги дешевле вводить до фиксации публичного API; после релиза упрощение
  типов — breaking. Логика — [ideas.md [2026-07-13]](./ideas.md)
  «Бюджет на DX типов pipeline».
- **24 `endpoint-model`** — после 4; логично ехать в том же breaking-окне, что
  17/19 (до фиксации публичного API V1); делать рядом с 8 (глобальный реестр умирает
  вместе с `@Endpoint`). Согласован с 21 (bind-карта разворачивается в
  конструкторе декларации) и 22 (`httpEndpoint` — инлайн-форма контракта);
  желательно до 15 (типизированный канал `E` проектируется под единственную
  форму декларации) и до 20 (OpenAPI потребляет транспортный словарь
  деклараций). «Транспорт токеном» — вместе с 10 (транспорты-провайдеры).
  `@Injectable`-провайдеры и юниты-классы не затронуты; класс-хендлер остаётся
  DI-формой поля `handle`. Онтология — контракт первичен: конструкторы =
  сахар «анонимный контракт + `implement`», мультитранспорт именованного
  контракта — биндинги в контракте + один `implement`. Логика —
  [ideas.md [2026-07-13]](./ideas.md) «Один канонический стиль деклараций» +
  «Endpoint-декларации» + «Контракт первичен», дискуссия —
  [d/08](../history/discussions/08-endpoint-declarations-and-styles.md)
  (с продолжением).

Ветка «модульный монолит»:

- **8 `endpoint-discovery`** — независим, S; предпосылка для 10 и баг-фикс сам по
  себе. Делаем первым.
- **9 `config-module`** — поверх 5 (token-families) — **done**,
  [архив](../../openspec/changes/archive/2026-07-31-config-module/). Точка
  привязки временно живёт в `AppConfig.config`; переезд в `assemble()` — одна
  строка в 10.
- **10 `features`** — после 8 (дискавери) и 9 (конфиг в `assemble`); включает
  `@OnStart`/go-live и транспорты-провайдеры.
- **11 `ports`** — после 10 (биндинг по топологии/`select`) и 4 (endpoints);
  `InProcessBus` переиспользует `Topic` из 6. Порт на контракт с формами
  `stream`/`events` — fail-fast на ASSEMBLE (v1: только value-формы;
  стриминг по шине — v2).
- **12 `transport.nats`** — после 11 (remote-биндинг, queue-groups, JetStream).
- **13 `plugins`** — после 10 (feature-scoped инфра) и 4 (pipeline-слои);
  startup policy-check — из отложенного в pipeline-v2.
- **18 `testing-package`** — ядро (`assembleTest`, `.check()`, `vars()`,
  `familyOverride`, `checkTopologies`, `testModule`, `unwrap`) **сделано**
  после 9 и 10 (нужны `assemble`, фазовый lifecycle, источники);
  `stub(Contract)` — после 11. Вместе с ним в остаток уехал **`app.emit`**:
  понятия `Event` (контракт вида `event`, `Emitter`, шина) в ядре нет, и
  эмитить нечего; форма `app.call` выбрана так, чтобы `emit` встал рядом без
  переделки. Это единственный пункт исходного скоупа, который перенесён.
  Остаток **сделан** в волне 6 — change `testing-stub-contract`,
  [архив](../../openspec/changes/archive/2026-08-01-testing-stub-contract/) —
  и подтвердил
  расчёт: заготовленное поле `stubs:` приняло контрактные стабы без правок, а
  ядра портов, контрактов, контейнера и `App` не потребовалось трогать ни
  строкой. Сверх записи приехал `app.stubbed` — состав подстановок значением
  для сверки с матрицей `.check()`.
- **25 `config-secrets`** — **сделан**. Аддитивно поверх 9; в спеку 9 не
  вносится (9 spec-ready, расширять скоуп задним числом не хотим). Реализация
  уточнила две вещи, которых запись не называла: редактируется **объект**
  ошибки, а не только её текст (`failures` — публичное поле), и области
  считаются по-разному — секретность по **объявленным** секциям, конфликт
  `reloadable` по **материализованным** (редактирование ошибается в
  безопасную сторону, запрет — в опасную). Обещанные «читатели ключа в
  `explain()`» приземлились в `describeConfig()`: графового `explain()` в
  коде нет. Логика — [ideas.md [2026-07-13]](./ideas.md) «Конфиг: `secret()`
  и общие ключи» + блок реализации [2026-08-01].
- **26 `contract-versioning`** — после 11; отчёт совместимости — расширение
  `.check()`-матрицы (18). Открытым остаётся, где живёт снапшот схем
  (репо vs registry): форма API выбрана так, что ответ не меняет ни одной
  сигнатуры — baseline приходит значением. Логика —
  [ideas.md [2026-07-13]](./ideas.md) «Порты: deadline, идемпотентность,
  версионирование контрактов» и, по факту реализованного,
  [ideas.md [2026-07-31]](./ideas.md) «Версионирование контрактов: снапшот
  из дискавери, вердикт по слоту, третий вердикт `unknown`».
- **27 `port-deadline-idempotency`** — после 11 (dispatch, meta); провоз по
  сети (кодирование конверта в NATS headers) — вместе с 12. Дедупликация —
  satellite, вне скоупа. Автонаследование бюджета вглубь отвергнуто и
  отложено ([deferred.md [2026-07-31]](./deferred.md)). Логика —
  [ideas.md [2026-07-13]](./ideas.md) и, по факту реализованного,
  [ideas.md [2026-07-31]](./ideas.md).
- Рекомендуемый вход в ветку: **8 → 9 → 10 → 11 → 12**, `13` — параллельно после 10.

## Волны реализации

Граф выше говорит, что **можно** делать после чего. Волны говорят, что
**стоит** делать раньше, по одному критерию: *сначала то, что удешевляет всё
последующее*. Отсюда два неочевидных сдвига против порядка зависимостей —
breaking-окно едет вторым (а не после ветки монолита), а ядро
`testing-package` (18) — раньше, чем позволяет буква графа.

Порядок внутри волны рекомендованный; параллелить стоит только явно
независимые пары, каждую — в своём git worktree.

### Волна 0 — рабочий контур

Не change'и и не про целевой дизайн: инструментальная база, без которой
позадачная работа буксует.

| Пункт | Почему |
|---|---|
| Вернуть openspec CLI (`@fission-ai/openspec`, ~1.6) | сейчас его нет на PATH — `/opsx:propose\|apply\|archive` падают на первом же вызове |
| Root-скрипт `verify` = `nx run-many -t build lint test` | в корневом `package.json` нет ни одного скрипта, а DoD нужна одна gate-команда. Baseline 2026-07-28 — зелёный, 15 проектов |
| DoD в `rules.tasks` (`openspec/config.yaml`) + в `CLAUDE.md` | DoD доезжает до каждой сессии сам, а не повторяется руками в промпте. `rules` в openspec keyed по **artifact ID** (`proposal`/`design`/`specs`/`tasks`), ключа `apply` не существует — поэтому правило заставляет `propose` класть DoD последним разделом `tasks.md`, а `CLAUDE.md` держит тот же список для change'ей, чьи `tasks.md` сгенерированы раньше |
| Auto-режим на время apply-сессии | сессия не встаёт на подтверждениях и доезжает до конца без присмотра |
| Ветка на change (`change/<имя>`) | поверхность ревью = `git diff main...` |

### Волна 1 — фундамент контейнера (аддитивно)

| # | Change | Размер | Почему здесь |
|---|---|---|---|
| 5 | `token-families` | M | разблокирует 9, 14, 16 — **done**, [архив](../../openspec/changes/archive/2026-07-29-token-families/) |
| 14 | `multi-injection` | S | тот же файл-фронт в контейнере, что и 5 — дешевле сразу следом — **done**, [архив](../../openspec/changes/archive/2026-07-29-multi-injection/) |

Выход: контейнер умеет параметризованные провайдеры и агрегаты семейств;
публичное API не сломано ни в одной точке.

### Волна 2 — breaking-окно: фиксация публичного API V1

Состав окна закрыт записью [ideas.md [2026-07-14]](./ideas.md) «Kernel 1.0»
(п. 3). Ставим сразу после волны 1, потому что цена окна растёт с объёмом
кода: сегодня переписать нужно только `examples.app-with-http` (~1.8k строк
на классовых `@Endpoint` и zod), после волн 3–5 — всё, что поверх них
построено.

| # | Change | Размер | Почему в этом месте |
|---|---|---|---|
| 19 | `standard-schema` | S–M | самый нижний слой (валидация): чем раньше, тем меньше кода написано против `z.ZodType` — **done**, [архив](../../openspec/changes/archive/2026-07-29-standard-schema/) |
| 17 | `pipeline-drop-after` | S | чистое удаление фазы; после появления новых слоёв дорожает — **done**, [архив](../../openspec/changes/archive/2026-07-29-pipeline-drop-after/) |
| 8 + 24 | `endpoint-discovery` + `endpoint-model` | S + M | одним заходом: глобальный реестр умирает вместе с `@Endpoint` — 8 **done**, [архив](../../openspec/changes/archive/2026-07-29-endpoint-discovery/); 24 **done**, [архив](../../openspec/changes/archive/2026-07-30-endpoint-model/) |
| 21 | `input-bind` | M | поверх новых деклараций; несущий уровень для 20 и 22 — **done**, [архив](../../openspec/changes/archive/2026-07-30-input-bind/) |
| 23 | `pipeline-type-dx` | S–M | закрывает окно: снапшоты диагностик и порог tsserver снимаются с уже зафиксированных типов — **done**, [архив](../../openspec/changes/archive/2026-07-31-pipeline-type-dx/) |

Выход: **публичный API V1 зафиксирован**, дальше всё аддитивно.

**Breaking-окно закрыто** (2026-07-31): весь состав волны реализован.
Поверхность вызова `compose` при этом не менялась — переписана внутренняя
форма типизации; наблюдаемо сломались только поля типов-ошибок
(`ERROR`/`MISSING_FIELDS`/…, на них ссылались лишь type-тесты репозитория).
Дальнейшие изменения публичного API V1 — аддитивные.

### Волна 3 — семантика ядра

| # | Change | Размер | Почему здесь |
|---|---|---|---|
| 15 | `error-model` | M | баг-фикс поставлен: возвращённый `Fail` больше не уезжает как `200 OK` — **done**, [архив](../../openspec/changes/archive/2026-07-31-error-model/) |
| 6 | `streaming-v2` | L | `Topic` отсюда переиспользуют 9 (reloadable) и 11 (InProcessBus) — значит, до волны 4 — **done**, [архив](../../openspec/changes/archive/2026-07-31-streaming-v2/) |

**Волна 3 закрыта** (2026-07-31): оба change'а реализованы и заархивированы.
Волна 4 получает готовыми обе предпосылки, ради которых порядок и был такой:
закрытый контракт отказов (`errors:` + страж границы) и `Topic` из нового
пакета `@nestling/streams` — его переиспользуют `reloadable` конфига (#9) и
`InProcessBus` портов (#11).

### Волна 4 — композиция и модульный монолит

| # | Change | Размер | Почему здесь |
|---|---|---|---|
| 9 | `config-module` | M–L | **done** — [архив](../../openspec/changes/archive/2026-07-31-config-module/); поверх 5 и `Topic` из 6 |
| 10 | `features` | L | **done** — [архив](../../openspec/changes/archive/2026-07-31-features/); `assemble`, фазовый lifecycle, `@OnStart`/go-live, транспорты-провайдеры |
| 18 | `testing-package` (ядро) | M | **done** — [архив](../../openspec/changes/archive/2026-07-31-testing-package/); поставлен **раньше, чем требует граф**: `assembleTest`/`vars()`/`.check()` удешевляют каждый следующий change; `stub(Contract)` и `app.emit` — [остаток в волне 6](#волна-6--экосистема-и-выход) |
| 28 | `policy-check` | S–M | **done** — [архив](../../openspec/changes/archive/2026-07-31-policy-check/); нужен был полный граф — после 8 (дискавери) и 10 (assemble) |
| 13 | `plugins` | S | **done** — [архив](../../openspec/changes/archive/2026-07-31-plugins/); поверх 10 и машинерии 28 |
| 16 | `async-context` | M | **done** — [архив](../../openspec/changes/archive/2026-07-31-async-context/); ридеры `Ctx(Var)` — семейство из 5, предикат `hasVar` — машинерия 28 |

**Волна 4 закрыта** (2026-07-31): все шесть change'ей реализованы и
заархивированы. Composition root зафиксирован (`assemble` с закрытым перечнем
полей), инварианты проверяются на собранном графе, ambient-контекст закрыл
последнюю дыру «глубокому коду нужен `requestId`» без нового примитива.
Волна 5 получает готовыми `Topic` (#6), фазовый lifecycle с go-live (#10),
тестовый корень (#18) и словарь политик (#28) — всё, на что опираются порты.

**Оговорка о BREAKING в аддитивной волне.** Волна 4 объявлена аддитивной,
но change #10 ломает три публичные поверхности сразу: исчезает конструктор
`new App({ transports: Record })` (корень — только `assemble`), исчезает
нульарный `listen()` вместе с точками регистрации ручки на транспорте
(go-live — только `serve(dispatch, signal)`), и поле `transport` декларации
несёт токен вместо строки (`Raw.transport`/`EndpointMeta.transport`
остаются строками — имя выводится из id токена, слои не ломаются). Все три
предписаны целевым design'ом и приезжают одним change'ом, а не
размазываются по волне: после #10 публичный корень зафиксирован.

### Волна 5 — порты и распределённость

| # | Change | Размер | Почему здесь |
|---|---|---|---|
| 11 | `ports` | L | **done** — [архив](../../openspec/changes/archive/2026-07-31-ports/); `makeContract`, `Port`/`Emitter`, `InProcessBus`, dispatch-политики |
| 27 | `port-deadline-idempotency` | M | **done** — [архив](../../openspec/changes/archive/2026-07-31-port-deadline-idempotency/); `meta.deadline` моментом, `idempotencyKey` у команд, конверт шины |
| 26 | `contract-versioning` | S–M | **done** — [архив](../../openspec/changes/archive/2026-07-31-contract-versioning/); снапшот из дискавери, дифф с тремя вердиктами, отчёт в `.check()`-матрице (18) |
| 12 | `transport.nats` | M | **done** — [архив](../../openspec/changes/archive/2026-07-31-transport-nats/); remote-биндинг, queue-groups, JetStream, wire-часть `propagate` из 16; пакет `@nestling/transport.nats` и пример `examples.split-nats` |
| 22 | `contract-clients` | M → **L** | **done** — [архив](../../openspec/changes/archive/2026-08-01-contract-clients/); `@nestling/contracts` (переезд декларативного слоя, секция `http:`, контракт-форма `httpEndpoint`) + `@nestling/client`; оценка M не сошлась: цена не в новой логике, а в физическом переезде слоя между пакетами |

**Волна 5 закрыта** (2026-08-01): все пять change'ей реализованы и
заархивированы. Межфичевое общение выражено контрактом, а не вызовом соседа;
биндинг «local или remote» выбирается на сборке, и `examples.split-nats`
держит один код фич при двух корнях — тезис L4 проверен кодом, а не
обещанием. Контракт стал двусторонним значением: та же декларация адресует
шину именем и HTTP-провод секцией `http:`, и внешний клиент читает её из
zero-deps пакета.

Волна 6 получает готовыми обе предпосылки, которых ей не хватало: bind-карту
на контракте и в декларации (#21 плюс #22) — несущий уровень для генератора
OpenAPI (#20), и порты (#11) — для `stub(Contract)` (#18, остаток) и реестра
подписок (#7).

### Волна 6 — экосистема и выход

| # | Change | Размер | Почему здесь |
|---|---|---|---|
| 20 | `openapi` | M–L | **done** — [архив](../../openspec/changes/archive/2026-08-01-openapi/); все предпосылки закрыты: 19 (конвертеры), 8, 21 (bind-карта), 15 (`errors:`) |
| 25 | `config-secrets` | S | **done** — [архив](../../openspec/changes/archive/2026-08-01-config-secrets/); `secret(from(...))`, три поверхности редактирования, общий ключ и конфликт `reloadable` в границах сборки; ядро не тронуто нигде, кроме `@nestling/config` |
| 18 | `stub(Contract)` + `app.emit` (остаток) | S | **done** — [архив](../../openspec/changes/archive/2026-08-01-testing-stub-contract/); фейк-вызыватель, валидируемый схемами контракта, `app.emit` как драйвер снаружи и `app.stubbed` для сверки с матрицей; ядро не тронуто нигде |
| 7 | `subscriptions-registry` | M | **done** — [архив](../../openspec/changes/archive/2026-08-01-subscriptions-registry/); финальная проверка тезиса состоялась: satellite написан, ядро не тронуто, четыре находки — в журнале |

**Волна 6 закрыта** (2026-08-01), а с ней и план до целевого состояния V1.
Последний change был не про новую способность, а про **проверку**: реестр
подписок — тот самый satellite, на котором проверялся тезис «всё, что требует
стораджа или внешних систем, пишется поверх публичных примитивов, не трогая
ядро» ([ideas.md [2026-07-14]](./ideas.md) «Kernel 1.0», п. 1). Тезис
подтвердился буквально: пять workspace-зависимостей, ноль внешних, ноль
`@nestling/app`, пустой `git diff` по kernel-пакетам. Границы, в которые
пакет упёрся, зафиксированы отчётом, а не заклеены: три известные находки
подтвердились кодом, четвёртая (`.finally` не выполняется у потокового
ответа, закрытого до первого элемента) найдена по ходу и осталась дефектом
ядра под отдельный change — правка ядра здесь обесценила бы сам замер.

### После волны 6

План до целевого состояния V1 закрыт волнами 0–6. Дальнейшие change'и
заводятся по мере находок и в волны не входят.

| # | Change | Размер | Почему |
|---|---|---|---|
| 29 | `input-validation-builtin` | M | **done** — [архив](../../openspec/changes/archive/2026-09-01-input-validation-builtin/); гарантия «хендлер получает проверенный вход» держалась на дисциплине «не забудь `validate()`»; вместе с ней сведены в один два пути исполнения endpoint'а |
| 30 | `remove-module-exports` | S | **done** — [архив](../../openspec/changes/archive/2026-09-01-remove-module-exports/); модуль остаётся меткой принадлежности, границу держат ES-модули |
| 31 | `composition-model` | L | **done** — [архив](../../openspec/changes/archive/2026-09-02-composition-model/); фича, плагин и операция как три роли с разными правилами; граница фичи проверяется на собранном графе, токен стал объектом, `intercom:` назначает роль ссылкой на транспорт |
| 33 | `handler-two-forms` | S–M | **done** — [архив](../../openspec/changes/archive/2026-09-05-handler-two-forms/); объектная форма хендлера нарушала правило «зависимости из контейнера получает класс», не поддерживала `Family.auto` и держала две лишние перегрузки у каждого конструктора деклараций; идёт первым, потому что `layer-fails` меняет те же перегрузки |
| 34 | `layer-fails` | M | **done** — [архив](../../openspec/changes/archive/2026-09-05-layer-fails/); отказ pre-юнита объявлялся на каждом endpoint'е со слоем, забытое объявление давало молчаливый `500`, OpenAPI не показывал `401`; вместе с ним закрываются два шва типа результата: отказы ядра в `Output` и `void` без `output` |
| 35 | `http-transport-boundary` | S | **done** — [архив](../../openspec/changes/archive/2026-09-05-http-transport-boundary/); граница собственного HTTP-транспорта не была записана рядом с кодом, а состав экспортов никто не сверял со списком байтовых частей: аудит нашёл один пробел, satellite-спек его закрыл |
| 36 | `guide-concept-map` | S | **done** — [архив](../../openspec/changes/archive/2026-09-05-guide-concept-map/); проблема была в первом впечатлении от числа понятий, а не в их числе: словарь называется до первого раздела, который его употребляет, а читатель из NestJS видит приложение Б вторым документом |
| 37 | `abort-signal-registry` | S | **done** — [архив](../../openspec/changes/archive/2026-09-05-abort-signal-registry/); профиль показал около 20% сэмплов в `AbortSignal.any` и паузы до 1.8 с: композит копил `WeakRef` на сигнале остановки по числу запросов; реестр контроллеров снял паузы, а замер цены `AsyncLocalStorage` в Node 22 перевёл репозиторий на Node 24 |
| 38 | `hot-path-trim` | S–M | **done** — [архив](../../openspec/changes/archive/2026-09-05-hot-path-trim/); с равными обязанностями Fastify теряет против голого 2%, Nestling отставал на 20% — разрыв давала обвязка запроса, а не гарантии; шесть пунктов по замеру дали +15% на `GET` и +13% на `POST` |
| 39 | `examples-out` | S | **done** — [архив](../../openspec/changes/archive/2026-09-05-examples-out/); `packages/` смешивал публикуемые пакеты с иллюстрациями к гайду, три примера из шести публиковались бы первым же `lerna publish`, а обход каталога опирался на префикс имени там, где хватило бы каталога |
| 40 | `docs-layout-cleanup` | S | **done** — [архив](../../openspec/changes/archive/2026-09-05-docs-layout-cleanup/); сгенерированный HTML лежал в git и давал диффы в двух местах, правила ведения были написаны трижды, таблицы пакетов и глав — тоже; генератор сайта переехал в `scripts/site/`, вывод в `docs/.site/` вне git, приложение В удалено — [ideas.md [2026-09-05] «Структура документации»](./ideas.md), [d/11](../history/discussions/11-docs-structure-and-site.md) |
| 41 | `packaging-cleanup` | S | **done** — [архив](../../openspec/changes/archive/2026-09-05-packaging-cleanup/); опубликованный `@nestling/testing` нёс в `dist` файлы проверки типов и фикстуры, а один из них импортировал `@nestling/transport.http` и `zod` из `devDependencies`: у установившего их нет; сплошная сверка нашла девять расхождений «объявлено ≠ импортируется» у семи пакетов и ещё два в `examples/` |
| 42 | `package-consolidation` | L, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-06-package-consolidation/); восемь пакетов ядра не дают выбора: `pipeline` тянет `container`, `operations` и `streams`, остальные тянут `pipeline` — их ставят вместе; идёт последним, по дереву, очищенному 39 и 41 |
| 43 | `guide-single-file` | S, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-06-guide-single-file/); гайд читают подряд, а отдать его целиком было нельзя: страницы ссылались друг на друга по именам файлов, тема лежала соседними файлами, и копия страницы теряла оформление; подсветка в браузере пропадала везде, где JavaScript не выполняется |
| 44 | `docs-di-token` | S | **done** — [архив](../../openspec/changes/archive/2026-09-07-docs-di-token/); голое «токен» в главе 9 означало то Bearer-токен, то DI-токен через десять строк |
| 45 | `sync-assemble` | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-06-sync-assemble/); фаза 0 из design-дока в коде отсутствовала: источники читала async-фабрика внутри графа, а билдер ждал фабрики вопреки синхронному типу; без снимка до сборки невозможны ни синхронный `check()`, ни переключатели |
| 46 | `resources-and-roles` | L, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-07-resources-and-roles/); проверка `#users \| undefined` в гайде защищала от вызова, который фазы уже исключают; убрать её можно только созданием зависимых после захвата; `@Injectable(token, deps)` смешивал две заботы |
| 47 | `switches` | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-07-switches/); состав по значению из окружения выражался либо непрозрачной фабрикой, либо фичей ради одного провайдера; маленьким сервисам навязывалось понятие фичи, а корень уровня L0 повторял состав одной фичи и записать это можно было только через `makeFeature` |
| 48 | `kernel-logger` | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-06-kernel-logger/); ядро писало тремя каналами, приложения заводили логгер заново, семейство `ILogger` жило только в примере |
| 49 | `http-server` | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-07-http-server/); transports.md противоречил себе про порт, два экземпляра читали один `HTTP_PORT`, а дубликат паттерна ловился на START после захвата ресурсов |
| 50 | `http-handler-form` | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-08-http-handler-form/); `Location` в заголовках `Ok` был HTTP под чужим именем, редирект и cookie не выражались вовсе; юниты, знающие транспорт, не имели правила |
| 51 | `config-derived` | S–M | **done** — [архив](../../openspec/changes/archive/2026-09-07-config-derived/); вычисляемые поля требовали класса-прокси, общий `.env` на несколько сервисов не поддерживался, описания полей не попадали в документацию |
| 52 | `openapi-declaration` | S, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-09-openapi-declaration/); документ для CI собирался тремя строками через `discoverEndpoints` без учёта аргумента сборки; вход генератора — метод декларации `app.discover(args?)`, а не вторая сигнатура `buildOpenApiDocument` |
| 53 | `health` | M | **done** — [архив](../../openspec/changes/archive/2026-09-09-health/); deferred выводил liveness из фазы, а гайд делал пробу endpoint'ом с `detached`; два дизайна жили параллельно |
| 54 | `outbox` | L | **done** — [архив](../../openspec/changes/archive/2026-09-07-outbox/); событие, отправленное соседу, не переживало падение процесса между коммитом и отправкой — дыра в главном обещании модульного монолита; второй мотив — замер границы ядра на задаче тяжелее реестра подписок |
| 55 | `stream-finish` | S | **done** — [архив](../../openspec/changes/archive/2026-09-09-stream-finish/); контракт с транспортом обещал «потребить итератор либо закрыть его», и вторая половина не работала: подписка, закрытая до первого элемента, оставалась в реестре до конца жизни процесса; дефектов нашлось два — второй в `untilAborted`, через которую потоковый ответ читают оба транспорта |
| 56 | `cli-input-prompt` | M | обещание, вынесенное из scope change'а 24 и с тех пор живущее комментарием в коде транспорта, а не строкой плана |
| 57 | `kernel-boundary-outbox` | S–M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-12-kernel-boundary-outbox/); замер границы ядра нашёл четыре места и намеренно не чинил их: правка ядра ради сателлита обесценила бы сам замер, но сами места остались |
| 58 | `docs-package-readmes` | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-09-docs-package-readmes/); README пакетов писались каждый по-своему и повторяли `design/` и гайд, а проверки на них не было ни одной |
| 59 | `docs-guide-recipes` | M | гайд ведёт по пути и одновременно служит справочником: рецепты, которые читают по потребности, мешают читать подряд |
| 60 | `docs-site-sections` | M–L | сайт собирается одним файлом без разделов, поиска и метаданных — читателю негде взять оглавление глубже глав |
| 61 | `docs-publish` | S–M | документация собирается локально и никуда не публикуется |
| 62 | `barrels-by-name` | S | правило про поимённый барель записано, но выполняют его два пакета из восемнадцати |
| 63 | `npm-publish` | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-11-npm-publish/); скоуп `@nestling` в реестре занят чужим аккаунтом, тарбол уносил исходники и конфиги, `LICENSE` не было ни одного при `"license": "MIT"` в каждом манифесте |
| 64 | `agent-skill` | M | **done** — [архив](../../openspec/changes/archive/2026-09-11-agent-skill/); пакеты вышли в реестр, и у фреймворка появились пользователи вне репозитория; агенту в чужом проекте документации нет — в `node_modules` только `dist` и README, а гайд и `design/` остались здесь, на русском, и агент пишет по привычкам NestJS |
| 65 | `trusted-publishing` | S | **done** — [архив](../../openspec/changes/archive/2026-09-12-trusted-publishing/); первый релиз упал на `403`: реестр требует 2FA от любой публикации, а ключ доступа секретом репозитория этого не даёт и в январе 2027 теряет право публиковать вовсе |
| 66 | `skill-setup` | S–M | **done** — [архив](../../openspec/changes/archive/2026-09-12-skill-setup/); скилл давал код, который не проходил ASSEMBLE: сниппеты компилируются по одному и как приложение противоречат друг другу; настройки проекта и HTTP-формы ответа в скилле не было, и агент искал их опытом |
| 67 | `feedback-polish` | S | **done** — [архив](../../openspec/changes/archive/2026-09-12-feedback-polish/); пять мест, о которые первый внешний пользователь споткнулся за час: русские строки в OpenAPI-документе, чужой текст в ошибке `@Component`, JSDoc про несуществующий `Ok.of`, редирект с `transfer-encoding: chunked`, `npm audit` с тремя high по `find-my-way` 8.x |
| 68 | `http-endpoint-two-names` | M, breaking | **done** — [архив](../../openspec/changes/archive/2026-09-12-http-endpoint-two-names/); оценка сошлась: миграция 39 мест механическая, цена оказалась в диагностике — брендирование у хендлера-функции пришлось перенести из слота в возвращаемый тип, потому что в слоте проверка недостижима |
| 69 | `openapi-query-parsed-form` | S–M | **done** — [архив](../../openspec/changes/archive/2026-09-12-openapi-query-parsed-form/); канон `z.stringbool()` для query из записи [2026-08-01] документировался как `type: string`, и генератор клиента делал из булева поля строку |
| 70 | `eslint-deps-sync` | M | список зависимостей повторяет типы конструктора в каждом файле; компилятор ловит расхождение, а чинит его человек |
| 71 | `inbox` | M | outbox превратил «может потеряться» в «может продублироваться», а дедупликация на приёме осталась соглашением: в примере это `Set` в памяти, который живёт до перезапуска и не разделяется репликами |
| 72 | `http-method-constructors` | M, breaking | мотив синтаксический: `httpEndpoint.get('/users/:id', { … })` короче словаря с `method`, а имя `httpEndpoint` после 68 уже несёт статик. Change 68 его не тронул: миграция там 39 мест, здесь ~305, и ни один call site не переезжает дважды |
| 73 | `drizzle-pg` | L | **done** — [архив](../../openspec/changes/archive/2026-09-12-drizzle-pg/); база данных — первая инфраструктура каждого сервиса, а Nestling не давал для неё ничего: пример держал таблицу в памяти, слой транзакции писался руками, адаптер `OutboxStore` был работой приложения; решение — [ideas.md [2026-09-11]](./ideas.md) «Соединение с базой: сателлит `drizzle.pg`» |

Change'и 29–38 ломающие, хотя окно фиксации публичного API закрыто
волной 2. Это осознанно: они правят гарантии, а не добавляют способности,
и цена исправления росла бы с каждым написанным поверх приложением.

Уборка документации идёт пятью волнами. Первые две закрыли
`docs-layout-cleanup` (40) и `docs-package-readmes` (58), остальные три
стоят выше строками 59–61.
Волны 2 и 3 от волны 4 не зависят: генератор сайта правится один раз,
когда структура папок устоялась. Состав каждой — в записи журнала
[[2026-09-05] «Структура документации»](./ideas.md).

### Порядок величины

Грубо: S ≈ одна сессия `apply`, S–M ≈ 1–2, M ≈ 2–3, M–L ≈ 3–4, L ≈ 4–6;
плюс ~0.5 сессии на `propose`.

| Волна | Change'ей | Сессий, порядок величины |
|---|---|---|
| 1 — фундамент контейнера | 2 | ~4 |
| 2 — breaking-окно | 6 | ~12 |
| 3 — семантика ядра | 2 | ~9 |
| 4 — композиция | 6 | ~18 |
| 5 — распределённость | 5 | ~16 |
| 6 — экосистема | 4 | ~9 |

Первые две волны (~16 сессий) дают зафиксированный публичный API — точку,
после которой ничего из написанного не переписывается.

## Как работать

Единица работы — **один change = одна ветка** в своём worktree. Три шага
делает сессия change'а, каждый в **свежем контексте**, четвёртый — сессия
Merger:

| Шаг | Команда | Что ревьюим |
|---|---|---|
| 1. Предложить | `/opsx:propose "<имя>: <scope + non-goals>"` | `proposal.md` (Why / What / Non-goals) и решения `design.md` — 300–700 строк markdown. Самое дешёвое место поймать ошибку дизайна |
| 2. Реализовать | `/opsx:apply <имя>` | `git diff main...` + дельта-спеки. Тесты — доказательство |
| 3. Закрыть | `/opsx:archive <имя>` | статус в таблице выше + абзац в [archlog.md](./archlog.md), ветка передана Merger'у |
| 4. Слить | `/merger` — сессия Merger, не сессия change'а | merge-коммит в `main`, зелёные `yarn verify` и `yarn docs:audit` на `main` |

Контекст между шагами передаётся **файлами в `openspec/changes/<имя>/`**, а не
разговором: `tasks.md` с чекбоксами — точка возобновления, если сессия
прервалась. Поэтому propose и apply намеренно разводятся по разным сессиям:
propose — это диалог с перебором вариантов, и apply, унаследовав его, будет
реализовывать *обсуждённое*, а не *записанное*.

Definition of Done одного change — в [`CLAUDE.md`](../../CLAUDE.md) («Workflow
изменений»), плюс `rules.tasks` в `openspec/config.yaml` заставляет `propose`
класть тот же список последним разделом `tasks.md`. Коротко: задачи отмечены,
`yarn verify` и `yarn docs:audit` зелёные, README пакетов и плашки обновлены,
`design/`+`decisions/` синхронизированы, примеры мигрированы и гайды
пересверены, `main` не тронут.

В `main` пишет только Merger — сессия в главном worktree, которая следит за
worktree change'ей. Заархивированную ветку она сливает merge-коммитом.
Ветку, отставшую от `main`, она сначала просит перебазировать сессию
change'а. Процедура и события скана — в скилле `/merger`
(`.claude/skills/merger/SKILL.md`). Push в origin делает пользователь.
