## 1. Контейнер: тип модуля и опции билдера

- [ ] 1.1 Убрать поле `exports` из интерфейса `Module` и из JSDoc-примера над ним (`packages/nestling.container/src/modules/modules.ts`)
- [ ] 1.2 Убрать `strictExports` из `ContainerBuilderOptions` и приватное поле `#strictExports` (`builder/container.builder.ts`)
- [ ] 1.3 Убрать шаг 11 из `build()` и его пункт из JSDoc-списка шагов; в списке остаётся десять шагов
- [ ] 1.4 Удалить `checkStrictExports`, `isExportedFrom`, `computeExported`, `collectModuleExports`, интерфейс `ModuleExports` и поле `#moduleExports` вместе с его заполнением в `registerModule`
- [ ] 1.5 Убрать `exports` из сообщения о коллизии имён модулей (`moduleNameCollisionMessage`) и из того же текста в `packages/nestling.app/src/discovery.ts`
- [ ] 1.6 Проверить JSDoc-примеры с `exports` в `providers/variants.ts` и `modules/modules.ts` — привести к форме без поля

## 2. Контейнер: граф и сериализация

- [ ] 2.1 Убрать `exported` из метаданных узла (`graph/node.class.ts`) и из `toJSON()` (`graph/graph.class.ts`), включая тип `JsonDINode`
- [ ] 2.2 Убрать заполнение `exported` при построении узлов в `buildDependencyGraph` (`container.builder.ts`)

## 3. Тесты контейнера

- [ ] 3.1 Удалить `builder/strict-exports.spec.ts` целиком
- [ ] 3.2 Убрать блок `describe('агрегат и strictExports')` из `builder/family-aggregates.spec.ts`; вместо него — тест «вклад чужого модуля попадает в агрегат без объявления»
- [ ] 3.3 Убрать проверки `metadata.exported` из остальных тестов пакета (grep по `exported`), сохранив проверки `metadata.module`
- [ ] 3.4 `yarn workspace @nestling/container test` зелёный

## 4. Модули фреймворка

- [ ] 4.1 Убрать `exports` из `packages/nestling.config/src/kernel.ts`
- [ ] 4.2 Убрать `exports` из `packages/nestling.pipeline/src/core/context/kernel.ts`
- [ ] 4.3 Убрать `exports` из `packages/nestling.ports/src/kernel.ts`
- [ ] 4.4 Убрать `exports` из `packages/nestling.openapi/src/module.ts`
- [ ] 4.5 Убрать `exports` из `packages/nestling.subscriptions/src/module.ts`
- [ ] 4.6 Убрать `exports` из JSDoc-примера модуля в `packages/nestling.app/src/module.ts`

## 5. Визуализатор

- [ ] 5.1 Убрать `exported` из типов графа визуализатора (`static/src/types/graph.ts`, `graph3d.ts`, `graphTypes.ts`)
- [ ] 5.2 Убрать чтение и передачу флага в `static/src/core/data-transformer.ts`, `hooks/useGraphData.ts`, `renderer/graph-renderer.ts`
- [ ] 5.3 Убрать стили публичности из `static/css/styles.css` (`.node-item.exported`, `.node-tooltip-exported-*`, правила в `.module-detail-panel`) и подсказку про экспортированность из разметки
- [ ] 5.4 Обновить фикстуру `static/data/graph-data.json` — убрать поле `exported` из метаданных узлов
- [ ] 5.5 `yarn workspace @nestling/viz build` зелёный

## 6. Примеры

- [ ] 6.1 Убрать `exports` из пяти модулей `packages/examples.simple-app` (`database`, `api`, `health`, `logging`, `users`) вместе с комментарием про strictExports в `database.module.ts`
- [ ] 6.2 Убрать `exports` из `packages/examples.app-with-http/src/modules/logger/logger.module.ts`
- [ ] 6.3 Тесты примеров зелёные; вклады в семейство `IHealthCheck` по-прежнему попадают в агрегат

## 7. Документация: design и guides

- [ ] 7.1 `docs/design/container.md` §Модули — убрать пункт про `strictExports`, переписать абзац про инкапсуляцию: границу держат ES-модули, поля `exports` у модуля нет
- [ ] 7.2 `docs/design/container.md` §Семейства токенов — убрать предложение «Узел-агрегат не принадлежит модулю, поэтому при `strictExports` вклад требует `exports`»
- [ ] 7.3 `docs/design/principles.md` — убрать строку «`strictExports` добавляет проверку рёбер готового графа при сборке»
- [ ] 7.4 `docs/design/endpoints.md` — убрать упоминание `strictExports` в перечислении проверок узла
- [ ] 7.5 `docs/guides/di-token-families.md` — убрать раздел про `exports` и `strictExports`, переписать объяснение видимости, обновить примеры модулей
- [ ] 7.6 `docs/guides/composition.md` — убрать `exports` из примера модуля `logging` и из цитаты сообщения о коллизии имён
- [ ] 7.7 `docs/README.md` — обновить описание гайда `di-token-families.md` (убрать `strictExports` из перечня тем)
- [ ] 7.8 Обновить даты в плашках «сверено с кодом» у затронутых гайдов

## 8. Документация: preview и README пакетов

- [ ] 8.1 `docs/preview/src/concepts.md` — переписать абзац про видимость и убрать абзац про `strictExports`
- [ ] 8.2 `docs/preview/src/fundamentals.md` — убрать `exports` из примера семейства
- [ ] 8.3 Пересобрать превью: `yarn docs:preview`
- [ ] 8.4 `packages/nestling.container/README.md` — удалить раздел «Проверка экспортов: `strictExports`», убрать поле из таблицы API и из примеров модулей, поправить упоминания в разделах про семейства, агрегат и `overrides`
- [ ] 8.5 Проверить README остальных затронутых пакетов (`@nestling/config`, `@nestling/app`, `@nestling/viz`) на упоминания `exports` и плашки статуса

## 9. Журнал решений

- [ ] 9.1 Добавить запись «[2026-09-01] Модуль без exports» в `docs/decisions/ideas.md`: модуль — упаковка и атрибуция, а не граница; узость проверки (типы, `new`, `overrides`, `Config(key)`); недоступность через `assemble()`; исчезновение требования для вкладов в семейство
- [ ] 9.2 В той же записи зафиксировать отвергнутые варианты: обязательный `exports` с постоянной проверкой; сохранение opt-in флага; ESLint-правило как замена гарантии; обёртка `contribute(...)`
- [ ] 9.3 Пометить суперсид в «Решении 3» (`ideas.md`, часть про опциональную строгость) и в записи про `.all` (пункт «`strictExports`: рёбра агрегата…») со ссылкой на новую запись
- [ ] 9.4 Занести в `docs/decisions/deferred.md` тему «`Config(key)` читает любой ключ, включая секретный» с триггером возврата — это права на конфиг, а не границы модулей
- [ ] 9.5 Обновить статус в `docs/decisions/roadmap.md`, если change упоминается в волнах

## 10. Definition of Done

- [ ] 10.1 Все задачи выше отмечены
- [ ] 10.2 `yarn verify` зелёный (build + lint + test по всем пакетам)
- [ ] 10.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 10.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [ ] 10.5 `yarn docs:audit` — 0 ERROR
- [ ] 10.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены с обновлённой датой в плашке «сверено с кодом»
- [ ] 10.7 Линтер стиля: `node .claude/skills/docs-style/scripts/lint.mjs` по изменённым текстам — 0 запрещённых слов
- [ ] 10.8 Коммиты осмысленные, ветка `change/remove-module-exports` запушена
