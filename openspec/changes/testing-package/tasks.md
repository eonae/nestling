# tasks — testing-package: ядро `@nestling/testing`

Порядок работ идёт снизу вверх (контейнер → шов и `check()` в `@nestling/app`
→ обвязка условия `"testing"` → пакет `@nestling/testing` → витрина → доки):
каждая группа оставляет репозиторий собираемым, откат — отбрасыванием верхних
ступеней.

## 1. Подстановка узла в `ContainerBuilder`

- [x] 1.1 Типы `TokenOverride` (пара «токен → значение») и
      `FamilyOverrideEntry` (подмена рецепта семейства); поля `overrides` и
      `familyOverrides` в `ContainerBuilderOptions`
      (`packages/nestling.container/src/builder/container.builder.ts`) с
      JSDoc «шов тестового корня»
- [x] 1.2 Применение `familyOverrides` в `build()` **до**
      `materializeFamilyMembers()` — иначе члены родились бы по боевому
      рецепту
- [x] 1.3 Применение `overrides` после материализации членов: провайдер
      токена заменяется на `{ provide, useValue }` с сохранением атрибуции к
      модулю (владелец узла в графе, `strictExports` и визуализация
      продолжают называть тот же модуль)
- [x] 1.4 Fail-fast сборки: override токена, для которого нет провайдера
      (текст называет токен и подсказывает проверить выбранные фичи; для
      токена, похожего на член семейства, — отдельная подсказка «членский
      токен становится узлом графа только по факту инжекта»); два
      override'а одного токена
- [x] 1.5 Рантайм-тесты подстановки: конструктор боевого класса-провайдера
      не вызывается ни разу; фейк с `@OnInit`/`@OnDestroy` — обычный узел и
      участвует в общем реверсе; узел сохраняет модуль-владелец; обе ошибки
      из 1.4
- [x] 1.6 Рантайм-тесты `familyOverrides`: три разных члена созданы
      тестовым рецептом, боевой рецепт не вызван ни разу

## 2. Прунинг осиротевших поддеревьев

- [x] 2.1 Снимок отношения зависимостей до подстановки (`deps`) и после
      (`deps′`); ребро на `Family.all` при обходе разворачивается в рёбра ко
      всем текущим членам семейства
- [x] 2.2 Алгоритм: `R` = токены с нулевой входящей степенью в `deps ∪ deps′`
      плюс токены, недостижимые из `R` по объединению (участники циклов);
      `Keep` = достижимые из `R` по `deps′`; провайдеры `All \ Keep`
      удаляются **до** инстанциации; заменённый узел не прунится
- [x] 2.3 Материализация агрегатов `Family.all` переносится **после**
      прунинга — агрегат собирается по оставшимся членам
- [x] 2.4 Список id выпавших узлов доступен наружу от `BuiltContainer` —
      источник для `TestApp.pruned`
- [x] 2.5 Рантайм-тест инварианта тождественности: на нетривиальном графе
      без `overrides` множество узлов, их зависимости и порядок
      `init`/`destroy` совпадают с эталоном до введения прунинга — включая
      узлы, на которые никто не ссылается
- [x] 2.6 Рантайм-тесты прунинга: единственный потребитель заменён — узел не
      инстанцируется и в графе его нет; разделяемая зависимость остаётся;
      цепочка `A → B → C` прунится вглубь; член, нужный только через `.all`,
      остаётся; агрегат не ссылается на выпавшего члена;
      `@OnInit`/`@OnDestroy` выпавших узлов не выполняются
- [x] 2.7 Рантайм-тест: цикл `A → B → A`, на который больше никто не
      ссылается, по-прежнему падает диагностикой цикла, а не исчезает

## 3. Перечень недостающих зависимостей до инстанциации

- [x] 3.1 Предвалидация в `build()` до `instantiateAll`: обход `deps` всех
      оставшихся после прунинга провайдеров, сбор токенов без провайдера с
      их потребителями, одна ошибка со списком (в стиле существующего
      `checkStrictExports`, сообщающего все нарушения разом)
- [x] 3.2 Существующие подсказки сохраняются: токен, похожий на член
      семейства, созданный `makeToken` вручную, по-прежнему сопровождается
      объяснением, что членов создаёт вызов семейства
- [x] 3.3 Обновить существующие тесты, ожидавшие текст первой ошибки
      инстанциации (`Provider for token 'X' not found`)
