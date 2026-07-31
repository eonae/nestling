# tasks — async-context: read-only ALS-проекция pipeline-контекста

Порядок снизу вверх (переменные и ридеры в ядре → ALS-scope в рантайме
пайплайна → прямой путь транспорта → множество объявленных переменных и
предикат → kernel-модуль в корне → тестовый корень → витрина → доки): каждая
группа оставляет репозиторий собираемым, откат — отбрасыванием верхних
ступеней. Change аддитивный: ломающих правок публичного API нет.

## 1. Переменные и ридеры в `@nestling/pipeline`

- [x] 1.1 Новый модуль `packages/nestling.pipeline/src/core/context/` —
      `contextVar<T>(key)`: значение с `key`, рантайм-идентичностью и
      фантомным типом; типы `ContextVar<T>` (с `provide`) и
      `ReadonlyContextVar<T>` (без `provide`), общий `AnyContextVar<T>`
- [x] 1.2 Fail-fast объявления: не-строка, пустой и пробельный ключ —
      ошибка в момент вызова; ключ `'signal'` зарезервирован, текст отсылает
      к готовой переменной `Signal`
- [x] 1.3 `Var.provide(compute)` → `PreUnitFn<TReq, { [key]: T }>`: добавку
      строит переменная из своего ключа; `compute` получает
      `ExtendableContext<TReq>` и возвращает `T | Promise<T>`; на значении
      юнита — **неперечислимая** symbol-пометка с переменной и `@internal`
      читалка `declaredVarOf(unit)`
- [x] 1.4 `Signal: ReadonlyContextVar<AbortSignal>` — well-known
      переменная; `provide` отсутствует в типе и бросает в рантайме (для
      JS-потребителей)
- [x] 1.5 ALS-store (`AsyncLocalStorage<RequestCell>`), ячейка
      `{ input, signal, phase }` и `@internal` API писателя: `runInScope(cell,
      fn)`, `updateInput(cell, input)`, `setPhase(cell, phase)`; публичного
      сеттера нет
- [x] 1.6 Приватное семейство `Ctx` (`makeTokenFamily<AnyCtxReader, [key:
      string]>('Ctx')`) и публичный типизированный аксессор
      `Ctx(variable) → TokenString<CtxReader<T>>`; тип `CtxReader<T>` с
      `get()`/`peek()`
- [x] 1.7 Реализация ридера: `peek()` — по присутствию ключа в
      `cell.input` (`in`, не `!== undefined`), для `Signal` — по наличию
      scope'а; `get()` — `ContextVarUnavailableError` (обычный `Error`) с
      тремя текстами из design'а (нет scope'а / ответный тракт / переменная
      не объявлена), каждый называет починку
- [x] 1.8 `RequestId: ContextVar<string>` как well-known переменная;
      `withRequestId()` переписан через `RequestId.provide(…)` с **прежней**
      сигнатурой `PreUnitFn<EmptyInput, { requestId: string }>`
- [x] 1.9 Экспорт из `core/index.ts`: `contextVar`, `Ctx`, `Signal`,
      `RequestId`, типы `ContextVar`, `ReadonlyContextVar`, `CtxReader`,
      `ContextVarUnavailableError`; машинерия проекции и семейство `Ctx`
      наружу **не** экспортируются
- [x] 1.10 Рантайм-тесты переменных и ридеров: объявление и идентичность;
      отвергнутые ключи (`''`, `'  '`, не-строка, `'signal'`);
      `Signal.provide` бросает; `peek()` вне scope'а — `undefined`; три
      текста `get()` проверяются по подстрокам-починкам; `peek()` отличает
      присутствующий ключ со значением `undefined` от отсутствующего
- [x] 1.11 Type-тесты: `Ctx('requestId')` со строкой — ошибка компиляции;
      `Ctx(RequestId)` даёт `CtxReader<string>`; `Signal.provide` — ошибка
      компиляции; `RequestId.provide(() => 1)` — ошибка компиляции

## 2. Scope в рантайме пайплайна

