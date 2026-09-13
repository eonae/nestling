## 1. Формы io: развилка исходов

- [x] 1.1 `packages/nestling.operations/src/io/forms.ts`: `outputs(map)` и
      `none()` — неизменяемые значения с неперечислимым брендом; описатель
      развилки отдаёт ветки парами «статус — форма», `describeForm` на
      развилке отказывает
- [x] 1.2 `io/forms.ts`: `ValidateOutputForm` пропускает развилку и
      отвергает в ветке потоковую форму, `multipart` и вложенную развилку;
      `none()` вне развилки — ошибка типа
- [x] 1.3 `io/summary.ts` (media types): правило применяется к каждой ветке
      отдельно, ветка `none()` media type не имеет
- [x] 1.4 `io/capabilities.ts`: `assertFormsSupported` проверяет
      способности транспорта по каждой ветке развилки
- [x] 1.5 Рантайм-спеки `io/forms.spec.ts` и `io/capabilities.spec.ts`:
      бренд развилки, отказ `describeForm`, объект с ключами-статусами не
      считается развилкой, media type ветки

## 2. Ядро: результат и декларация операции

- [x] 2.1 `src/result.ts`: `Ok<TValue, TStatus extends SuccessStatus = 'ok'>`;
      `new Ok(value)` даёт `Ok<T, 'ok'>`, `new Ok('created', value)` —
      `Ok<T, 'created'>` (литерал выводится тип-параметром перегрузки),
      `Ok.created`/`Ok.accepted`/`Ok.noContent` возвращают уточнённый тип
- [x] 2.2 `src/status.ts`: `assertSuccessStatus(value, where)` для поля
      `status` и для ключей развилки (тексты ошибок называют декларацию,
      поле и допустимые значения)
- [x] 2.3 `src/output.ts`: `OutputSync`/`Output` выводят допустимый
      результат из объявленных исходов — `Ok<TValue, S>` для одного исхода
      и дискриминированный юнион `Ok` по статусу для развилки; голое
      значение допустимо только при одном исходе
- [x] 2.4 `src/doc.ts`: удалить `status` из `DeclarationDoc`, из `DOC_FIELDS`
      и из `assertDoc`; текст ошибки неизвестного поля называет поле
      `status` верхнего уровня словаря
- [x] 2.5 `src/operation.ts`: поле `status` у `makeRequest`, развилка в
      `output`; `makeCommand` и `makeEvent` отвергают оба с текстом «у
      операции нет ответа»; проверки объявления (развилка пустая или из
      одного ключа, `status` вместе с развилкой, `no_content` при
      объявленном `output`)
- [x] 2.6 Рантайм-спеки `result.spec.ts` и `operation.spec.ts`: сценарии
      проверок объявления из спеки `declared-success-status`
- [x] 2.7 Тип-тесты: `Ok.created` вне объявленных исходов, голое значение
      при развилке, `Ok.accepted(user)` при ветке `accepted: JobAccepted`,
      сужение `value` по `result.status`

## 3. Ядро: `@nestlingjs/app`

- [x] 3.1 `pipeline/metadata/endpoint.ts`: поле `status` в `EndpointOptions`,
      объявленное множество исходов на `EndpointDefinition`, перенос при
      `resolve`; проверки объявления в `makeEndpoint`
- [x] 3.2 `pipeline/core/types/endpoint.ts`: `HandlerFn` и
      `CheckedHandlerFn` выводят объявленные исходы и передают их в
      `Output`
- [x] 3.3 `pipeline/core/pipeline.ts`, `normalizeResponse`: голое значение
      получает объявленный статус вместо сегодняшнего `'ok'`; `Ok` отдаёт
      свой статус
- [x] 3.4 Валидация выхода выбирает форму по статусу результата; ветка
      `none()` тела не несёт
- [x] 3.5 Граница: `Ok` со статусом вне объявленного множества заменяется на
      `internal_error` — рядом с `enforceDeclaredFails`, тем же механизмом
      и с текстом, называющим объявленные статусы
- [x] 3.6 Рантайм-тесты пайплайна: умолчание (`ok` при `output`,
      `no_content` без него), подстановка объявленного статуса голому
      значению, валидация телом своей ветки, замена статуса вне множества
      на `internal_error`
- [x] 3.7 Тип-тесты декларации: `status` и развилка в словаре
      `httpEndpoint.*`, диагностика при статусе вне объявленных исходов

## 4. Транспорты

- [x] 4.1 `@nestlingjs/transport.http`: проверка «`status` рядом с
      `redirect`» при создании HTTP-декларации (`assertRedirect` в
      `binding.ts` — там же, где сегодня отвергается редирект с потоком)
- [x] 4.2 Интеграционные тесты транспорта: 201 у endpoint'а со
      `status: 'created'`, 204 у endpoint'а без `output`, 200 и 202 с
      разными телами у endpoint'а с развилкой