- [x] 3.4 Рантайм-тесты: три недостающих токена в одной ошибке с
      потребителем каждого; сохранение подсказки про семейство

## 4. `@nestling/app`: `check()` и внутренний шов

- [x] 4.1 Выделить фазы 0–1 (резолв `select`, регистрация, дискавери,
      `builder.build()`, сверка транспортов, `assertFormsSupported`) в
      переиспользуемый внутренний метод — общий для `run()` и `check()`
- [x] 4.2 `App.check(): Promise<CheckReport>` — фазы 0–1 без `@OnInit`,
      `@OnStart`, `serve` и `@OnDestroy`; собственный контейнер не
      записывается в `#container` и не мешает последующему `run()`; бросает
      те же ошибки, что бросил бы `run()` на этих фазах
- [x] 4.3 `CheckReport`: выбранные фичи, обнаруженные ручки с их
      транспортами, требуемые транспорты
- [x] 4.4 `AssemblyPlan` пополняется `overrides`/`familyOverrides`;
      `assemble` их **не** принимает и не пробрасывает
- [x] 4.5 Шов тестового корня: конструирование `App` с планом, включающим
      подстановки, прохождение фаз 0–3 (BOOTSTRAP → ASSEMBLE → INIT → WIRE)
      с остановкой и доступом к `container`, карте «декларация → её
      исполнимая копия + `dispatch` транспорта» и общему `AbortController`;
      START, `#announce()` и `#attachSignals()` не выполняются
- [x] 4.6 Шов живёт в `packages/nestling.app/src/testing/index.ts` и
      экспортируется subpath'ом `./testing` c conditional export по условию
      `"testing"` (`packages/nestling.app/package.json`); главный экспорт
      `@nestling/app` не отдаёт ни `overrides`, ни способа остановиться на
      WIRE
- [x] 4.7 Рантайм-тесты `check()`: граф собран и `@OnInit` не выполнен ни
      разу; битая топология падает той же ошибкой, что и `run()`; отчёт
      называет фичи и ручки; `check()` перед `run()` не ломает `run()`
- [x] 4.8 Экспорт `check()` из публичного API `@nestling/app` рядом с
      `run()`/`close()`, JSDoc с указанием фаз и того, что **не**
      происходит

## 5. Обвязка условия `"testing"` в репозитории

- [x] 5.1 `jest.config.base.js`: `testEnvironmentOptions.customExportConditions
      = ['testing', 'node', 'node-addons']`
- [x] 5.2 `moduleNameMapper`: правило для `^@nestling/([^/]*)/testing$` →
      исходники subpath'а, размещённое **до** общего `^@nestling/(.*)$`
- [x] 5.3 `lib: ['es2022', 'esnext.disposable']` в ts-jest'овом `tsconfig`
      базовой конфигурации — для `await using`
- [x] 5.4 `customConditions: ['testing']` в `tsconfig` пакетов, которым
      нужен условный резолв при сборке (`nestling.testing`,
      `examples.app-with-http`)
- [x] 5.5 Проверка обвязки тестом: `@nestling/app/testing` резолвится на
      исходники, `await using` компилируется и вызывает `Symbol.asyncDispose`
      по выходу из блока

## 6. Пакет `@nestling/testing`: корень и `TestApp`

- [x] 6.1 Скаффолд `packages/nestling.testing`: `package.json`
      (`@nestling/testing`, зависимости `@nestling/app`,
      `@nestling/container`, `@nestling/config`, `@nestling/pipeline`,
      `@nestling/transport`), `tsconfig.json`, `jest.config.js`, стандартные
      скрипты пакета
- [x] 6.2 `assembleTest(spec): Promise<TestApp>` поверх шва
      `@nestling/app/testing`: тот же словарь сборки
      (`modules`/`providers`/`features`/`select`/`transports`/`config`) плюс
      `overrides`; фазы 0–3; те же fail-fast'ы ASSEMBLE, что и в бою
- [x] 6.3 Типизация `overrides`: mapped-тип, требующий для каждого элемента
      `[InjectionToken<T>, T]`; значения `familyOverride(...)` принимаются
      тем же списком
- [x] 6.4 `TestApp.close()` — идемпотентный SHUTDOWN: взвод общего
      `AbortController`, затем `container.destroy()` (реверс топосорта);
      `TestApp[Symbol.asyncDispose]` вызывает `close()`
