## 1. Формат документа в `@nestlingjs/operations`

- [ ] 1.1 `packages/nestling.operations/src/http/problem.ts`: тип
  `ProblemDocument` (`type`, `title`, `status`, `detail`, `details?`,
  `stack?`), константы `PROBLEM_MEDIA_TYPE` и `PROBLEM_TYPE_PREFIX`
- [ ] 1.2 Там же: `problemTypeOf(code)` — код в `urn:error:<код>`;
  `failCodeOf(type)` — обратный разбор, не строка или строка без
  префикса дают `undefined`
- [ ] 1.3 Там же: `problemTitleOf(category)` — фраза статуса HTTP;
  таблица типизирована `Record<Category, string>`, чтобы новая категория
  не прошла мимо
- [ ] 1.4 Там же: `problemOf(error, status)` — документ из деталей отказа
  и кода ответа; `details` и `stack` пишутся только при наличии
- [ ] 1.5 `src/http/index.ts` и `src/index.ts`: экспорты модуля
- [ ] 1.6 `src/http/problem.spec.ts`: отображение полей, отказ без
  деталей, `stack` только переданный, `failCodeOf` на чужом типе и на
  не-строке, проход `problemTypeOf` → `failCodeOf` для кода с уточнением
- [ ] 1.7 Прогнать `yarn workspace @nestlingjs/operations test`

## 2. `@nestlingjs/transport.http`: три места сериализации

- [ ] 2.1 `src/adapter.ts`, `sendResponse`: ветка отказа пишет документ
  через `problemOf(response.value, status)` и медиатип
  `application/problem+json`; успешный ответ не меняется
- [ ] 2.2 `src/adapter.ts`, `midStreamBody`: кадр `event: error` несёт тот
  же документ; статус берётся из `httpCodeOf` категории отказа, у
  не-`Fail` — 500
- [ ] 2.3 `src/transport.ts`, `sendError`: собрать детали отказа
  (`JsonParseError` → `bad_request`, `PayloadTooLargeError` →
  `payload_too_large` с лимитом в `details`, иначе `internal_error` и
  `stack` при `exposeErrorDetails`) и отдать их `problemOf`
- [ ] 2.4 `src/index.ts`: реэкспорт формата из `@nestlingjs/operations`
  рядом с `RedirectStatus` и `SseConfig`
- [ ] 2.5 `src/transport.integration.spec.ts`: ожидания на документ и
  медиатип — объявленный отказ, отказ без деталей, 400 на битом JSON,
  413 на превышении лимита, generic-500 с `exposeErrorDetails` и без
- [ ] 2.6 `src/streaming.integration.spec.ts`: кадр `event: error` несёт
  документ с `type` и `status` отказа
- [ ] 2.7 `src/operation-endpoint.spec.ts` и `src/helpers.spec.ts`:
  ожидания на новый формат
- [ ] 2.8 Добавить тест: ни один путь отказа не пишет членов `error` и
  `code`
- [ ] 2.9 Прогнать `yarn workspace @nestlingjs/transport.http test`

## 3. `@nestlingjs/client`

- [ ] 3.1 `src/response.ts`: `WireFailure` заменить на `ProblemDocument`;
  `readFailure` берёт код через `failCodeOf(wire.type)`, сообщение — из
  `detail`, детали — из `details`
- [ ] 3.2 Там же: тексты `unknownFailure` называют тип проблемы, а не
  код; отдельная ветка для `type` без префикса `urn:error:`
- [ ] 3.3 `src/client.spec.ts`: тела ответов в новом формате; добавить
  сценарии «чужой `type`» и «`type` отсутствует»
- [ ] 3.4 Прогнать `yarn workspace @nestlingjs/client test`

## 4. `@nestlingjs/openapi`

- [ ] 4.1 `src/responses.ts`: `failSchema` описывает документ — `type`
  константой `problemTypeOf(code)`, `title` константой, `status`
  константой кода ответа, `detail` строкой, `details` по схеме
  определения; `required` — `type`, `title`, `status`, `detail`
- [ ] 4.2 Там же: `jsonResponse` → ответ с медиатипом
  `PROBLEM_MEDIA_TYPE`; шапка файла про «формат, который реально пишет
  транспорт» переписана под новый формат
- [ ] 4.3 `src/document.spec.ts`: ожидания на медиатип, константы `type`
  и различимость веток `oneOf`
- [ ] 4.4 Прогнать `yarn workspace @nestlingjs/openapi test`

## 5. Примеры и e2e

- [ ] 5.1 `examples/app-with-http/e2e/users-crud.spec.e2e.ts`,
  `webhook.spec.e2e.ts`, `streaming.spec.e2e.ts`: ожидания на `type`
  вместо `code`
- [ ] 5.2 Пройти `grep -rn "code:\|\"error\"" examples/*/e2e examples/*/src`
  и починить оставшееся
- [ ] 5.3 Прогнать e2e примера `app-with-http`

## 6. Документация

- [ ] 6.1 `docs/design/errors.md`: раздел о проводном формате —
  документ RFC 9457, отображение полей, `urn:error:<код>`, один формат на
  ответ, ошибку до пайплайна и кадр SSE; английская пара
  `docs/en/design/errors.md`
- [ ] 6.2 `docs/design/transports.md` §4: строки об ответе, кадре SSE и
  границе пакета — медиатип и документ; §4.1 упоминает реэкспорт формата;
  английская пара
- [ ] 6.3 Гайды `04-errors.md`, `03-input.md`, `10-auth.md`,
  `12-files-and-streams.md`, `14-features.md`: тела ответов в примерах,
  плашка «сверено с кодом» с датой; английские пары
- [ ] 6.4 Рецепты `docs/recipes/ops.md`, `docs/recipes/webhook.md` и
  английские пары: тела ответов
- [ ] 6.5 README пакетов `operations`, `transport.http`, `client`,
  `openapi` — обе половины (`README.md`, `README.ru.md`), включая плашки
  статуса
- [ ] 6.6 `docs/compatibility.md` и пара: строка о медиатипе ошибок, если
  справочник перечисляет форматы, уходящие по сети
- [ ] 6.7 Прогнать `node .claude/skills/docs-style/scripts/lint.mjs` по
  изменённым текстам — 0 запрещённых слов

## 7. Синхронизация решений

- [ ] 7.1 `docs/decisions/roadmap.md`: строка 83 — статус, ссылка на
  архив change'а и на изменённые спеки
- [ ] 7.2 `docs/decisions/deferred.md`: запись [2026-07-14] «Wire-формат
  ошибок: RFC 9457» — пометка «РЕАЛИЗОВАНО» с итогом: что вышло целиком,
  чем реализация уточнила решение (идентичность в `type`, место модуля),
  что осталось открытым (`instance` и корреляция, ссылки на
  документацию)

## 8. Definition of Done

- [ ] 8.1 Все задачи выше отмечены
- [ ] 8.2 `yarn verify` зелёный
- [ ] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 8.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [ ] 8.5 Запись `deferred.md`, по которой шёл change, несёт пометку
  «РЕАЛИЗОВАНО» с тем, что вышло целиком, что уехало дальше и чем
  реализация уточнила решение
- [ ] 8.6 `yarn docs:audit` — 0 ERROR
- [ ] 8.7 Затронутые `examples/*` мигрированы, главы гайда пересверены с
  обновлённой датой в плашке «сверено с кодом»
- [ ] 8.8 `main` не тронут: слияние делает Merger после `/opsx:archive`
