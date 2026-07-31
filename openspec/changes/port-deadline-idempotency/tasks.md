# Tasks: port-deadline-idempotency

Порядок — от ядра наружу (см. `design.md` → Migration Plan). Каждый раздел
самодостаточен: закончив его, `yarn verify` должен быть зелёным.

## 1. Kernel-код `DeadlineExceeded` (`@nestling/pipeline`)

- [x] 1.1 Определить `DeadlineExceeded` в `core/kernel-fails.ts`
  (`defineFail('DEADLINE_EXCEEDED', { status: 'TIMEOUT', message: … })`);
  имя без суффикса `Error` — по D5, соседи по набору называются так же
- [x] 1.2 Включить код в `KERNEL_FAIL_CODES`; обновить доккоммент набора
  (сегодня он обещает «у портов добавится `DEADLINE_EXCEEDED`» в будущем
  времени) и комментарий про `TIMEOUT` в `core/status.ts`
- [x] 1.3 Экспортировать определение из публичной поверхности
  `@nestling/pipeline`
- [x] 1.4 Рантайм-тест: отказ с кодом `DEADLINE_EXCEEDED` из ручки, не
  объявившей ничего в `errors:`, проходит стража границы нетронутым (504,
  код сохранён), а не нормализуется в `UNKNOWN`/500
- [x] 1.5 Рантайм-тест: `isKernelFailCode('DEADLINE_EXCEEDED')` истинно;
  публичного способа пометить пользовательский код встроенным нет

## 2. Конверт шины (`@nestling/ports`, `bus.ts`)

- [x] 2.1 Расширить `RequestOptions` полем `timeoutMs?: number`
  (относительный остаток бюджета), `PublishOptions` — новым типом с
  `timeoutMs?` и `idempotencyKey?`; `publish` принимает `options?`
- [x] 2.2 Расширить `BusMessageMeta` полями `deadline?: Date` и
  `idempotencyKey?: string`; обновить `IMessageBus` и его доккомменты
  (конверт — часть LCD, кодирование — дело транспорта, D9)
- [x] 2.3 `InProcessBus.request`/`publish`: провезти конверт через
  `Topic`-envelope и req-reply путь; `timeoutMs` пересчитывается в
  абсолютный момент **на приёме** по часам получателя (D2)
- [x] 2.4 `InProcessBus.#execute`: бюджет, исчерпанный к моменту приёма, даёт
  ответ `DeadlineExceeded` **без** вызова `dispatch.call`; живой бюджет
  композируется с сигналом остановки шины (`AbortSignal.any`), `subject` и
  `idempotencyKey` кладутся в `raw.attributes`
- [x] 2.5 Рантайм-тесты шины: пересчёт бюджета на приёме; исчерпанный в
  транзите бюджет → `DEADLINE_EXCEEDED` и ручка не исполнена; ключ доезжает
  в атрибутах; вызовы без `options` ведут себя как раньше

## 3. Бюджет в вызывателях (`invoker.ts`, `families.ts`)

- [x] 3.1 `PortMeta` пополняется `deadline?: Date`; ввести `CommandMeta`
  (`extends PortMeta` + `idempotencyKey?: string`) и `MetaOf<C>`, выбирающий
  словарь по виду контракта; `InvokeArgs<C>` использует `MetaOf<C>`
- [x] 3.2 Экспортировать `deadlineIn(ms: number): Date`; `deadline: number`
  не принимается (D1)
- [x] 3.3 Общий помощник бюджета: остаток по абсолютному моменту, fail-fast
  при остатке ≤ 0, `AbortSignal.timeout(остаток)` и его композиция с
  `meta.signal`; таймер заводится **только** когда бюджет задан и снимается
  по завершении вызова
- [x] 3.4 `makeLocalPort`/`makeRemotePort`: fail-fast до `dispatch`/`bus`;
  композированный сигнал уезжает в контекст обработчика; remote-путь
  отправляет относительный `timeoutMs`
- [x] 3.5 Различение отмены: `raceAbort` сообщает, **чей** сигнал сработал;
  собственный таймер бюджета → `DeadlineExceeded`, `meta.signal`
  вызывающего → `UnknownError` (по владению таймером, не по `signal.reason`)
- [x] 3.6 `makeLocalEmitter`/`makeRemoteEmitter`: бюджет как ограничение
  обработчика, `Promise<void>` не ждёт (D10); исчерпанный на call-site
  бюджет → отказ **бросается**, как у невалидного payload'а
- [x] 3.7 `KernelPortFail` пополняется `FailOf<typeof DeadlineExceeded>`;
  `DeadlineExceeded` реэкспортируется из `@nestling/ports`
