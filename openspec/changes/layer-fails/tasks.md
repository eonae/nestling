## 1. Типы и рантайм пайплайна (`@nestling/pipeline`)

- [x] 1.1 `core/types/unit.ts`: `PreUnitFn<TInput, TAddition, TFail = never>` — результат `TAddition | TFail | undefined | void` синхронно и в `Promise`
- [x] 1.2 `core/pipeline.ts`: `.pre(unit, { errors })` — проверка списка при вызове (не определение, дубль кода — ошибка с именем юнита); `PipelineTypes.fails`, `Pipeline<TReq, TAcc, TNeeds, TFails = never>`, `AnyPipeline` с `any` в четвёртой позиции; `.ok`/`.catch`/`.finally` сохраняют `TFails`
- [x] 1.3 `ValidatePreUnit`: возвращённый отказ входит в объявленные ∪ отказы ядра, иначе литерал `__error` с полем `undeclared`; `ExtractAddition` берёт `Exclude<Return, AnyFail>`
- [x] 1.4 Значение: `declaredFails: ReadonlySet<AnyFailDefinition>` рядом с `declared`; `compose` объединяет, `bind` и деривация копируют; совпадение по `code`; публичный доступ для `makeEndpoint`
- [x] 1.5 Рантайм: `isFail(result)` после каждого pre-юнита до записи в контекст — переход к ответной фазе тем же путём, что при броске
- [x] 1.6 `makeEndpoint`: эффективное множество `errors:` ∪ `declaredFails` с дедупом по коду — в `EndpointDefinition.errors` и `EndpointMeta.errors`; тип `E` хендлера — `FailsOf<Errors> | TFails`
- [x] 1.7 Рантайм-тесты: возврат объявленного отказа из pre останавливает пайплайн и не пишет поле в `input`; возврат незадекларированного — граница даёт `InternalError`; `throw` как прежде; отказ слоя проходит границу без объявления на endpoint'е; дубль слой/декларация — одно определение; `compose`/`bind`/деривация сохраняют множество
- [x] 1.8 `type-tests`: фикстуры `pre-return-undeclared-fail`, `compose-fails-union` (успешный вывод `TFails`), обновление снапшотов; `yarn workspace @nestling/pipeline type-budget --report` до и после; бенч-граф дополнен объявленными отказами на каждом слое; при сдвиге порогов — строка в `BUDGET.md`

## 2. Тип результата хендлера (`@nestling/operations`)

- [x] 2.1 Экспортировать объединение определений ядра (`KernelFail`: `BadRequest | PayloadTooLarge | Timeout | InternalError`); `OutputSync`/`Output` включают его; `E` по умолчанию остаётся `never`
- [ ] 2.2 `InferOutput<undefined>` даёт `void`; `HandlerFn` без `output` принимает `Promise<void>` и `void`; совместимость `Ok.noContent()`/`new Ok(null)` зафиксирована и описана в README
- [ ] 2.3 Тесты типов (`// @ts-expect-error` и позитивные): `return Timeout()` без `errors:`; `return claimed` после `isFail`; доменный отказ без объявления — ошибка; `async () => {}` без `output`; `() => Ok.noContent()`
- [ ] 2.4 README `operations`: `Output` с отказами ядра, `void` без `output`

## 3. Конструкторы деклараций и форма с операцией

- [x] 3.1 `@nestling/transport.http`: `httpEndpoint({ operation, pipeline })` — условный тип слота `pipeline` (`TFails` ⊆ `OperationFailsOf<C>` ∪ ядро) с литералом `__error`/`undeclared`/`hint`; анонимная форма пропускает `TFails` в эффективное множество; рантайм-проверка при создании декларации с именем операции, слоя и кодов
- [x] 3.2 `@nestling/ports` `implement`: та же проверка; событие без `errors:` отвергает слой с доменными отказами
- [x] 3.3 `@nestling/transport.cli`: `TFails` в эффективное множество
- [x] 3.4 `@nestling/app`: если проверка при создании декларации недостижима для какой-то формы — зеркало на ASSEMBLE; тест сборки
- [x] 3.5 `type-tests` `transport.http`: фикстура `operation-layer-fail-undeclared`; снапшот прочитан: первая строка называет незадекларированный код