- [x] 6.5 `TestApp.get(token)` — инстанс узла или `null`; `TestApp.pruned` —
      id выпавших прунингом узлов
- [x] 6.6 Рантайм-тесты: `@OnInit` выполнены и `dispatch` построен, а
      `@OnStart` не выполнен и `serve` не вызван; обработчики
      `SIGTERM`/`SIGINT` не установлены и в stdout ничего не напечатано;
      HTTP-ручка без транспорта отклоняет `assembleTest` той же ошибкой, и
      `@OnInit` не выполняется; `@OnDestroy` в реверсе; повторный `close()`
      безопасен

## 7. `call`, `unwrap`, `vars`, `familyOverride`

- [x] 7.1 Поиск декларации по **идентичности значения** в карте, собранной в
      WIRE; ошибка «декларации нет в собранном приложении» с перечнем
      доступных ручек
- [x] 7.2 `TestApp.call(endpoint, input, options?)`: построение контекста
      через `makeEmptyContext(raw, endpointMeta, signal)` — `raw.transport`
      из токена транспорта декларации, `raw.pattern` из декларации,
      `raw.payload` от теста, `raw.attributes` из `options` или `{}` — и
      вызов `dispatch.call(pattern, ctx, options)` с общим `signal`
- [x] 7.3 Типизация `call`: `input` выводится из `input`-формы декларации,
      результат — `ResponseContext<InferOutput<O>>`; опции границы
      (`exposeErrorDetails`, `onUnknownFail`) пробрасываются, дефолт
      `exposeErrorDetails: true`
- [x] 7.4 `unwrap(response)` — значение успеха либо бросок с деталями отказа,
      включая `status` и `code`
- [x] 7.5 `vars(record)` поверх `objectSource(record, 'vars')` — именованный
      объектный `ConfigSource` с `watch`/`set`/`assign`; `process.env` не
      изменяется
- [x] 7.6 `config:` тестового корня принимает три формы: `ConfigSource`
      (сахар для `[[source, '*']]`), одну привязку, список привязок; боевой
      `assemble` сахара не получает
- [x] 7.7 `familyOverride(Family, (param) => value)` — значение,
      разворачивающееся в `familyOverrides` билдера
- [x] 7.8 Рантайм-тесты `call`: успешный вызов через полный пайплайн;
      объявленный отказ с `status` и `code` из `errors:`; невалидный вход
      даёт тот же отказ валидации, что получил бы клиент; вызов ручки
      невыбранной фичи бросает ошибку с перечнем доступных; слой видит
      честные `raw.transport`/`raw.pattern` и пустые `attributes`;
      `close()` во время незавершённого `call` взводит `ctx.signal`
- [x] 7.9 Рантайм-тесты конфига и семейств: секция проецируется из `vars`, а
      `process.env` не тронут; `src.set(...)` перепроецирует
      reloadable-секцию и уведомляет подписчиков; `familyOverride(ILogger,
      …)` отдаёт no-op каждому инжекту, боевой рецепт не вызван ни разу
- [x] 7.10 Type-тесты (`packages/nestling.testing/src/*.type-test.ts` в
      стиле `TYPE-TESTS.md`): фейк, не совместимый с типом токена, — ошибка
      компиляции; типы `input` и результата `call`

## 8. `checkTopologies`, `testModule`, публичный экспорт

- [x] 8.1 `checkTopologies(spec, selections)` — прогон `.check()` по каждой
      топологии, сбор **всех** отказов и одно сообщение, называющее каждую
      топологию с её причиной
- [x] 8.2 `testModule(module, { stubs, config })` — мини-app вокруг одного
      модуля (с его `imports`), kernel-модуля конфига и стабов; те же фазы
      0–3 и тот же `TestApp`; `stubs` — пары «токен → значение», форма
      совместима с будущим `stub(Contract, impl)`
- [x] 8.3 Неудовлетворённые импорты модуля в изоляции завершают `testModule`
      ошибкой со **всеми** недостающими токенами и потребителем каждого
      (поверх предвалидации из группы 3)
- [x] 8.4 Рантайм-тесты: две несобираемые топологии из трёх названы в одном
      сообщении; модуль без соседей поднимается и его ручки вызываются через
      `app.call`; ошибка перечисляет оба недостающих токена, а не падает на
      первом
