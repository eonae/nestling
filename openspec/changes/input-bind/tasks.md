## 1. Ядро: нейтральный носитель биндинга (`@nestling/pipeline`)

- [x] 1.1 Добавить необязательное поле `binding?: unknown` в
      `EndpointOptions` и `EndpointDefinition` (`src/metadata/endpoint.ts`);
      `makeEndpoint` переносит его на значение декларации без интерпретации
- [x] 1.2 Убедиться, что `resolve(...)` сохраняет `binding` в возвращаемом
      значении (декларация иммутабельна, гашение зависимостей карту не
      теряет)
- [x] 1.3 Расширить `makeEmptyContext` четвёртым параметром — стартовый
      input (`src/core/types/context.ts`), генерик
      `<S extends AnyInput = EmptyInput>` с дефолтом `{}`; тип возврата —
      `ExtendableContext<S>`
- [x] 1.4 Рантайм-тесты ядра: `binding` доезжает до значения и переживает
      `resolve`; `makeEmptyContext` без четвёртого аргумента даёт пустой
      `input`, с аргументом — переданный; ключи ядра не содержат понятий
      частей HTTP-запроса (проверка «HTTP-слепоты» — grep-тест или явная
      проверка экспортов)

## 2. Канон и bind-карта (`@nestling/transport.http`)

- [x] 2.1 Ввести типы носителя: `BindPlace`, `BindPlacement`, `HttpBinding`
      (метод, шаблон, `fields`, `rest`, `rawBody`) в новом модуле
      `src/binding.ts`
- [x] 2.2 Реализовать пометки-значения `query(options?)` и `body()`;
      зафиксировать множество методов без тела
      (`GET`/`HEAD`/`DELETE`/`OPTIONS`/`TRACE`) единой константой, из
      которой берётся и `rest`, и fail-fast для `body()`
- [x] 2.3 Реализовать `computeHttpBinding({ method, path, bind, rawBody })`:
      path-параметры шаблона → `path`, пометки → своё место, `rest` по
      методу; результат — иммутабельное значение
- [x] 2.4 Реализовать `httpBindingOf(definition)` — чтение карты с
      декларации с фолбэком на канон без пометок для деклараций,
      созданных kernel-примитивом `makeEndpoint`
- [x] 2.5 Fail-fast `computeHttpBinding` (D5 design.md): пометка на
      path-параметре; `body()` у метода без тела; непустой `bind` при
      неструктурном `input`; path-параметр при неструктурном `input`;
      path-параметр при отсутствии `input`; `rawBody` вместе с
      `stream`/`files`/`withFiles`. Тексты ошибок называют правило и имя
- [x] 2.6 Юнит-тесты канона: размещение по трём правилам для GET/POST/
      DELETE/PATCH, приоритет path над пометкой и над `rest`, все шесть
      правил fail-fast

## 3. Словарь декларации и типы (`@nestling/transport.http`)

- [x] 3.1 Добавить в `HttpEndpointDictionary` поля `bind` и `rawBody`,
      сняв комментарий-заглушку точки расширения (`src/helpers.ts`)
- [x] 3.2 Типизировать ключи `bind` как
      `Partial<Record<Exclude<keyof InferInput<I>, PathParams<Path>>,
      BindMark>>`; непрозрачный `input` не должен ломать вывод (деградация
      до отсутствия `bind`-подсказок, а не до ошибки)
- [x] 3.3 Ввести стартовый контекст декларации:
      `Start = rawBody extends true ? { rawBody: Uint8Array } : EmptyInput`
      и сторож `ValidateStart<P, Start>` в позиции слота `pipeline`
      (техника `ValidateCompose` из `core/pipeline.ts`) — ковариантность
      `TReq` через `$types` делает простую типизацию слота недостаточной
- [x] 3.4 `httpEndpoint` вычисляет карту при создании и передаёт её
      `makeEndpoint` полем `binding`; все три перегрузки (функция /
      каррированная фабрика / класс-хендлер) сохраняют новую типизацию
- [x] 3.5 Type-тесты: `bind` с неизвестным полем — ошибка; `bind` на
      path-параметре — ошибка; pipeline с требованием `{ rawBody }` без
      `rawBody: true` — ошибка; он же с `rawBody: true` — компилируется;
      существующие позитивные type-тесты трёх форм `handle` продолжают
      проходить

## 4. Strict-приём в транспорте (`@nestling/transport.http`)

- [x] 4.1 Разбор query через `searchParams.getAll`: одно вхождение —
      скаляр, ≥2 — массив, `multiple` — всегда массив, ноль вхождений —
      поля нет (`src/transport.ts`)