- [x] 2.1 `PipelineImpl.executeWithHandler` открывает scope вокруг **всего**
      тела: pre-тракт, хендлер, ответный тракт, `enforceContract`, `finally`
      (`packages/nestling.pipeline/src/core/pipeline.ts`)
- [x] 2.2 Обновление ячейки: `cell.input` после каждого pre-юнита, фазы
      `'pre' → 'handler' → 'response' → 'finally'` на переходах
- [x] 2.3 Потоковый путь: обёртка выходного итератора (`withFinish` рядом с
      `bindOutputStream`) прокатывает каждый `next()` и финализацию в той же
      ячейке с `phase: 'stream'` — итератор возвращается наружу до того, как
      транспорт начнёт его тянуть
- [x] 2.4 Рантайм-тесты: сервис в хендлере видит поля, положенные
      pre-юнитами, и не видит положенных позже; `.catch`/`.finally` читают
      проекцию того же запроса; на упавшем pre-тракте `peek()` —
      `undefined`, `get()` бросает; вложенное исполнение даёт вложенный
      scope и восстанавливает внешний
- [x] 2.5 Рантайм-тесты потока: асинхронный генератор читает `requestId` на
      каждом элементе; `finally` потокового пути читает ту же проекцию;
      отложенный `setTimeout`, сработавший после ответа, видит финальный
      `input` (документированное поведение)
- [x] 2.6 Рантайм-тест неизменности исполнения: порядок pre-трактов,
      ответных фаз, `finally` и содержимое ответа на композиции из трёх
      слоёв совпадают с эталоном до введения проекции

## 3. Прямой путь `@nestling/transport`

- [x] 3.1 `callDirectly` в `makeDispatch`
      (`packages/nestling.transport/src/dispatch.ts`) открывает scope с
      пустым `input` и `signal` запроса
- [x] 3.2 Рантайм-тест: у ручки без пайплайна `peek()` даёт `undefined`
      (а не бросает «контекста нет»), `Ctx(Signal).get()` — сигнал запроса

## 4. Объявленные переменные на пайплайне и предикат `hasVar`

- [x] 4.1 Множество объявленных переменных в `PipelineImpl` рядом с
      `sources`: `emptyLayer()` → пустое, `.pre(unit)` → плюс
      `declaredVarOf(unit)` (для юнита иной формы — ничего), `compose(...)` →
      объединение аргументов, `bind()` → множество оригинала
- [x] 4.2 `@internal` предикат `declaresVar(pipeline, variable)` рядом с
      `derivesFrom` (ссылочное равенство переменных)
- [x] 4.3 `.hasVar(variable, label?)` в `EndpointPolicyBuilder`
      (`src/metadata/policy.ts`): ручка без пайплайна нарушает; detached
      отсеивается тем же `subjectsUnder`; `describe()` и `detail` называют
      переменную (метку — если передана) и починку `<Var>.provide(…)`
- [x] 4.4 Рантайм-тесты множества: композиция объединяет; деривация
      сохраняет и не мутирует исходный слой; `bind()` сохраняет; юнит,
      кладущий поле «вручную», объявителем не считается
- [x] 4.5 Рантайм-тесты предиката: инвариант соблюдён; ручка без писателя
      перечислена в нарушениях с паттерном, транспортом и модулем; ручка без
      пайплайна нарушает; detached исключена; переменная-омоним (второй
      `contextVar('requestId')`) политику не удовлетворяет

## 5. Kernel-модуль ридеров в корне

- [x] 5.1 `contextKernel()` — модуль с одним `familyProvider(CtxFamily, (key)
      => …)`, рецепт отдаёт stateless-ридер ключа; токен семейства из
      публичного экспорта пакета не виден
- [x] 5.2 Регистрация в `App.#assemble()` рядом с `configKernel`
      (`packages/nestling.app/src/app.ts`)
- [x] 5.3 Рантайм-тесты: класс с `Ctx(RequestId)` собирается в корне без
      единого упоминания контекста; без читателей в графе нет ни одного узла
      семейства `Ctx`; узел ридера присутствует в сериализации графа;
      `valueProvider(Ctx(RequestId), reader)` перекрывает рецепт

## 6. Тестовый корень