- [x] 8.5 Публичный `index.ts` пакета: `assembleTest`, `vars`,
      `familyOverride`, `testModule`, `checkTopologies`, `unwrap`, типы
      `TestApp`/`CheckReport`; никакой `overrideByName`-подобной формы

## 9. Витрина в `examples.app-with-http`

- [x] 9.1 `./testing`-subpath модуля пользователей: conditional export по
      условию `"testing"`, курируемая поверхность — токены, разрешённые к
      подмене, и готовый фейк репозитория
- [x] 9.2 App-тесты примера через `assembleTest` с `overrides` и `vars()`:
      успешный `call`, объявленный отказ, `app.pruned` показывает выпавший
      узел
- [x] 9.3 Тест-матрица `checkTopologies` по `select: 'all' | 'users' |
      'logging'`
- [x] 9.4 Пример собирается, запускается и его тесты зелёные

## 10. Документация

- [x] 10.1 `docs/design/testing.md` — уточнить по факту реализованного:
      `await assembleTest(…)`, `.check()` как метод корня `assemble`,
      `app.pruned`, перенос `app.emit`/`stub(Contract)` в остаток change'а;
      плашка «Целевое состояние V1» со ссылками на ideas.md и roadmap
- [x] 10.2 `docs/design/composition.md` — `App.check()` рядом с
      `run()`/`close()`; явно: `assemble` не принимает `overrides`
- [x] 10.3 `docs/design/container.md` — подстановка и прунинг как шов
      тестового корня, инвариант «без `overrides` прунинг тождественен»,
      перечень недостающих зависимостей вместо первой ошибки
- [x] 10.4 Новый гайд `docs/guides/testing.md` (app-тест против юнита и
      e2e, `overrides` + прунинг, правило «мокаешь — проверь топологию
      `.check()`», `./testing`-subpath, рецепты условия для jest и vitest) с
      плашкой «сверено с кодом `examples.app-with-http` (дата)» и строкой в
      таблице `docs/README.md`
- [x] 10.5 README пакетов: новый `packages/nestling.testing/README.md`,
      обновление `app` и `container` — включая плашки статуса
- [x] 10.6 `docs/decisions/roadmap.md` — статус change #18 (ядро) и
      оговорка, что `app.emit` уехал в остаток `testing-stub-contract`;
      отметку «РЕАЛИЗОВАНО» в секции ideas.md [2026-07-10] проставить, но
      **новую** запись в `ideas.md` не добавлять без явного «запиши» от
      пользователя (правило `CLAUDE.md`) — предложить её текст в отчёте

## 11. Definition of Done

- [x] 11.1 Все задачи `tasks.md` отмечены
- [x] 11.2 `yarn verify` зелёный (`build` + `lint` + `test` по всем пакетам)
      — 18 проектов, включая новый `@nestling/testing`
- [x] 11.3 README затронутых пакетов обновлены, включая плашки статуса —
      новый `packages/nestling.testing/README.md`, обновлены `app`
      (`check()`, subpath `./testing`, явный негатив про `overrides`) и
      `container` (шов подстановки, прунинг, перечень недостающих)
- [x] 11.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
      — `design/testing.md`, `composition.md`, `container.md`; отметка
      «РЕАЛИЗОВАНО (ядро)» в секции ideas.md [2026-07-10] со снятым
      открытым вопросом; статус #18 в roadmap
- [x] 11.5 `yarn docs:audit` — 0 ERROR
- [x] 11.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены с
      обновлённой датой в плашке «сверено с кодом» — `examples.app-with-http`
      переведён на порт `UsersRepository`; гайды `composition.md` и
      `http-app-di.md` перепроверены против нового кода (снипеты не
      затронуты, дата плашки — сегодняшняя, 2026-07-31)
- [ ] 11.7 Коммиты осмысленные, ветка запушена — *шесть коммитов готовы;
      работа идёт в ветке `autorun/v1-all-waves` (все волны одним прогоном),
      а не в `change/testing-package`. Push не прошёл по той же причине, что
      у предыдущих changes прогона: `git@github.com` отвергает единственный
      доступный ключ (`Permission denied (publickey)`), HTTPS-путь закрыт
      (`GH_TOKEN`/`GITHUB_TOKEN` не заданы, `gh` не установлен).
      Перепроверено 2026-07-31: `git push --dry-run` по-прежнему отвергается
      — требуется push с машины пользователя*
