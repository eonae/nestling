## 1. Оснастка `type-tests/` (без правки типов)

- [x] 1.1 Создать `packages/nestling.pipeline/type-tests/` с подкаталогами
      `fixtures/` (заведомо неправильные композиции), `__snapshots__/`,
      `bench/` (генератор синтетического графа)
- [x] 1.2 Добавить `include: ["src"]` в `packages/nestling.pipeline/tsconfig.json`
      (сейчас неявно «всё подряд») и отдельный `type-tests/tsconfig.json`
      для фикстур; убедиться, что `build` и `lint` пакета каталога не видят
- [x] 1.3 Добавить `typescript` в devDependencies `@nestling/pipeline`
      (компилятор используется как библиотека, а не как инструмент сборки)
- [x] 1.4 Раннер снапшотов: **одна** `ts.createProgram` над всем каталогом
      фикстур, `getPreEmitDiagnostics`, группировка по файлу (D7)
- [x] 1.5 Нормализация текста диагностик: абсолютные пути → относительно
      корня репозитория, переводы строк → `\n`; номера строк/колонок
      сохраняются; `--noErrorTruncation` **не** включать
- [x] 1.6 Генератор синтетического графа: параметр — число слоёв; ~50 слоёв
      вложенной композицией + ~50 эндпоинтов
- [x] 1.7 Раннер бюджета: счётчики `Instantiations`/`Types` **дельтой к базе**
      (пустой файл при том же tsconfig); падение при диагностике
      «type instantiation is excessively deep»
- [x] 1.8 Замер латентности tsserver напрямую по протоколу (spawn
      `node_modules/typescript/lib/tsserver.js`, `quickinfo` +
      `completionInfo`); значения печатаются всегда
- [x] 1.9 nx-таргет `type-budget` у `@nestling/pipeline` с корректными
      `inputs` (`src` пакета + `type-tests/`); корневой `verify` →
      `nx run-many -t build lint test type-budget`
- [x] 1.10 Создать `type-tests/BUDGET.md`: назначение, как запускать, таблица
      замеров с датой и версией TypeScript, обоснование каждого порога

## 2. Фикстуры и снапшоты текущего состояния

- [x] 2.1 Фикстуры композиции: `compose-missing-field`, `compose-wrong-type`
      (поле есть, тип не тот), `compose-wrong-order`, `compose-arity3-inner`
- [x] 2.2 Фикстуры pre-тракта: `pre-after-response`, `pre-overrides-field`,
      `pre-requires-missing`
- [x] 2.3 Фикстура транспорта: `unresolved-class-unit` (класс-юнит без `bind()`)
- [x] 2.4 Снять снапшоты **с текущей формы типов** — это база сравнения для
      шагов 4–5; убедиться, что `compose-wrong-type` фиксирует сегодняшний
      `MISSING_FIELDS: never`
- [x] 2.5 Записать в `BUDGET.md` замер «до»: база, 20 слоёв (включая
      `TS2589`), 50 слоёв — с датой и версией TypeScript

## 3. Позитивные type-тесты вывода (до правки сигнатуры)

- [x] 3.1 Расширить `src/core/pipeline.spec.ts`: накопленный `TAcc`
      результата `compose` для арностей 2, 3 и 4
- [x] 3.2 Проверка `TNeeds` результата композиции (объединение по слоям)
- [x] 3.3 Проверка типа меты хендлера у результата композиции
      (накопленный input без `payload` + `signal`)
- [x] 3.4 Проверка ковариантного поведения `TReq` результата (то, ради чего
      в транспорте появился `ValidateStart`) — фиксирует, что правка
      сигнатуры его не изменила

## 4. Переписывание `compose` на прямой вывод

- [x] 4.1 Ввести `MissingFields<Provided, Required>` (рекорд `имя → тип`,
      включая поля с несовместимым типом) и `ComposeError` в форме
      `Simplify<{ __error; missing }>` (D2, D3)
- [x] 4.2 Ввести алиас-сторож `Guard<Provided, R, A, N>` —
      `[Provided] extends [R] ? Pipeline<R, A, N> : ComposeError<Provided, R>`
- [x] 4.3 Переписать перегрузки `compose` для арностей 2–4 на прямой вывод
      (`Pipeline<RA, AA, NA>` вместо `A extends AnyPipeline`); накопление —
      прямыми `AA & AB & …` / `NA | NB | …` в возвращаемом типе
