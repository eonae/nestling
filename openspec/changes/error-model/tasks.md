# tasks — error-model

Порядок групп соответствует Migration Plan из [design.md](./design.md):
типы → рантайм → декларации → транспорты → middleware → примеры/доки.
Внутри группы задачи упорядочены по зависимостям.

## 1. Значения: `Fail`, `Ok`, `Output`, статусы

- [x] 1.1 `packages/nestling.pipeline/src/core/status.ts`: добавить
      `CONFLICT`, `TIMEOUT`, `TOO_MANY_REQUESTS` в `errorStatuses`
- [x] 1.2 `src/core/result.ts`: `Fail` → генерик
      `Fail<TCode extends string | undefined = string | undefined, TDetails = unknown>`
      с полями `isFail: true`, `code`, `details`, `cause`; конструктор
      принимает опции (`details`, `cause`); статические фабрики `Fail.*`
      сохраняются и дают `code: undefined` (D1)
- [x] 1.3 `src/core/result.ts`: `Ok` получает `isFail: false`; конструктор
      запрещает оборачивание отказа по типам (`new Ok(fail)` — ошибка
      компиляции), закрывая открытый вопрос журнала (D2)
- [x] 1.4 `src/core/result.ts`: `Output<TValue, E extends AnyFail = never>`
      и `OutputSync<TValue, E>`; экспортировать `AnyFail`
- [x] 1.5 Тесты типов и рантайма: сужение по `isFail`, несовместимость
      `Fail<'A'>`/`Fail<'B'>`, анонимный отказ не присваивается
      объявленному, `new Ok(fail)` не компилируется, `cause` не попадает
      в тело

## 2. `defineFail` и kernel-коды

- [x] 2.1 Новый модуль `src/core/define-fail.ts`: `defineFail(code, {
      status, message, details? })` → вызываемое определение со
      свойствами `code`, `status`, `schema`, `is()` (D3)
