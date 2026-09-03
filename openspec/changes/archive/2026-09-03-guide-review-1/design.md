# guide-review-1 — design

## Context

Три подсистемы, которые трогает change, реализованы и покрыты спеками:
composition root (`@nestling/app`, `@nestling/testing`), модель ошибок
(`@nestling/operations`, проверка границы в `@nestling/pipeline`, карта
статусов в `@nestling/transport.http`, восстановление `Fail` из ответа в
`@nestling/ports` и `@nestling/client`, группировка ответов в
`@nestling/openapi`) и формы хендлера (`makeEndpoint` в
`@nestling/pipeline`, `implement` в `@nestling/operations`, получение
зависимостей в `App`). Гайд из 24 глав сверен с примерами, а превью
`docs/preview` собирается из четырёх отдельных markdown-страниц, которые
дублируют содержание дизайна и гайда.

Целевое состояние уже записано: `docs/design/composition.md`, `errors.md`,
`endpoints.md`, `testing.md`, `transports.md` и глоссарий синхронизированы с
записями `ideas.md` от 2026-09-03; `docs/conventions.md` задаёт правила
именования, по которым пишутся гайд и примеры. Этот документ описывает, как
довести код, примеры, гайд и превью до записанного состояния.

Ограничения: обратной совместимости нет, старое API удаляется целиком;
`yarn verify` включает бюджет типов (`type-budget`), поэтому новые типы
`Output` и `handler` не должны ухудшать диагностику `compose`; стиль
текстов — `/docs-style`, имена — `conventions.md`.

## Goals / Non-Goals

**Goals:**

- `makeApp(spec)` → `App` (декларация) → `app.assemble(select?)` →
  `AssembledApp` (`run`, `close`); `app.check(select?, options?)`;
  `assembleTest(app, options)`; `checkTopologies(app, selections, options?)`.
- Отказ с одной осью `code` формата `category[:detail…]`; `makeFail`;
  производное `category`; отказы ядра голой категорией; нижний регистр
  статусов успеха и категорий на всех носителях.
- Поле `handler` с тремя формами; endpoint регистрирует класс-хендлер;
  `meta.fail` удалён; `Output<T, typeof Def>`.
- Заголовки `Ok` определены для каждого транспорта.
- Гайд переписан по ревью; пример `users-service` следует гайду и
  `conventions.md`; превью собирается из гайда.

**Non-Goals:**

- `httpEndpoint.get(path, …)`, пересмотр политик, `header()`, RFC 9457,
  слот описания полей конфига, переименование `detached`/`doc.hidden`
  (см. proposal).
- Новые главы гайда сверх главы «Хендлер как класс»; главы 6–24 меняются
  только там, где их трогает новый API и сдвиг нумерации.

## Decisions

### D1. `makeApp` возвращает брендированную декларацию; `assemble` — план, `run` — фазы

`makeApp(spec): App`. `App` — объект с symbol-брендом, полем `spec`
(нормализованный словарь без `select`) и методами `assemble(select?)` и
`check(select?, options?)`. Проверки при создании — те же, что сегодня
делает `makePlan` до выбора: бренды фич и плагинов, дубли имён, закрытый
перечень полей.

`assemble(select?)` синхронна: она вызывает `makePlan(spec, select)` и
возвращает `new AssembledApp(plan)`. Класс `App` из `@nestling/app`
переименовывается в `AssembledApp`; его конструктор по-прежнему принимает
неэкспортируемый план, поэтому `new AssembledApp({ … })` невыразим.
`run()` и `close()` не меняются. Ошибки выбора (неизвестное имя, пустой
выбор, `select` без `features`) остаются ошибками фазы ASSEMBLE и
бросаются из `run()`/`check()`, а не из `assemble()`: `assemble` ничего не
читает и не проверяет сверх формы аргумента.

Альтернатива «`assemble` асинхронна и строит граф, `run` продолжает с фазы
2» отвергнута: она удваивает публичную модель фаз и ломает `await using`
в тестах, где сборка и разрушение должны идти парой.

### D2. `check` живёт на декларации

