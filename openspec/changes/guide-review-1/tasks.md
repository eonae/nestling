## 1. Модель ошибок: `@nestling/operations`

- [x] 1.1 `categories`/`Category`/`FailCode` в `status.ts`; `successStatuses` в нижнем регистре; `ProcessingStatus = SuccessStatus | Category`; `ErrorStatus` удалён
- [x] 1.2 `Fail`: обязательный `code: FailCode`, производное `category`, поле `status` удалено; анонимные конструкторы `Fail.<category>(message)` дают код-категорию; `ErrorDetails` без `status`
- [x] 1.3 `makeFail(code, { details?, message? })` вместо `defineFail`: проверка категории типом, сегментов рантаймом; определение несёт `code`, `category`, `schema`, `is`; `FailOf` не экспортируется
- [x] 1.4 `Ok`: статусы `ok`/`created`/`accepted`/`no_content`; `Output<T, E>` принимает определения (`FailOfDef`), тесты типов
- [x] 1.5 Рантайм-тесты: формат кода, идентичность по коду, категория из кода, сериализация тела ответа

## 2. Ядро пайплайна: `@nestling/pipeline`

- [x] 2.1 Отказы ядра `BadRequest`, `PayloadTooLarge`, `Timeout`, `InternalError`; удалены `ValidationFailed`, `StreamLimitExceeded`, `StreamGapTimeout`, `DeadlineExceeded`, `UnknownError`; закрытый набор границы по кодам
- [x] 2.2 Проверка границы нормализует в `InternalError`; пользовательское определение с кодом-категорией ядра проходит; хук `onUnknownFail` сохранён; рантайм-тесты
- [x] 2.3 `meta` без `fail`: инъекция и типы; тесты на отсутствие ключа
- [x] 2.4 `makeEndpoint`: поле `handler` трёх форм, поля `deps`/`handle` отвергаются типом и рантаймом; `resolve` читает `handler.deps`; параметр неразрешённых зависимостей; тесты типов и рантайма
- [x] 2.5 Проверка входа отвечает `BadRequest` (`bad_request`); `ErrorStatus` в контексте ответа заменён категорией
- [x] 2.6 Бюджет типов `type-budget` не ухудшен (бенчмарк в `yarn verify`)

## 3. Транспорты, порты, клиент, документация

- [ ] 3.1 `@nestling/transport.http`: `STATUS_MAP` по `Category`; ответ отказа берёт код из `fail.category`; `Ok.headers` пишутся в ответ; тесты e2e на 404/409/413/504 и на заголовки
- [ ] 3.2 `@nestling/transport.nats`: конверт ответа без `status`; `Ok.headers` в заголовки ответного сообщения; тесты
- [ ] 3.3 `@nestling/transport.cli`: `Ok.headers` отбрасываются; тест
- [ ] 3.4 `@nestling/streams`: лимит → `PayloadTooLarge`, `gapTimeout` → `Timeout`; тесты
- [ ] 3.5 `@nestling/ports`: `Timeout` вместо `DeadlineExceeded`; восстановление `Fail` из ответа по коду с производной категорией; `InternalError`; тесты
- [ ] 3.6 `@nestling/client`: восстановление `Fail` из ответа, `E ∪ InternalError`; тесты
- [ ] 3.7 `@nestling/openapi`: ответы по категории → HTTP-код, `oneOf` для нескольких отказов одной категории, `default` — `InternalError`, `doc.status` в нижнем регистре; снапшоты документа пересобраны
- [ ] 3.8 `@nestling/operations` `implement(Operation, { pipeline?, handler, subscriber?, detached? })`; `@nestling/subscriptions` и `@nestling/eslint-plugin` приведены к `handler`

## 4. Composition root: `@nestling/app`, `@nestling/testing`

- [x] 4.1 `makeApp(spec): App` — брендированная декларация, проверки при создании, закрытый перечень полей без `select`
- [x] 4.2 `App.assemble(select?): AssembledApp` (синхронно, без чтения); класс `App` переименован в `AssembledApp` с `run()`/`close()`; `check` у `AssembledApp` удалён
- [x] 4.3 `App.check(select?, options?)`; отчёт без изменений; тесты матрицы
- [x] 4.4 Discovery регистрирует класс-хендлер из `handler` провайдером модуля-объявителя; повторная регистрация в `providers:` — ошибка ASSEMBLE с классом, паттерном и модулем; два endpoint'а делят экземпляр; тесты
- [x] 4.5 `assembleTest(app, { select?, overrides?, stubs?, config?, contextValue? })`: состав и политики из декларации, `config` теста заменяет привязку, `transports` не принимается; тесты
- [x] 4.6 `checkTopologies(app, selections, options?)`; `snapshotOperations` из отчётов; тесты
- [ ] 4.7 README `@nestling/app`, `@nestling/testing`, `@nestling/operations`, `@nestling/pipeline`, транспортов, `ports`, `client`, `openapi`, `streams` — API и плашки статуса

## 5. Примеры