- [x] 2.2 Конструктор валидирует `details` схемой синхронно (правила
      change #19); текст ошибки называет код отказа
- [x] 2.3 `message` — строка или функция от валидированных деталей; тип
      деталей выводится из схемы без аннотаций
- [x] 2.4 `is(value)` — предикат по `code`, сужающий тип; работает на
      значении без прототипа (JSON round-trip)
- [x] 2.5 Kernel-определения `UnknownError` (`UNKNOWN`/`INTERNAL_ERROR`)
      и `ValidationFailed` (`VALIDATION_FAILED`/`BAD_REQUEST`) + внутренний
      предикат «код входит в kernel-набор» (D4)
- [x] 2.6 Экспорты пакета: `defineFail`, `UnknownError`, `ValidationFailed`,
      типы определений (`FailDefinition`, `AnyFailDefinition`)
- [x] 2.7 Тесты: конструирование с деталями и без, валидация деталей,
      `is()` по коду и на десериализованном значении, отсутствие побочных
      эффектов при импорте определений

## 3. Рантайм пайплайна: возврат ≡ бросок, страж, `meta.fail`

- [x] 3.1 `src/core/types/context.ts`: `ErrorDetails.code?: string`;
      `EndpointMeta.errors?: readonly AnyFailDefinition[]`
- [x] 3.2 `src/core/pipeline.ts` → `normalizeResponse`: ветка
      `instanceof Fail` (и — для десериализованных значений — `isFail`)
      уводит ответ на error-track до `.ok`-юнитов
- [x] 3.3 `errorToResponse`: кладёт `code` в тело; поведение раскрытия
      по `exposeErrorDetails` сохраняется
- [x] 3.4 `src/core/types/unit.ts`: `CatchUnitFn` может вернуть `Fail`;
      рантайм нормализует его так же, как отказ хендлера (D6)
- [x] 3.5 Инъекция `meta.fail` рядом с `meta.signal`: ключ зарезервирован,
      перекрывает одноимённое поле input; не-`Fail` → `TypeError` (D8)
- [x] 3.6 Страж контракта: после ответного тракта и до `computeOutcome`
      сверяет код ответа с `ctx.endpoint.errors ∪ kernel` и заменяет
      несовпадение на `UnknownError` (D5)
- [x] 3.7 `ExecuteOptions.onUnknownFail?: (info) => void`; дефолт —
      `console.error` с префиксом `[nestling]`, оригинал целиком
- [x] 3.8 Тесты рантайма: возврат `Fail` даёт тот же ответ, что бросок;
      `.ok` не видит отказ; `.catch` превращает недекларированный отказ
      в контрактный; страж нормализует незадекларированное; `.finally`
      видит нормализованный ответ и исход `failed`; хук получает оригинал

## 4. Декларации: `errors:` и вывод `E`

- [x] 4.1 `src/metadata/endpoint.ts`: `EndpointOptions.errors?` и перенос
      на значение декларации; поле переживает `resolve` (D7)
- [x] 4.2 Проверка списка при создании: не-определение → ошибка с позицией;
      дубль `code` → ошибка с кодом; тексты называют ручку
- [x] 4.3 Вывод `E` из кортежа `errors:` в перегрузках `makeEndpoint`
      (все три формы `handle`)
- [x] 4.4 `src/core/types/endpoint.ts`: `HandlerFn<I, O, P, E>` —
      `meta.fail: (e: E) => never`, возврат `Output<…, E>`
- [x] 4.5 `httpEndpoint` и `cliEndpoint` пробрасывают `errors:` без
      интерпретации
- [x] 4.6 Type-тесты: возврат задекларированного отказа компилируется;
      возврат чужого — ошибка; `meta.fail` сужен до `E`; ручка без
      `errors:` не может вернуть отказ
- [x] 4.7 Проверить, что новые тип-параметры не ломают снапшоты
      диагностик и порог `type-budget` (change #23)

## 5. Транспорты и middleware

- [x] 5.1 `@nestling/transport.http`: `STATUS_MAP` пополняется
      `CONFLICT → 409`, `TOO_MANY_REQUESTS → 429`, `TIMEOUT → 504` (D9)
- [x] 5.2 `@nestling/transport.http`: `errors` из декларации переносится в
      `EndpointMeta`; `onUnknownFail` прокидывается рядом с
      `exposeErrorDetails`
- [x] 5.3 `@nestling/transport.cli`: то же (перенос `errors`, проброс хука);
      маппинга статусов CLI не требует — проверить вывод новых статусов
- [x] 5.4 `src/middlewares/validate.ts`: бросает `ValidationFailed` вместо
      анонимного `Fail.badRequest`; форма `details` (issues) сохраняется
- [x] 5.5 Fallback-ветка HTTP-транспорта (endpoint без pipeline): отказ
      валидации отвечает 400 с кодом `VALIDATION_FAILED`; тела ошибок
      парсинга и лимитов не трогаются (non-goal)
- [x] 5.6 `@nestling/app`: проверить, что дискавери и старт переносят
      `errors` до транспорта без потерь
- [x] 5.7 Интеграционные тесты транспортов: 409/429/504, код в теле,
      незадекларированный отказ → 500 `UNKNOWN`, валидация остаётся 400

## 6. Примеры

- [x] 6.1 `packages/examples.app-with-http`: доменные отказы через
      `defineFail`, объявление в `errors:`, замена анонимных `Fail.*`
- [x] 6.2 `packages/examples.simple-http-server` и
      `packages/examples.simple-cli`: то же
- [x] 6.3 Показать в одном из примеров оба канала — `return` отказа и
      `meta.fail(...)` — и `.catch`-юнит, матчащий отказ по `.is()`
- [x] 6.4 Прогнать примеры руками (запуск + запрос), убедиться, что коды
      и статусы соответствуют декларациям

## 7. Документация

- [ ] 7.1 Сверить `docs/design/errors.md` с реализацией: форма
      `defineFail` (аргумент — `details`), kernel-коды, место стража,
      хук диагностики; поправить по месту
- [ ] 7.2 `docs/design/endpoints.md` — пример декларации с `errors:` и
      упоминание `meta.fail` как второго зарезервированного ключа
- [ ] 7.3 `docs/design/pipeline.md` — ответный тракт: возврат `Fail`,
      возврат `Fail` из `.catch`, страж перед `.finally`
- [ ] 7.4 README `@nestling/pipeline` (плашка статуса, раздел о модели
      ошибок), README затронутых транспортов
- [ ] 7.5 `docs/guides/*`: перевести примеры ошибок на `defineFail` +
      `errors:`, обновить дату в плашке «сверено с кодом»
- [ ] 7.6 `docs/preview/`: пример `Fail.badRequest('Email already taken')`
      → отказ со статусом `CONFLICT` и кодом
- [ ] 7.7 Запись в `docs/decisions/ideas.md` — **только по явной просьбе
      пользователя**: предложить запись, закрывающую открытый вопрос
      «точный API `defineFail`» (аргумент — `details`, `message` — функция
      от них) и вопрос `new Ok(fail)`; иначе решения фиксируются
      артефактами openspec и абзацем в `archlog.md` при архивации
- [ ] 7.8 Открытые вопросы design'а, оставшиеся нерешёнными после
      реализации (`isOneOf`, `details` без схемы), — в `deferred.md`
      с триггером возврата
- [ ] 7.9 Отметить статус change #15 в `docs/decisions/roadmap.md`

## 8. Definition of Done

- [ ] 8.1 Все задачи выше отмечены
- [ ] 8.2 `yarn verify` зелёный (`build` + `lint` + `test` + `type-budget`
      по всем пакетам)
- [ ] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 8.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [ ] 8.5 `yarn docs:audit` — 0 ERROR
- [ ] 8.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены
      с обновлённой датой в плашке «сверено с кодом»
- [ ] 8.7 Коммиты осмысленные, ветка запушена