`app.check(select?, options?)` = `makePlan(spec, select)` + текущий
`#assemble()` без сохранения графа. Метод `check()` с `AssembledApp`
удаляется: два пути к одному отчёту противоречат правилу одной формы.
`checkTopologies(app, selections, options?)` вызывает `app.check(select,
options)` для каждой топологии. Отчёт `CheckReport` не меняется.

### D3. Тестовый корень принимает декларацию

`assembleTest(app, options?)`, где `options = { select?, overrides?,
stubs?, config?, contextValue? }`. Поле `config` теста **заменяет**
привязку декларации, а не дополняет её: тест изолирован от источников
приложения так же, как от `process.env`. Политики берутся из декларации;
поля `policies` в опциях нет. `TestApp` не переименовывается.

Список `transports` в опциях теста не принимается: тестовая сборка не
выполняет START, сокеты не открываются, подмена `http({ port: 0 })` в
примерах удаляется.

Переменная тестового приложения в гайде и примерах называется `testApp`,
чтобы не затенять `app` из `app.ts`.

### D4. Код отказа: тип, проверка, производная категория

```typescript
export const categories = ['bad_request', 'unauthorized', 'payment_required',
  'forbidden', 'not_found', 'conflict', 'payload_too_large',
  'too_many_requests', 'internal_error', 'not_implemented',
  'service_unavailable', 'timeout'] as const;
export type Category = (typeof categories)[number];
export type FailCode = Category | `${Category}:${string}`;
```

`makeFail<TCode extends FailCode, S>(code: TCode, options?: { details?: S;
message?: string | ((d) => string) })`. Компилятор проверяет категорию
шаблонным литералом; рантайм в `makeFail` проверяет каждый сегмент по
`^[a-z_]+$` и бросает ошибку с кодом и позицией сегмента.

`Fail<TCode>` теряет `status` и получает `get category(): Category` —
первый сегмент `code`. `code` становится обязательным: анонимные
конструкторы `Fail.notFound(message)` и им подобные создают отказ с кодом,
равным категории. `ErrorDetails` — `{ code, message, details?, requestId? }`;
`status` из тела ответа и из `ResponseContext` отказа уходит, категория
восстанавливается из кода везде, где сегодня читается `status`.

Статусы успеха: `successStatuses = ['ok', 'created', 'accepted',
'no_content']`; `ProcessingStatus = SuccessStatus | Category`. Поле
`status` контекста ответа для отказа равно `fail.category`. `Ok.created`,
`Ok.accepted`, `Ok.noContent`, `doc.status` и все снапшоты переходят на
нижний регистр.

### D5. Отказы ядра

Четыре определения в `@nestling/pipeline`: `BadRequest`
(`makeFail('bad_request', { details: issuesSchema })`), `PayloadTooLarge`
(`details: { limit }`), `Timeout`, `InternalError`. Их порождают: проверка
входа и разбор multipart → `BadRequest`; лимит тела, файла, строки NDJSON и
`.limit(n)` item-цепочки → `PayloadTooLarge`; `.gapTimeout(ms)` и бюджет
вызова портов → `Timeout`; проверка границы → `InternalError`.
`@nestling/ports` реэкспортирует `Timeout` вместо `DeadlineExceeded`.

Множество допустимых отказов границы: `E ∪ {bad_request, payload_too_large,
timeout, internal_error}` по коду. Пользовательское `makeFail('bad_request')`
проходит проверка границы как тот же отказ. Хук `onUnknownFail` сохраняет имя.

### D6. Транспорты, порты, клиент, OpenAPI читают категорию

- `@nestling/transport.http`: `STATUS_MAP` переключается на `Category`;
  ответ отказа берёт HTTP-код из `fail.category`. Заголовки `Ok.headers`
  пишутся в ответ как есть, после заголовков, которые ставит транспорт по
  форме io.
- `@nestling/transport.nats`: конверт ответа несёт `code`; `Ok.headers`
  кладутся в заголовки ответного сообщения (`nats` headers API).
- `@nestling/transport.cli`: `Ok.headers` игнорируются; категория в код
  выхода не транслируется (как сегодня).