## 4. Потребители эффективного множества

- [x] 4.1 `@nestling/openapi`: `responses` по `EndpointDefinition.errors` без пересчёта; тест — слой с `Unauthorized` даёт `401` у endpoint'а без `Unauthorized` в `errors:`; дубль слой/декларация — один ответ
- [x] 4.2 `@nestling/testing`: тип ответа `testApp.call` включает отказы слоя и ядра; тест
- [ ] 4.3 `@nestling/ports`: `PortResult` без изменений; убедиться, что проброс результата порта из хендлера компилируется без каста (пример `create-user`)

## 5. Примеры

- [ ] 5.1 `examples.users-service`: `authed` объявляет `Unauthorized` при подключении `Authenticate`; `DeleteUser`, `CreateUser`, `UpdateUser`, `UploadAvatar` и остальные endpoint'ы со слоем — без `Unauthorized` в `errors:`; операции в `api/operations.ts` его сохраняют; тесты и e2e на `401` без изменений
- [ ] 5.2 `examples.app-with-http`: то же; `create-user` без `as ReturnType<typeof QuotaExceeded>`; подписчики и владельцы команд без `return undefined` и без `eslint-disable`; проверка формы с операцией проходит для всех операций `api/operations.ts`
- [ ] 5.3 `examples.split-nats`: реализации без `return undefined`; проверка `implement` проходит
- [ ] 5.4 `yarn workspace <пример> test` и e2e зелёные; `yarn verify`

## 6. Гайд и README

- [ ] 6.1 Глава 3: фраза о том, что отказы ядра допустимы в `Output` без объявления; таблица «Что проверяется до первого запроса» в README гайда — строки «Отказ pre-юнита объявлен на слое | при компиляции | 9» и «Отказы слоя входят в `errors:` операции | при компиляции | 12»
- [ ] 6.2 Глава 9: объявление на слое `.pre(Authenticate, { errors: [Unauthorized] })`, `Authenticate` возвращает отказ вместо `throw`, `DeleteUser` без `Unauthorized`, абзац о `401` в OpenAPI через `hasLayer`; дата плашки
- [ ] 6.3 Главы 12, 13, 17: операция перечисляет `Unauthorized` как контракт и проверка формы с операцией; подписчики без `return undefined`; даты плашек
- [ ] 6.4 Приложение А: раздел «Отказ броском» становится «Отказ из юнита»: `return` — канон, `throw` — для глубины; таблица форм; приложение В — новые понятия
- [ ] 6.5 README пакетов `pipeline` (второй аргумент `.pre`, `TFails`, канал `return`), `transport.http` и `ports` (проверка формы с операцией), `openapi` (эффективное множество), `testing`; плашки статуса

## 7. Документация и спеки

- [ ] 7.1 `design/pipeline.md` §2–§3, `design/errors.md` §1 и §4, `design/endpoints.md` §2 сверены с реализованным; `docs/glossary.md` — термин «эффективное множество отказов», если понадобился в текстах
- [ ] 7.2 `ideas.md`: пометка «РЕАЛИЗОВАНО» с уточнениями по факту в записях «Отказы слоя» и «`Output<T, E>` допускает отказы ядра»; статус #34 в `roadmap.md`
- [ ] 7.3 `node .claude/skills/docs-style/scripts/lint.mjs` по изменённым текстам — 0

## 8. Definition of Done

- [ ] 8.1 Все задачи выше отмечены
- [ ] 8.2 `yarn verify` зелёный (build + typecheck + lint + test + type-budget)
- [ ] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 8.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [ ] 8.5 `yarn docs:audit` — 0 ERROR
- [ ] 8.6 Примеры мигрированы, гайды пересверены с обновлённой датой в плашке «сверено с кодом»
- [ ] 8.7 Линтер стиля по изменённым текстам — 0 запрещённых слов
- [ ] 8.8 Коммиты осмысленные, ветка запушена