- [x] 6.1 `contextValue(variable, value)` в `@nestling/testing`
      (`packages/nestling.testing/src/`): `valueProvider(Ctx(variable), …)` с
      фиксированным ридером; экспорт из `index.ts`
- [x] 6.2 Рантайм-тесты: сервис читает подставленное значение без
      `app.call`; подмена приоритетна над значением, положенным пайплайном;
      без подмены `app.call` даёт боевое поведение проекции

## 7. Витрина `examples.app-with-http`

- [x] 7.1 `RequestId` кладётся слоем наблюдаемости через
      `RequestId.provide(…)` (или штатный `withRequestId()`), логгер/репозиторий
      читает `Ctx(RequestId)` вместо протаскивания параметром
- [x] 7.2 Политика `everyEndpoint({ transport: HttpTransport$ }).hasVar(
      RequestId, 'requestId')` в корне `main.ts` рядом с существующей
      `hasLayer`; `Health` остаётся единственной detached-ручкой
- [x] 7.3 Тест примера: `contextValue` в тестовом корне и прогон ручки через
      `app.call` с проверкой, что глубокий сервис увидел `requestId`

## 8. Целевые доки и журнал

- [x] 8.1 `docs/design/container.md`, секция «Асинхронный контекст» — до
      финального API: писатель `Var.provide`, ридер `Ctx(Var)`, ячейка и её
      единственный писатель, `get()/peek()`, `hasVar`, отсутствие
      `propagate` в V1 (приезжает с #12) и отсутствие пакета
      `@nestling/context`
- [x] 8.2 `docs/design/pipeline.md` §7 — `hasVar` в словаре предикатов;
      строка «та же машинерия обслуживает проверку присутствия ambient-vars»
      уточняется до реализованной формы
- [x] 8.3 `docs/design/testing.md` — подмена ридера и `contextValue`
      (строка про `valueProvider(Ctx(X), value)` приводится к факту)
- [x] 8.4 `docs/decisions/ideas.md`, секция [2026-07-10] «Асинхронный
      контекст»: отметка «РЕАЛИЗОВАНО» со ссылкой на change; закрытие
      открытого вопроса «рантайм-декларация добавок» (принят
      `Var.provide`, `RequestId.of` отвергнут — невидим на `build()`);
      пометка ~~резервирования `@nestling/context`~~ в записи [2026-07-06]
      как СУПЕРСИД
- [x] 8.5 **Новую** запись в `ideas.md` не добавлять без явного «запиши»
      (правило `CLAUDE.md`) — предложить её текст в отчёте: «писатель
      ambient-переменной — конструктор юнита от самой переменной; проверка
      присутствия — предикат `hasVar`, не вывод из графа»
- [x] 8.6 `docs/decisions/roadmap.md`: статус change #16 и ссылка на архив
      после `/opsx:archive`

## 9. Гайды и README

- [x] 9.1 `docs/guides/http-app-di.md`: раздел «Ambient-контекст: `Ctx` в
      глубине» — объявление переменной, слой-писатель, инжект ридера,
      `get()` vs `peek()`, политика в корне; плашка «сверено с кодом
      `examples.app-with-http` (дата)» обновлена
- [x] 9.2 `docs/guides/testing.md`: `contextValue` в перечне швов подмены;
      плашка обновлена
- [x] 9.3 README `@nestling/pipeline`: ambient-контекст (переменные, ридеры,
      scope, `hasVar`), правило «одна копия пакета — один ALS»; плашка
      статуса
- [x] 9.4 README `@nestling/app`, `@nestling/transport`, `@nestling/testing`:
      kernel-модуль ридеров, scope на прямом пути, `contextValue`; плашки
      статуса

## 10. Definition of Done

- [x] 10.1 Все задачи `tasks.md` отмечены
- [x] 10.2 `yarn verify` зелёный (`build` + `lint` + `test` по всем пакетам)
- [x] 10.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 10.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [x] 10.5 `yarn docs:audit` — 0 ERROR
- [x] 10.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены с
      обновлённой датой в плашке «сверено с кодом»
- [x] 10.7 Коммиты осмысленные, ветка запушена
