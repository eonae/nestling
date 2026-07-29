## 1. Типы и публичный API

- [x] 1.1 Удалить `AfterUnitFn` из `packages/nestling.pipeline/src/core/types/unit.ts`
      (вместе с doc-комментарием); убедиться, что `OkUnitFn`, `CatchUnitFn`,
      `FinallyUnitFn` не ссылаются на него
- [x] 1.2 Удалить метод `after<M>(unit)` из интерфейса `PhasedPipeline`
      в `src/core/pipeline.ts` и импорт `AfterUnitFn` из шапки файла
- [x] 1.3 Проверить, что `AfterUnitFn` больше не выходит наружу через цепочку
      `export *` (`core/types/index.ts` → `core/index.ts` → `src/index.ts`):
      `grep -rn "AfterUnitFn" packages/ --exclude-dir=node_modules --exclude-dir=dist`
      даёт пусто

## 2. Рантайм

- [x] 2.1 Сузить `type ResponsePhase` до `'ok' | 'catch'` в `src/core/pipeline.ts`
- [x] 2.2 Удалить метод `PipelineImpl.after()` (пуш в `layer.responses`
      с `phase: 'after'`)
- [x] 2.3 Свести проверку применимости ответного юнита в `executeWithHandler`
      к `const applicable = (entry.phase === 'ok') === response.isSuccess;` —
      ветка `entry.phase === 'after' ||` уходит
- [x] 2.4 Обновить текст рантайм-guard'а в `PipelineImpl.pre()`:
      `(.ok/.catch/.after/.finally)` → `(.ok/.catch/.finally)`
- [x] 2.5 Проверить, что порядок и семантика прочих фаз не изменились:
      единый список `layer.responses` в порядке объявления, `finals`
      отдельным проходом, слои изнутри наружу — правки только точечные

## 3. Тесты пакета

- [x] 3.1 `src/core/pipeline.spec.ts`, тест `response methods stay available
      after each other` — убрать строку `.after(() => {})`, цепочка остаётся
      `.ok().catch().finally()`
- [x] 3.2 `src/core/pipeline.spec.ts`, тест `catch and after see own-layer
      fields as Partial` — переименовать в `catch and finally see own-layer
      fields as Partial`; блок `.after` заменить на `.finally`-блок,
      проверяющий тот же `Partial` собственного слоя (покрытие типизации
      ответного тракта не теряется)
- [x] 3.3 Добавить type-тест: `makePipeline().after(() => {})` — ошибка
      компиляции (`@ts-expect-error`), а импорт `AfterUnitFn`
      из `@nestling/pipeline` не резолвится
- [x] 3.4 `src/core/pipeline.runtime.spec.ts`, тест порядка фаз при успехе —
      убрать `.after`-юнит; ожидаемая последовательность становится
      `pre1 → pre2 → handler → ok → finally`
- [x] 3.5 `src/core/pipeline.runtime.spec.ts`, тест цепочки `.catch`-юнитов
      (`catch1` заменяет ответ → `catch2` видит заменённый) — `.after`-юнит
      заменить третьим `.catch`, ожидания обновить с `after:fail`
      на `catch3:BAD_REQUEST`
- [x] 3.6 `src/core/pipeline.runtime.spec.ts`, тест `pre снаружи внутрь,
      ответные и finally изнутри наружу` — `.after` обоих слоёв заменить
      на `.ok`; ожидаемая последовательность становится
      `pre:base → pre:inner → handler → ok:inner → ok:base →
      finally:inner → finally:base`
- [x] 3.7 Добавить рантайм-тест порядка при ответе-ошибке в композиции
      (сценарий дельта-спека `pipeline-composition`): оба слоя объявили
      `.ok` и `.catch`, хендлер вернул `Fail` → `catch:inner → catch:base →
      finally:inner → finally:base`, ни один `.ok` не вызван
- [x] 3.8 Добавить рантайм-тест «применимость по текущему ответу»
      (сценарий дельта-спека `pipeline-phase-model`): объявлен
      `.ok(u).catch(v)`, хендлер вернул `Ok`, `u` бросил → ответ стал
      ошибкой, `v` исполнился
- [x] 3.9 Добавить рантайм-тест на нюанс миграции: одно и то же бросающее
      значение `u`, зарегистрированное как `.ok(u).catch(u)`, вызывается
      дважды (фиксирует поведение, на которое ссылается дока миграции)
- [x] 3.10 `yarn test` в `packages/nestling.pipeline` — зелёный

## 4. Дельта-спеки и README пакета

- [x] 4.1 Сверить итоговые правки кода с дельта-спеками
      `openspec/changes/pipeline-drop-after/specs/pipeline-phase-model/spec.md`
      и `.../pipeline-composition/spec.md`; при расхождении править спек,
      а не молча код
- [x] 4.2 `packages/nestling.pipeline/README.md` — убрать буллет
      `.after(unit) — any response; Partial own-layer ctx.`;
      проверить плашку статуса пакета и таблицу API
- [x] 4.3 `packages/nestling.pipeline/src/core/TYPE-TESTS.md` — строка
      «честную типизацию ctx по фазам (`.ok` — полный, `.catch`/`.after` —
      свой слой `Partial` ...)» приводится к `.catch`/`.finally`

## 5. Документация репозитория

- [x] 5.1 `docs/guides/http-functional.md` — убрать строку `.after(u)`
      из таблицы фаз; из плашки убрать оговорку «⚠️ В целевом V1 фаза
      `.after` уходит (roadmap 17)» (оговорка про `httpEndpoint`/roadmap 24
      остаётся); обновить дату в «сверено с кодом `examples.simple-http-server`»
- [x] 5.2 Проверить `docs/design/pipeline.md` и `docs/preview/*.html`
      на остаточные упоминания `.after` — ожидается, что они уже описывают
      тройку `.ok`/`.catch`/`.finally`; при находках привести к целевому виду
- [x] 5.3 Проверить `packages/examples.*` и `packages/nestling.transport*`
      на вызовы `.after` — ожидается пусто; при находках мигрировать
      на `.ok`/`.catch`
- [x] 5.4 `docs/decisions/roadmap.md` — обновить статус change #17
      `pipeline-drop-after`. Новую запись в `decisions/ideas.md` НЕ добавлять:
      решение уже зафиксировано секцией «[2026-07-10] Pipeline: отказ
      от `.after`»
- [x] 5.5 Прогнать `grep -rn "\.after(\|AfterUnitFn\|'after'" packages/ docs/design
      docs/guides docs/preview openspec/specs --exclude-dir=node_modules
      --exclude-dir=dist` — пусто (`history/` и `openspec/changes/archive/`
      не трогаем: immutable)

## 6. Definition of Done

- [ ] 6.1 Все задачи выше отмечены
- [ ] 6.2 `yarn verify` зелёный (`build` + `lint` + `test` по всем пакетам)
- [ ] 6.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 6.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [ ] 6.5 `yarn docs:audit` — 0 ERROR
- [ ] 6.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены
      с обновлённой датой в плашке «сверено с кодом»
- [ ] 6.7 Коммиты осмысленные, ветка `change/pipeline-drop-after` запушена