- [x] 4.4 Убрать `& B` из позиции параметра (D4); удалить `ValidateCompose`
      и `ComposeResult`; удалить `ReqOf`/`AccOf`/`NeedsOf`, если не осталось
      потребителей
- [x] 4.5 Проверить, что `AnyPipeline` остался экспортом (рантайм-сигнатура
      `compose(...pipelines: AnyPipeline[])` и внешний код)
- [x] 4.6 Прогнать бюджет: убедиться, что `TS2589` на 20 слоях исчез, а
      50 слоёв укладываются в единицы десятков тысяч инстанциаций к базе;
      выставить пороги и записать замер «после» в `BUDGET.md`
- [x] 4.7 Позитивные type-тесты из раздела 3 — зелёные без правок

## 5. Форма литерала в остальных точках

- [x] 5.1 Привести `CheckPreCompatibility` к общей форме: `__error` +
      `missing` (рекорд полей) для «input не покрывает `TReq` юнита»
- [x] 5.2 Привести случай перезаписи поля к `__error` + `conflicting`
      (рекорд `имя → [было, стало]`); убрать
      `ERROR`/`CONFLICTING_KEYS`/`CURRENT_INPUT`/`UNIT_ADDITION`/`UNIT_EXPECTS`
- [x] 5.3 Привести `ValidateStart` в
      `packages/nestling.transport.http/src/helpers.ts` к форме
      `{ __error; missing; hint }`; сохранить текст `hint` про `rawBody: true`
- [x] 5.4 Обновить комментарий у `ValidateStart` (ссылается на
      `ValidateCompose`, которого больше нет)
- [x] 5.5 Обновить снапшоты осознанным дифом: пройти каждый файл и
      проверить, что новая первая строка читаема; `compose-wrong-type`
      обязан показывать `missing: { requestId: number }` вместо `never`
- [x] 5.6 Обновить type-тест на отрицательный случай `ValidateStart`
      в `@nestling/transport.http`

## 6. Проверка потребителей

- [x] 6.1 `yarn verify` по всем пакетам — `@nestling/app`,
      `@nestling/transport.http`, `@nestling/transport.cli`,
      `packages/examples.*` компилируются без правок
- [x] 6.2 Если у какого-то потребителя диагностика разъехалась — привести к
      общей форме по месту (D6 распространяется только на найденные точки,
      новых не заводить)
- [x] 6.3 Прогнать `type-budget` отдельным таргетом и в составе `verify`

## 7. Документация

- [x] 7.1 Сверить `docs/design/pipeline.md` §4 с реализацией: форма литерала
      (`__error` + `missing`), упоминание snapshot-тестов и бюджета —
      уточнить формулировки по факту
- [x] 7.2 README `@nestling/pipeline`: раздел о форме диагностики, где живут
      фикстуры и снапшоты, где живёт бюджет и как его запускать; плашка статуса
- [x] 7.3 Обновить `packages/nestling.pipeline/src/core/TYPE-TESTS.md`:
      паттерн «извлечение тип-параметров через `$types`» больше не
      применяется в `compose` — описать прямой вывод и добавить раздел про
      `type-tests/`
- [x] 7.4 README `@nestling/transport.http` — упоминание формы диагностики
      слота `pipeline`, если оно там есть
- [x] 7.5 Запись в `docs/decisions/ideas.md` — **только по явной просьбе
      пользователя**; иначе решения этого change'а фиксируются артефактами
      openspec и абзацем в `docs/decisions/archlog.md` при архивации.
      Отдельно проверить, что открытые вопросы (вариадический `compose`,
      распространение формы `__error` на другие подсистемы) зафиксированы —
      в `deferred.md` либо в Open Questions design'а
- [x] 7.6 Обновить `docs/preview/`, если затронутые страницы там есть
- [x] 7.7 Отметить статус change #23 в `docs/decisions/roadmap.md` и
      **закрытие breaking-окна волны 2**

## 8. Definition of Done

- [x] 8.1 Все задачи выше отмечены
- [x] 8.2 `yarn verify` зелёный (`build` + `lint` + `test` + `type-budget`
      по всем пакетам)
- [x] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 8.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [x] 8.5 `yarn docs:audit` — 0 ERROR
- [x] 8.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены
      с обновлённой датой в плашке «сверено с кодом» (ожидается, что правок
      не потребуется — поверхность вызова не менялась; проверить явно)
- [x] 8.7 Коммиты осмысленные, ветка запушена