- `@nestling/ports` и `@nestling/client`: восстановление `Fail` из ответа по `code`
  через определение из `errors:`; `category` — производная, отдельного
  переноса нет. Незадекларированный код → `InternalError`.
- `@nestling/openapi`: ответы группируются по `category` → HTTP-код,
  несколько отказов одной категории — `oneOf` по схемам деталей, как
  сегодня по статусу. `default` описывает `InternalError`.

### D7. Поле `handler` и регистрация класса-хендлера

Словарь декларации: `handler: HandlerFn | { deps: readonly Token[];
handle: CurriedHandler } | HandlerClass`. `makeEndpoint` различает формы
по типу значения: функция, объект с `deps`, класс. Поля `deps` и `handle`
на верхнем уровне словаря удаляются; попадание туда любого из них — ошибка
типов и рантайма при создании декларации.

Класс-хендлер регистрирует endpoint. Discovery, обходя декларации единицы,
собирает классы из `handler` и добавляет `classProvider(Class, Class)` в
регистрацию модуля-объявителя (для фичи и плагина с `providers:` — в их
синтетический модуль; с `modules:` — в модуль, где перечислен endpoint,
иначе в первый модуль единицы). Тот же класс, найденный в `providers:`
любого модуля, — ошибка ASSEMBLE, называющая класс, endpoint и модуль.
Два endpoint'а с одним классом-хендлером делят один экземпляр: класс —
токен, провайдер регистрируется один раз.

Граница фичи не меняется: класс принадлежит единице, объявившей endpoint,
и инжектировать его из другой фичи нельзя тем же правилом, что и любой
провайдер.

Тип неразрешённых зависимостей накапливает `handler.deps` и класс, как
сегодня `deps` и `handle`-класс; `resolve` и `server.route` не меняются
сверх имени поля.

### D8. `meta` без `fail`; `Output` принимает определения

Из инъекции `meta` удаляется `fail`; тип `meta` — `{ signal } & Ctx`.
Правило «свой бросают, чужой возвращают» из документации снимается: канон
`return`, `throw` — доставка. Рантайм-нормализация брошенного отказа не
меняется.

```typescript
type FailOfDef<D> = D extends FailDefinition<infer C, infer S> ? Fail<C, S> : D;
export type Output<T, E extends FailDefinition | Fail = never> =
  Promise<Ok<T> | T | FailOfDef<E>>;
```

`FailOf` остаётся внутренним типом пакета. Сверка возвращаемого типа с
`errors:` в точке декларации не меняется. Бюджет типов проверяется
существующим бенчмарком.

### D9. Гайд: карта глав и изменения примера

| Было | Стало |
|---|---|
| 1 Поднять сервис (`GET /health`) | 1 Поднять сервис (`GET /users` с двумя пользователями в коде) |
| 2 Принять данные | 2 Принять данные (+ раздел про `query()`/`body()` на `ImportUsers?dryRun=true`) |
| 3 Сказать клиенту (defineFail, status) | 3 Сказать клиенту (`makeFail`, код с категорией, таблица категорий, канон `return`, заголовки `Ok` транспортно-независимы, без DI) |
| — | 4 Хендлер как класс (`@Injectable()` без зависимостей, `handler: Class`, фреймворк создаёт экземпляр) |
| 4 Хендлеру нужен репозиторий | 5 Откуда хендлер берёт репозиторий (токен → интерфейс → `providers` → зависимости зависимостей, `@OnInit` → раздел «функция с `deps` и значения-провайдеры») |
| 5 Конфиг | 6 Конфиг (+ `.describe()` у полей, таблица переменных) |
| 6–24 | 7–25, ссылки и плашки обновлены |

Пример `users-service`: `CheckHealth` в `src/ops.plugin.ts`
(`makePlugin({ name: 'ops', endpoints: [CheckHealth] })`); все хендлеры —
классы `<Имя>Handler` в файлах endpoint'ов; `NewUser` → `CreateUserInput`,
репозиторий принимает `Omit<User, 'id'>`; `app.ts` экспортирует `app =
makeApp({…})`, `main.ts` — `app.assemble().run()`; тесты —
`assembleTest(app, {…})` с переменной `testApp`; `ImportUsers` получает
`dryRun` через `bind: { dryRun: query() }`; поля `AppConfig` с
`.describe()`. Остальные примеры мигрируются механически.

