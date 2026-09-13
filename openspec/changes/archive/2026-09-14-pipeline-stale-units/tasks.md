## 1. Удаление юнитов

- [x] 1.1 Удалить `packages/nestling.app/src/pipeline/middlewares/identity.ts`
- [x] 1.2 Удалить `packages/nestling.app/src/pipeline/middlewares/permissions.ts`
- [x] 1.3 Удалить `packages/nestling.app/src/pipeline/middlewares/logging.ts` и
      `logging.spec.ts`
- [x] 1.4 Убрать `withIdentity`, `withPermissions` из барелей
      (`src/pipeline/index.ts`, `src/index.ts`) — `withRequestLogging` там
      и так не было
- [x] 1.5 `yarn test` и `yarn build` пакета `@nestlingjs/app` — убедиться,
      что ни один оставшийся файл не ссылается на удалённые модули

      Инвентаризация propose не нашла `src/pipeline/core/pipeline.spec.ts`
      (типовые тесты билдера) и JSDoc-пример в `src/pipeline/core/pipeline.ts` —
      оба использовали все три юнита. Правка по тому же принципу, что и
      §2: `pipeline.spec.ts` получил локальные `withIdentity`/`withPermissions`
      с тем же типовым контрактом (см. §2), `withRequestLogging` убран из
      цепочки без замены — он не добавлял поле в `TAcc`, накопление уже
      проверяют оставшиеся три pre-юнита теста. JSDoc-пример в `pipeline.ts`
      заменён на `withIdempotencyKey()` (публичный юнит той же формы
      `PreUnitFn<EmptyInput, {…}>`, естественный «доп. слой» для compose).

## 2. Type-test фикстуры

- [x] 2.1 `compose-wrong-order.ts` — заменить `withIdentity`/`withPermissions`
      на локальные инлайн pre-юниты той же формы входа/выхода (типовой
      эффект теста — порядок слоёв — не должен измениться)
- [x] 2.2 `compose-arity3-inner.ts` — та же замена `withIdentity`
- [x] 2.3 `pre-requires-missing.ts` — та же замена `withPermissions`

      `type-tests/support/fixture-kit.ts` получил `testUser: User` (вместо
      async `authenticate`, больше не нужного) и `needsIdentity()` —
      pre-юнит с requirement `{ identity: User }`, тот же типовой эффект,
      что был у `withPermissions`. Замена в `pipeline.spec.ts` (core) —
      свои локальные функции, см. §1.5.
- [x] 2.4 Прогнать type-tests пакета: диагностики (неверный порядок,
      арность 3, отсутствующее поле) должны срабатывать как раньше

      Снапшот обновлён (`jest -u`): различие только в номере строки/колонки
      (файлы стали короче), текст диагностик и типы в сообщениях
      не изменились. `yarn test` пакета — 991/991 зелёных,
      `yarn build` — без ошибок.

## 3. Документация и README

- [x] 3.1 `docs/design/pipeline.md` — заменить пример с `withIdentity()`
      на юнит, остающийся в публичном экспорте

      Пример compose переписан на `withIdempotencyKey()` (юнит `PreUnitFn<
      EmptyInput, {…}>`, остаётся в публичном экспорте): переменная
      `authed` → `withIdempotency`, комментарий про TReq следующего слоя
      обновлён на `idempotencyKey`.
- [x] 3.2 `docs/en/design/pipeline.md` — тот же пример, английская версия
- [x] 3.3 `docs/design/testing.md` — заменить упоминание
      `withRequestLogging(spy.logger)`

      Предложение обобщено: «передаётся напрямую в юнит, который принимает
      `Logger` аргументом» — без привязки к конкретному удалённому имени
      (пакет `@nestlingjs/testing` transport-агностичен, юнит из другого
      пакета выглядел бы чужеродно в этом примере).
- [x] 3.4 `docs/en/design/testing.md` — тот же пример, английская версия
- [x] 3.5 `packages/nestling.app/src/pipeline/core/TYPE-TESTS.md` —
      заменить примеры с `withIdentity`/`withPermissions`

      Примеры оставлены с теми же именами: `pipeline.spec.ts` (см. §1.5)
      теперь сам определяет локальные `withIdentity`/`withPermissions` с
      тем же типовым эффектом, так что документация остаётся точным
      отражением реального файла. Добавлена одна поясняющая строка о том,
      что это не публичный API.
- [x] 3.6 `packages/nestling.app/README.md` и `README.ru.md` — убрать три
      имени из списка публичных экспортов
- [x] 3.7 `node .claude/skills/docs-style/scripts/lint.mjs` по всем
      изменённым текстовым файлам — 0 запрещённых слов

## 4. Спеки openspec

- [x] 4.1 Сверить дельта-спеки `specs/kernel-logger`,
      `specs/pipeline-phase-model`, `specs/packages-layout` с итоговым
      кодом: имена в MODIFIED-примерах должны совпадать с реально
      оставшимися юнитами и функциями

      Все три уже совпадают с кодом: `pipeline-phase-model` использует
      `withRequestId()`/`withTracing()` (оба остаются в экспорте),
      `packages-layout` использует `readSectionSnapshot` (реально
      внутреннее имя, не экспортируется из `src/index.ts`). Путь
      `src/config/registry.ts` в соседнем, не тронутом этим change'ем
      сценарии того же требования не совпадает с реальным
      `src/config/kernel.ts` — расхождение предшествует этому change'у, и
      design.md прямо исключает общий аудит текста спек, поэтому не
      тронуто.

## 5. Definition of Done

- [x] 5.1 Все задачи выше отмечены
- [x] 5.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` +
      `type-budget`) по всем пакетам

      28 проектов — успех, 0 ошибок (119 предупреждений
      `import-through-barrel`, все на строках, не тронутых этим change'ем).
- [x] 5.3 README затронутых пакетов обновлены, включая плашки статуса

      Единственный затронутый пакет — `@nestlingjs/app`; плашка статуса
      (🚧 Active development) не связана с составом экспортов, менять
      нечего.
- [x] 5.4 `design/` и `decisions/` синхронизированы; запись `ideas.md`
      «Разбор обзоров d/10 и d/13», п. 6, несёт пометку «РЕАЛИЗОВАНО» с
      итогом (удалено, не переписано — с обоснованием)

      `design/` менять не пришлось: удаляемые юниты не были описаны design-
      доками отдельно (только мимоходом в примерах, уже поправленных в §3).
      Запись `ideas.md` дополнена блоком «РЕАЛИЗОВАНО 2026-09-13, пункт 6»
      по образцу соседних записей того же разбора — с найденным
      расширением скоупа (§1.5).
- [x] 5.5 `yarn docs:audit` → 0 ERROR

      0 ERROR, 0 WARN.
- [x] 5.6 Затронутые `examples/*` мигрированы (ожидается: нет изменений —
      юниты нигде в примерах не использовались), гайды пересверены с
      обновлённой датой в плашке «сверено с кодом», если задеты

      Подтверждено: `examples/*/src` не ссылается на три юнита (только
      закэшированные `dist/*.map`, игнорируются git). Ни одна глава
      `docs/guide/` их не упоминала — пересверять нечего.
- [ ] 5.7 Коммиты осмысленные, `main` не тронут — слияние делает Merger
      после `/opsx:archive`
