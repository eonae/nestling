## 1. Ядро: `@nestlingjs/operations`

- [ ] 1.1 `src/status.ts`: тип объявления `DeclaredStatus =
      SuccessStatus | readonly SuccessStatus[]`, нормализация одиночной
      формы в кортеж и `assertDeclaredStatus(value, where)` с проверками
      «пустой список», «повтор», «статус вне словаря» (тексты ошибок
      называют декларацию, поле и допустимые значения)
- [ ] 1.2 `src/result.ts`: `Ok<TValue, TStatus extends SuccessStatus = 'ok'>`;
      `new Ok(value)` даёт `Ok<T, 'ok'>`, `new Ok('created', value)` —
      `Ok<T, 'created'>` (литерал выводится тип-параметром перегрузки),
      `Ok.created`/`Ok.accepted`/`Ok.noContent` возвращают уточнённый тип
- [ ] 1.3 `src/output.ts`: `OutputSync<TValue, E, S>` и `Output<TValue, E, S>`
      допускают `Ok<TValue, S>`; голое значение `TValue` допустимо, только
      когда `S` — ровно один статус, иначе `never` (юнион проверяется
      недистрибутивно)
- [ ] 1.4 `src/doc.ts`: удалить `status` из `DeclarationDoc`, из `DOC_FIELDS`
      и из `assertDoc`; текст ошибки неизвестного поля называет поле
      `status` верхнего уровня словаря
- [ ] 1.5 `src/operation.ts`: поле `status` у `makeRequest`; `makeCommand` и
      `makeEvent` отвергают его с текстом «у операции нет ответа»; проверка
      «только `no_content` при объявленном `output`»; тип результата
      реализации выводится из объявленного множества
- [ ] 1.6 Рантайм-спеки `result.spec.ts` и `operation.spec.ts`: все сценарии
      проверок объявления из спеки `declared-success-status`
- [ ] 1.7 Тип-тесты: `Ok.created` вне объявленного множества, голое значение
      при нескольких статусах, `Ok<User,'created'>` не присваивается
      `Ok<User,'ok'>`

## 2. Ядро: `@nestlingjs/app`

- [ ] 2.1 `pipeline/metadata/endpoint.ts`: поле `status` в `EndpointOptions`,
      нормализованное множество на `EndpointDefinition`, перенос при
      `resolve`; проверка объявления в `makeEndpoint`
- [ ] 2.2 `pipeline/core/types/endpoint.ts`: `HandlerFn` и
      `CheckedHandlerFn` выводят объявленное множество статусов и передают
      его в `Output`
- [ ] 2.3 `pipeline/core/pipeline.ts`, `normalizeResponse`: голое значение
      получает объявленный статус вместо сегодняшнего `'ok'`; `Ok` отдаёт
      свой статус
- [ ] 2.4 Граница: `Ok` со статусом вне объявленного множества заменяется на
      `internal_error` — рядом с `enforceDeclaredFails`, тем же механизмом
      и с текстом, называющим объявленные статусы
- [ ] 2.5 Рантайм-тесты пайплайна: подстановка умолчания (`ok` при `output`,
      `no_content` без него), подстановка объявленного статуса голому
      значению, замена статуса вне множества на `internal_error`
- [ ] 2.6 Тип-тесты декларации: `status` в словаре `httpEndpoint.*`,
      диагностика при статусе вне множества

## 3. Транспорты

- [ ] 3.1 `@nestlingjs/transport.http`: проверка «`status` рядом с
      `redirect`» при создании HTTP-декларации (`assertRedirect` в
      `binding.ts` — там же, где сегодня отвергается редирект с потоком)