Приложение А: раздел «класс-хендлер» становится разделом «функция с
`deps`», раздел `meta.fail` удаляется, `throw` описан там же. Приложение
Б и В, README гайда и глоссарий обновляются под новую нумерацию.

### D10. Превью собирается из гайда

`scripts/preview/build.mjs` читает `docs/guide/README.md` и главы:

- Группы навигации — заголовки `## Часть N. …` и `## Приложения` из
  README; страницы — строки таблиц под ними (ссылка → slug, первая ячейка
  → заголовок). Стартовая страница `index.html` — сам README.
- Каждая глава — отдельная страница `<slug>.html`; сайдбар: группа
  открытой страницы раскрыта, подпункты — `##`-заголовки главы; пейджер —
  предыдущая и следующая глава по порядку README.
- Ссылки `./NN-имя.md` переписываются в `NN-имя.html`; ссылки в другие
  папки `docs/` остаются относительными: `guide/` и `preview/` — соседи,
  путь одинаков.
- Блок кода с первой строкой-комментарием `// путь` получает `data-file`
  из этого комментария; строка из кода не удаляется.
- `yarn docs:preview --watch` следит за `docs/guide`. Каталог
  `docs/preview/src` сокращается до `layout.html`; `nav.mjs` удаляется,
  четыре старых `*.md` переезжают в `docs/history/superseded/preview/`.
- Проверка сборки: скрипт падает, если ссылка `./*.md` не ведёт на
  существующую главу или глава из README не найдена.

### D11. Спеки

Двадцать дельта-спек по proposal. Побочные упоминания старых имён в
остальных спеках (`assemble(`, `handle:`, `deps:`, `UnknownError`,
`UNKNOWN`, `VALIDATION_FAILED`, `DEADLINE_EXCEEDED`, `STREAM_*`,
`'CREATED'`) правятся прямой заменой в `openspec/specs` при apply, без
дельт: требования там не меняются, меняется имя в сценарии.

## Risks / Trade-offs

- [Тип `Output` с определениями раздувает диагностику] → условный тип
  один и плоский; бенчмарк `type-budget` в `yarn verify` ловит регресс.
- [Регистрация класса-хендлера endpoint'ом скрывает провайдер от
  читателя графа] → провайдер получает атрибуцию к модулю-объявителю, узел
  виден в `explain()` и отчёте `check()` как обычный.
- [Нижний регистр статусов ломает снапшоты и клиентов] → пользователей
  нет; все снапшоты в репозитории пересобираются одним прогоном.
- [Сдвиг нумерации глав ломает внешние ссылки] → ссылки в репозитории
  проверяет `docs:audit`; внешних потребителей нет.
- [Заголовки ответа NATS зависят от клиента `nats`] → API заголовков в
  библиотеке есть; при отсутствии поддержки у брокера заголовки
  отбрасываются с предупреждением при старте.
- [Один change на четыре темы велик] → порядок работ в tasks.md идёт от
  ядра к документации; каждый раздел проверяется `yarn verify` отдельно,
  ветка коммитится по разделам.

## Migration Plan

Совместимости нет, старое API удаляется. Порядок: `operations` →
`pipeline` → `transport.http`, `transport.nats`, `transport.cli`, `ports`,
`client`, `openapi`, `streams`, `subscriptions` → `app`, `testing`,
`eslint-plugin` → примеры → гайд и `conventions.md` → превью → спеки и
README пакетов. После каждого блока — `yarn verify`.

## Open Questions

- Сопоставление по категории в `.catch`-юнитах: `fail.category ===
  'conflict'` или предикат на значении категории. По умолчанию — сравнение
  поля; предикат добавляется, если в примерах он понадобится дважды.
- Анонимные конструкторы `Fail.badRequest(message)`: оставить как сокращённую запись с
  кодом-категорией или удалить ради одной формы. По умолчанию — оставить;
  в гайде не показывать.
- Нужны ли `sub`-пункты сайдбара глубже `##` для длинных глав.