- [x] 4.2 Собрать payload по карте вместо `mergePayload` (ветка `default`):
      `restSource` (query или тело) ⊕ помеченные поля ⊕ path-параметры,
      приоритет фиксирован
- [x] 4.3 Ветка `withFiles`: поля формы как `restSource`, подмешивание
      path-параметров и query-пометок в `data` до валидации схемой
- [x] 4.4 Не читать тело, когда карта его не требует (метод без тела, нет
      `body()`-пометок, `rawBody` не взведён)
- [x] 4.5 Реализовать `rawBody`: одно чтение байтов (`readBody`, лимит
      `maxBodySize`), байты в стартовый input через `makeEmptyContext`,
      парсинг значения из тех же байтов без второго чтения потока
- [x] 4.6 Удалить `src/merge.ts`, `src/merge.spec.ts`, класс
      `PayloadConflictError` (`src/errors.ts`), их экспорты из
      `src/index.ts` и ветку классификации в `sendError`
- [x] 4.7 Интеграционные тесты транспорта (`transport.integration.spec.ts`):
      поле не в своём месте → 400 с issue'ами; одноимённые path-параметр и
      поле тела → значение из пути; `?tag=a&tag=b` → массив; тело у GET не
      читается; multipart с path-параметром; webhook с `rawBody`
      (проверка байтов в слое + разобранный payload у хендлера); 413 при
      превышении лимита с `rawBody`

## 5. Примеры

- [x] 5.1 Проверить существующие ручки `examples.app-with-http` под
      strict-приёмом: `get-user`/`update-user`/`delete-user` (`:id` →
      путь), `search-users` (GET → query), `list-users`, `create-user`,
      `import-users`, `export-users`, `upload-avatar` (multipart +
      path-параметр); поправить всё, что зависело от merge-отовсюду
- [x] 5.2 Добавить демонстрацию пометки `query()` (поле-фильтр у ручки с
      телом) — минимальная правка существующей ручки или новая тонкая
      ручка
- [x] 5.3 Добавить webhook-ручку с `rawBody: true` и слоем проверки
      подписи, объявленным `makePipeline<{ rawBody: Uint8Array }>()` —
      показательный кейс типизированного стартового контекста
- [x] 5.4 Прогнать `examples.simple-http-server` и `examples.simple-cli`:
      канон не должен ничего ломать; CLI не затрагивается

## 6. Документация

- [x] 6.1 Сверить `docs/design/endpoints.md` §4 с реализацией: форма
      пометок (значения в `bind`, а не обёртки схем), объём fail-fast,
      семантика query-массивов, `rawBody`; расхождения поправить по месту
- [x] 6.2 Сверить `docs/design/transports.md` §2 и §4 (приём input,
      `rawBody`, парсинг по форме io)
- [x] 6.3 Проверить формулировку в `docs/design/schemas.md` («bind-карта
      пишется руками при непрозрачной схеме») — привести к реализованной
      форме пометок
- [x] 6.4 Запись в `docs/decisions/ideas.md` — **только по явной просьбе
      пользователя**; иначе решения этого change'а фиксируются артефактами
      openspec и абзацем в `docs/decisions/archlog.md` при архивации.
      Отдельно проверить, что открытые вопросы записи «Канонизация
      HTTP-input» (форма пометок для не-zod вендоров) закрыты решением D2,
      а вопрос коерсии остаётся открытым
- [x] 6.5 Обновить `docs/guides/http-app-di.md` и
      `docs/guides/http-functional.md`: канон размещения, пометки,
      query-массивы, `rawBody`; новая дата в плашке «сверено с кодом»
- [x] 6.6 README `@nestling/transport.http` (bind-карта, strict-приём,
      удалённые `mergePayload`/`PayloadConflictError`, `rawBody`) и
      `@nestling/pipeline` (`binding`, `makeEmptyContext`) — включая
      плашки статуса
- [x] 6.7 Обновить `docs/preview/`, если затронутые страницы там есть
- [x] 6.8 Отметить статус change #21 в `docs/decisions/roadmap.md`

## 7. Definition of Done

- [x] 7.1 Все задачи выше отмечены
- [x] 7.2 `yarn verify` зелёный (`build` + `lint` + `test` по всем пакетам)
- [x] 7.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 7.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [x] 7.5 `yarn docs:audit` — 0 ERROR
- [x] 7.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены
      с обновлённой датой в плашке «сверено с кодом»
- [x] 7.7 Коммиты осмысленные, ветка запушена