- [x] 5.1 `examples.users-service`: `app.ts` экспортирует `app = makeApp({…})`, `main.ts` — `app.assemble().run()`; `CheckHealth` в `src/ops.plugin.ts`; все хендлеры — классы `<Имя>Handler`; `NewUser` → `CreateUserInput`, репозиторий принимает `Omit<User, 'id'>`; `makeFail` с кодами `not_found:user`, `conflict:email_taken`, `unauthorized`, `bad_request:avatar_required`; `ImportUsers` с `bind: { dryRun: query() }`; `.describe()` у полей `AppConfig`; тесты через `assembleTest(app, …)` с `testApp`, без `http({ port: 0 })`
- [x] 5.2 `examples.app-with-http`, `examples.split-nats`: `makeApp`/`assemble(select)`, `handler`, `makeFail`, коды, `checkTopologies(app, …)`; раздел `meta.fail` в `update-user.endpoint.ts` переписан на `return`
- [x] 5.3 `examples.simple-cli`, `examples.simple-http-server`, `examples.container`: миграция имён
- [ ] 5.4 `yarn verify` зелёный по всем пакетам

## 6. Гайд

- [ ] 6.1 Глава 1: `GET /users` с двумя пользователями в коде, `makeApp` → `app.assemble().run()`, конвенция `app.ts`/`main.ts`; без `detached`, `doc`, политик
- [ ] 6.2 Глава 2: `CreateUserInput`, раздел «Пометка места» с `query()` и `body()` на `ImportUsers?dryRun=true`
- [ ] 6.3 Глава 3: `makeFail`, таблица категорий с HTTP-кодами, канон `return` и одна фраза про `throw`, заголовки `Ok` как транспортно-независимые метаданные, без зависимостей в сниппетах
- [ ] 6.4 Новая глава 4 «Хендлер как класс»: `@Injectable()` без зависимостей, `handler: Class`, экземпляр создаёт фреймворк, юнит-тест через `new`
- [ ] 6.5 Глава 5 (бывшая 4) «Откуда хендлер берёт репозиторий»: токен → интерфейс и `makeToken` → `providers` → зависимость зависимости и `@OnInit` → раздел «функция с `deps` и значения-провайдеры» (`valueProvider`, `factoryProvider`, ограничение «зависимости зависимостей»)
- [ ] 6.6 Глава 6 (бывшая 5): `.describe()` у полей, таблица переменных с описаниями, `assembleTest(app, { config: vars(…) })`
- [ ] 6.7 Главы 7–25: перенумерация файлов и ссылок, `makeApp`/`assembleTest(app, …)`/`testApp`, `handler`, `makeFail`, коды с категориями, `InternalError`, `check(select)`; глава «Без `assemble`» переименована
- [ ] 6.8 Приложение А: раздел «класс-хендлер» заменён разделом «функция с `deps`», раздел `meta.fail` удалён, `throw` описан в разделе «Отказ броском», таблица форм обновлена; приложения Б и В, README гайда — новая нумерация и состав
- [ ] 6.9 `docs/conventions.md` сверен с примером; плашки «сверено с кодом» всех глав с датой; линтер `docs-style` по всем главам — 0

## 7. Превью из гайда

- [ ] 7.1 `scripts/preview/build.mjs`: источники — `docs/guide/README.md` и главы; страницы, навигация из частей README, пейджер, переписывание ссылок `./*.md`, подпись `data-file` из первой строки-комментария; ошибки на рассинхрон README и глав и на битые ссылки
- [ ] 7.2 `docs/preview/src`: остаётся `layout.html`; `nav.mjs` удалён; `index.md`, `concepts.md`, `fundamentals.md`, `scaling.md` перенесены в `docs/history/superseded/preview/`; `docs/preview/README.md` и `src/README.md` обновлены
- [ ] 7.3 `yarn docs:preview` собирает 25 глав, 3 приложения и `index.html`; `--watch` следит за `docs/guide`; результат просмотрен в браузере
- [ ] 7.4 `docs/README.md` и `CLAUDE.md`: строка карты про `preview/` («собирается из `guide/`»)

## 8. Документация и спеки

- [ ] 8.1 `docs/design/*` и `docs/glossary.md` перепроверены по реализованному API (плашки, `handler.deps`, `InternalError`, `testApp`); `docs:audit` — 0 ERROR
- [ ] 8.2 Прямая замена старых имён в спеках с побочными упоминаниями (`context-readers`, `contract-declarations`, `contract-stubs`, `contracts-package-boundary`, `dispatch-guarantee`, `durable-delivery`, `endpoint-detached-optout`, `error-response-safety`, `http-streaming-framing`, `io-forms`, `message-bus`, `nats-transport`, `pipeline-phase-model`, `port-invocation`, `standard-schema-validation`, `testing-subpath-convention`, `transport-providers`): `assemble(` → `makeApp(…).assemble(`, `handle:`/`deps:` → `handler`, `UnknownError` → `InternalError`, коды ядра → категории, статусы в нижнем регистре
- [ ] 8.3 Запись «РЕАЛИЗОВАНО» в трёх записях `ideas.md` от 2026-09-03; статус в `roadmap.md`

## 9. Definition of Done

- [ ] 9.1 Все задачи выше отмечены
- [ ] 9.2 `yarn verify` зелёный (build + typecheck + lint + test + type-budget)
- [ ] 9.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 9.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [ ] 9.5 `yarn docs:audit` — 0 ERROR
- [ ] 9.6 Примеры мигрированы, гайды пересверены с обновлённой датой в плашке «сверено с кодом»
- [ ] 9.7 Линтер стиля по изменённым текстам — 0 запрещённых слов
- [ ] 9.8 Коммиты осмысленные, ветка запушена