- [ ] 3.2 Интеграционные тесты транспорта: 201 у endpoint'а со `status:
      'created'`, 204 у endpoint'а без `output`, 200 и 201 у endpoint'а с двумя
      объявленными статусами
- [ ] 3.3 `@nestlingjs/transport.nats` и `@nestlingjs/transport.cli`:
      убедиться, что статус переносится как есть, и покрыть тестом ответ со
      статусом, отличным от `ok`

## 4. Документ: `@nestlingjs/openapi`

- [ ] 4.1 `src/responses.ts`: `planSuccess` возвращает список пар «код —
      ответ» по объявленному множеству; `no_content` печатается без
      `content`; коды по-прежнему через `httpCodeOf`
- [ ] 4.2 Тесты `document.spec.ts`: два успешных ответа у endpoint'а с двумя
      статусами, 204 без `content`, умолчания без поля `status`

## 5. Клиент: `@nestlingjs/client`

- [ ] 5.1 `src/response.ts`: `readSuccess` принимает объявленное множество,
      возвращает `Ok` с пришедшим статусом и отдаёт `InternalError`, когда
      код вне множества
- [ ] 5.2 `src/client.ts`: объявленное множество берётся с операции и
      попадает в разбор ответа; тип результата вызова — `Ok<T, S>` по
      объявлению
- [ ] 5.3 Тесты `client.spec.ts` и `client.types.spec.ts`: идемпотентное
      создание (200 и 201), код вне множества, 204 у операции без `output`

## 6. Примеры

- [ ] 6.1 `examples/microservice/src/api/operations.ts`: `CreateUser`
      объявляет `status: ['ok', 'created']` вместо `doc: { status }` —
      ветка `dryRun` перестаёт расходиться с документом
- [ ] 6.2 `examples/microservice/src/users/endpoints/create-user.endpoint.ts`:
      ветка `dryRun` возвращает `new Ok(user)`, ветка записи —
      `Ok.created(user)`
- [ ] 6.3 `delete-user.endpoint.ts` и `ops/subscriptions.endpoint.ts`:
      `status: 'no_content'` полем декларации вместо секции `doc`
- [ ] 6.4 `yarn test` примера зелёный; спеки, проверяющие статус ответа,
      обновлены

## 7. Документация

- [ ] 7.1 `docs/design/endpoints.md`: поле `status` в словаре декларации,
      умолчание, множество статусов, связь с типом результата; `doc.status`
      уходит из описания секции `doc`
- [ ] 7.2 `docs/design/errors.md`: `Ok<TValue, TStatus>` и правило выбора
      статуса хендлером
- [ ] 7.3 `docs/design/operations.md`: поле `status` у `makeRequest`, его
      отсутствие у команды и события
- [ ] 7.4 Английские пары 7.1–7.3 в `docs/en/design/` (инвариант
      `lang-parity`)
- [ ] 7.5 Главы гайда `06-repository.md`, `08-testing.md`, `10-auth.md`,
      `11-database.md`, `13-openapi-and-client.md` и их английские пары:
      объявление статуса, плашка «сверено с кодом» с новым хэшем и датой
- [ ] 7.6 `docs/recipes/ops.md`, `docs/recipes/alternatives.md` и
      английские пары
- [ ] 7.7 README пакетов `nestling.operations` и `nestling.transport.http`
      (обе языковые половины), включая плашки статуса
- [ ] 7.8 `node .claude/skills/docs-style/scripts/lint.mjs` по всем
      изменённым текстовым файлам — 0 запрещённых слов

## 8. Решение зафиксировано

- [ ] 8.1 `docs/decisions/deferred.md`, запись `[2026-08-01]`
      «Типизированный успешный статус декларации»: пометка «**РЕАЛИЗОВАНО
      \<дата\>** — change `typed-success-status` (#84 roadmap)» с тем, что
      вышло целиком, и чем реализация уточнила решение — множество
      статусов вместо одного и сверка на границе
- [ ] 8.2 Открытый вопрос дизайна (политика `check()` на декларацию, где
      объявлено больше статусов, чем возвращает хендлер) записать в
      `deferred.md` отдельной записью с триггером возврата
- [ ] 8.3 После `/opsx:archive`: строка 84 в `docs/decisions/roadmap.md` —
      статус **done** со ссылкой на архив

## 9. Definition of Done

- [ ] 9.1 Все задачи выше отмечены
- [ ] 9.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` +
      `type-budget` по всем пакетам)
- [ ] 9.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 9.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md;
      запись журнала, по которой шёл change, несёт пометку «РЕАЛИЗОВАНО»
- [ ] 9.5 `yarn docs:audit` → 0 ERROR
- [ ] 9.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с
      обновлённой датой в плашке «сверено с кодом»
- [ ] 9.7 Коммиты осмысленные, `main` не тронут — слияние делает Merger
      после `/opsx:archive`