- [x] 3.8 Рантайм-тесты вызывателей: fail-fast на прошедшем моменте (ни
  `dispatch`, ни шина не тронуты); обрыв медленной реализации с
  `DEADLINE_EXCEEDED`; обработчик видит исчерпание своим `ctx.signal`;
  отмена вызывающим остаётся `UnknownError`; вызов без бюджета не заводит
  таймера
- [x] 3.9 Рантайм-тест идентичности путей: одна пара «вызов с бюджетом →
  медленная реализация» под `local-first` и под `always-remote` даёт
  одинаковый результат

## 4. Ключ идемпотентности

- [x] 4.1 `emit` команды всегда едет с ключом: переданным либо
  `crypto.randomUUID()` (D7); у `event` и `request` поля нет в типе
- [x] 4.2 Local-путь кладёт ключ в `raw.attributes` контекста ровно так же,
  как remote-путь через конверт шины
- [x] 4.3 Type-тесты: `idempotencyKey` на `event`- и `request`-контракте —
  ошибка компиляции; на `command` — компилируется
- [x] 4.4 Рантайм-тесты: ключ вызывающего доезжает без подмены; два `emit`
  без ключа дают разные ключи; ключ виден обработчику на обоих путях;
  повторный ключ доставляется как обычное сообщение (дедупликации нет)

## 5. Чтение профиля из глубины

- [x] 5.1 Объявить `Deadline` (`Date`) и `IdempotencyKey` (`string`) через
  `contextVar`, экспортировать **значениями** — политика адресует значение
- [x] 5.2 Штатные писатели `withDeadline()` / `withIdempotencyKey()`,
  читающие транспортные атрибуты (по образцу `withRequestId()`)
- [x] 5.3 Рантайм-тесты: `Ctx(Deadline).peek()` даёт момент вызова и
  `undefined` у вызова без бюджета; `Ctx(IdempotencyKey).get()` даёт ключ
  доставленной команды; `everyEndpoint(…).hasVar(IdempotencyKey)` проходит
  на реализации со слоем и падает на сборке без него
- [x] 5.4 Рантайм-тест явной передачи остатка: обработчик передаёт
  `{ deadline: Ctx(Deadline).peek() }` во вложенный вызов, и общий бюджет
  соблюдается; без явной передачи вложенный вызов бюджета не наследует

## 6. Публичная поверхность и README

- [x] 6.1 `index.ts` `@nestling/ports`: `deadlineIn`, `DeadlineExceeded`,
  `Deadline`, `IdempotencyKey`, `withDeadline`, `withIdempotencyKey`,
  типы `CommandMeta`, `PublishOptions`, обновлённые `PortMeta`,
  `RequestOptions`, `BusMessageMeta`
- [x] 6.2 README `@nestling/ports` и `@nestling/pipeline` — раздел про
  эксплуатационный профиль и пополнение набора kernel-кодов, плашки статуса

## 7. Витрина, гайд и доки

- [x] 7.1 `packages/examples.app-with-http`: вызов с бюджетом и его
  исчерпание; команда с ключом идемпотентности, видимым обработчику
- [x] 7.2 `docs/guides/ports.md` — раздел «Эксплуатационный профиль»
  (сегодня там стоит «`meta.deadline` и `idempotencyKey` — change
  `port-deadline-idempotency`»), таблица двух каналов доставки профиля,
  обновлённая дата в плашке «сверено с кодом»
- [x] 7.3 `docs/design/contracts.md` §4 и `docs/design/errors.md` — по факту
  реализованного, включая переименование `DeadlineExceededError` →
  `DeadlineExceeded`
- [x] 7.4 Запись в `docs/decisions/ideas.md`: `Date` вместо числа,
  относительный timeout на проводе, три точки контроля и отмена в полёте,
  отказ от автонаследования бюджета (с прецедентом `signal`), `MetaOf<C>`
  по виду контракта, генерация ключа вызывателем, два канала доставки
  профиля, имя определения; закрытие открытого вопроса «дефолтный deadline»
  в пользу «бюджет только явный» — с отвергнутыми вариантами
- [x] 7.5 `docs/decisions/deferred.md` — автонаследование бюджета через ALS
  с триггером возврата (шумность явной передачи на практике)
- [x] 7.6 Статус change #27 в `docs/decisions/roadmap.md`

## 8. Definition of Done

- [x] 8.1 Все задачи выше отмечены
- [x] 8.2 `yarn verify` зелёный (build + lint + test по всем пакетам)
- [x] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 8.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [x] 8.5 `yarn docs:audit` — 0 ERROR
- [x] 8.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены с
  обновлённой датой в плашке «сверено с кодом»
- [ ] 8.7 Коммиты осмысленные, ветка запушена