- [x] 4.3 `@nestlingjs/transport.nats` и `@nestlingjs/transport.cli`:
      убедиться, что статус переносится как есть, и покрыть тестом ответ со
      статусом, отличным от `ok`

## 5. Документ: `@nestlingjs/openapi`

- [x] 5.1 `src/responses.ts`: `planSuccess` возвращает список пар «код —
      ответ» по объявленным исходам; схема и media type берутся с формы
      ветки, ветка `none()` печатается без `content`; коды по-прежнему
      через `httpCodeOf`
- [x] 5.2 Тесты `document.spec.ts`: развилка с разными телами, ветка
      `none()`, умолчания без поля `status`

## 6. Клиент: `@nestlingjs/client`

- [ ] 6.1 `src/response.ts`: `readSuccess` строит таблицу «код → форма
      ветки», валидирует тело схемой пришедшего исхода и отдаёт
      `InternalError`, когда код вне объявленного множества
- [ ] 6.2 `src/client.ts`: объявленные исходы берутся с операции и попадают
      в разбор ответа; тип результата вызова — `Ok` или их юнион по
      объявлению
- [ ] 6.3 Тесты `client.spec.ts` и `client.types.spec.ts`: разбор тела по
      ветке, код вне множества, 204 у операции без `output`, сужение
      результата по `status`

## 7. Примеры

- [ ] 7.1 `examples/microservice/src/api/operations.ts`: `CreateUser`
      объявляет исходы вместо `doc: { status }` — ветка `dryRun` перестаёт
      расходиться с документом
- [ ] 7.2 `examples/microservice/src/users/endpoints/create-user.endpoint.ts`:
      ветки возвращают `Ok` своего исхода
- [ ] 7.3 `delete-user.endpoint.ts` и `ops/subscriptions.endpoint.ts`:
      `status: 'no_content'` полем декларации вместо секции `doc`
- [ ] 7.4 `yarn test` примера зелёный; спеки, проверяющие статус ответа,
      обновлены

## 8. Документация

- [ ] 8.1 `docs/design/endpoints.md`: поле `status`, развилка `outputs(...)`,
      умолчание, связь с типом результата; `doc.status` уходит из описания
      секции `doc`
- [ ] 8.2 `docs/design/errors.md`: `Ok<TValue, TStatus>` и выбор исхода
      хендлером
- [ ] 8.3 `docs/design/operations.md`: поле `status` и развилка у
      `makeRequest`, их отсутствие у команды и события
- [ ] 8.4 `docs/design/streaming.md`: потоковая форма объявляется
      единственным исходом, с причиной
- [ ] 8.5 Английские пары 8.1–8.4 в `docs/en/design/` (инвариант
      `lang-parity`)
- [ ] 8.6 Главы гайда `06-repository.md`, `08-testing.md`, `10-auth.md`,
      `11-database.md`, `13-openapi-and-client.md` и их английские пары:
      объявление исходов, плашка «сверено с кодом» с новым хэшем и датой
- [ ] 8.7 `docs/recipes/ops.md`, `docs/recipes/alternatives.md` и
      английские пары
- [ ] 8.8 README пакетов `nestling.operations` и `nestling.transport.http`
      (обе языковые половины), включая плашки статуса
- [ ] 8.9 `docs/glossary.md` и `docs/en/glossary.md`: термин «исход»
      (успешный исход операции) рядом с формами io
- [ ] 8.10 `node .claude/skills/docs-style/scripts/lint.mjs` по всем
      изменённым текстовым файлам — 0 запрещённых слов

## 9. Решение зафиксировано

- [ ] 9.1 `docs/decisions/deferred.md`, запись `[2026-08-01]`
      «Типизированный успешный статус декларации»: пометка «**РЕАЛИЗОВАНО
      \<дата\>** — change `typed-success-status` (#84 roadmap)» с тем, что
      вышло целиком, и чем реализация уточнила решение — развилка исходов
      со своими телами вместо одного статуса и сверка на границе
- [ ] 9.2 Открытый вопрос дизайна (политика `check()` на недостижимую ветку
      развилки) записать в `deferred.md` отдельной записью с триггером
      возврата
- [ ] 9.3 После `/opsx:archive`: строка 84 в `docs/decisions/roadmap.md` —
      статус **done** со ссылкой на архив; размер строки уточнить до M

## 10. Definition of Done

- [ ] 10.1 Все задачи выше отмечены
- [ ] 10.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` +
      `type-budget` по всем пакетам)
- [ ] 10.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 10.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md;
      запись журнала, по которой шёл change, несёт пометку «РЕАЛИЗОВАНО»
- [ ] 10.5 `yarn docs:audit` → 0 ERROR
- [ ] 10.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с
      обновлённой датой в плашке «сверено с кодом»
- [ ] 10.7 Коммиты осмысленные, `main` не тронут — слияние делает Merger
      после `/opsx:archive`
