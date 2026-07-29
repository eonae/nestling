## Why

Фаза `.after` — лишняя сущность: после границы «pipeline = значения,
transport = байты» и правила «ответный тракт не меняет тип value» у неё
не осталось легитимной работы (наблюдение на любом исходе — `finally`,
маппинг ошибок — `.catch`, обогащение успеха — `.ok`). Она же —
единственный источник путаницы в правиле порядка: `ok`/`catch`/`after` —
не три фазы, а один список, и объяснить это без абзаца оговорок нельзя.
Ни один middleware пакета, ни один пример `.after` не используют — только
спеки. Убрать сейчас почти бесплатно, после релиза — breaking; вернуть
позже, если появится реальный кейс, — обратно-совместимое добавление.

Решение зафиксировано в [docs/decisions/ideas.md](../../../docs/decisions/ideas.md),
секция «[2026-07-10] Pipeline: отказ от `.after`»; change #17 из
[roadmap.md](../../../docs/decisions/roadmap.md) (breaking-окно волны 2, размер S).

## What Changes

- **BREAKING** Метод `.after(unit)` удаляется из билдера `makePipeline()`
  (интерфейс `PhasedPipeline` и рантайм-класс `PipelineImpl`).
- **BREAKING** Тип `AfterUnitFn` удаляется из публичного экспорта
  `@nestling/pipeline`.
- Рантайм: `ResponsePhase` сужается до `'ok' | 'catch'`; проверка
  применимости ответного юнита теряет ветку `phase === 'after'` и
  сводится к `(entry.phase === 'ok') === response.isSuccess`.
- Словарь ответного тракта становится Promise-тройкой: `.ok` / `.catch` /
  `.finally`. Правило порядка сжимается до одного предложения: юниты
  исполняются в порядке объявления, `ok` применим к успеху, `catch` —
  к ошибке, ответ могут заменить; `finally` — всегда, последним.
- Семантика оставшихся фаз **не меняется**: ответный тракт по-прежнему
  один список юнитов с применимостью по текущему ответу (ok-юнит бросил →
  ответ стал ошибкой → последующие `catch` применимы).
- Миграция: `.after(u)` → `.ok(u).catch(u)`. В доке миграции фиксируется
  нюанс — если `u` бросит в роли ok-юнита, ответ станет ошибкой и `u`
  исполнится второй раз уже как catch-юнит (с `.after` — ровно один раз);
  значит, потенциально бросающую функцию не регистрируют в обе фазы одним
  значением.
- Доки и спеки: `openspec/specs/pipeline-phase-model`,
  `openspec/specs/pipeline-composition`, README и `TYPE-TESTS.md` пакета
  `@nestling/pipeline`, гайд `docs/guides/http-functional.md`;
  `docs/design/pipeline.md` и `docs/preview/` уже описывают целевую тройку —
  требуется только снятие предупреждающей оговорки в плашке гайда и
  проверка отсутствия остаточных упоминаний.

## Non-goals

- Любые другие изменения фазовой модели: `.pre`/`.ok`/`.catch`/`.finally`
  сохраняют текущую семантику, типизацию контекста (полный у `.ok`,
  `Partial` собственного слоя у `.catch`/`.finally`) и ограничения v1
  (нет восстановления `Fail → Ok`).
- Переработка `compose` и модели слоёв — порядок «снаружи внутрь» для pre
  и «изнутри наружу» для ответного тракта и `finally` не трогается.
- DX-типы точки композиции и читаемые диагностики — отдельный change
  `pipeline-type-dx` (#23).
- Возврат `.after` под другим именем или введение отдельной фазы «после
  ok/catch» — отвергнуто в записи журнала.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

- `pipeline-phase-model`: из словаря билдера, из требования type-state и
  из правила исполнения ответного тракта уходит `.after`; ответный тракт
  описывается тройкой `.ok`/`.catch`/`.finally`; тип `AfterUnitFn` больше
  не входит в публичный API.
- `pipeline-composition`: сценарий порядка исполнения при композиции
  формулируется без `after`.
- `request-abort-signal`: перечисление фаз, которым доступен `ctx.signal`,
  приводится к актуальному словарю (`.pre`/`.ok`/`.catch`/`.finally`).
  Правка чисто редакционная — доступность сигнала не меняется.

## Impact

- **Код**: `packages/nestling.pipeline/src/core/pipeline.ts` (интерфейс
  `PhasedPipeline.after`, `ResponsePhase`, `PipelineImpl.after`, проверка
  применимости, текст ошибки `pre() is not available after ...`),
  `packages/nestling.pipeline/src/core/types/unit.ts` (`AfterUnitFn`).
- **Тесты**: `pipeline.spec.ts` (типовые тесты фаз),
  `pipeline.runtime.spec.ts` (порядок ответного тракта, композиция слоёв) —
  сценарии с `.after` переписываются на `.ok`/`.catch`, добавляется
  рантайм-проверка эквивалента `.ok(u).catch(u)`.
- **Публичный API**: пропадают `PhasedPipeline.after` и `AfterUnitFn` —
  breaking для внешних потребителей; внутри репозитория потребителей нет
  (ни middlewares, ни `examples.*`, ни транспорты `.after` не вызывают).
- **Доки**: README и `TYPE-TESTS.md` пакета `@nestling/pipeline`,
  `docs/guides/http-functional.md` (таблица фаз + плашка «сверено с кодом»),
  `docs/decisions/roadmap.md` (статус change #17); `docs/design/pipeline.md`
  и `docs/preview/` — проверка на остаточные упоминания.
- **Зависимости и транспорты**: не затрагиваются.
