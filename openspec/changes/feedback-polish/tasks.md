## 1. Правило языка в линтере

- [x] 1.1 Добавить в `.config/eslint.config.js` правило `no-restricted-syntax`
  с двумя селекторами: строковый `Literal` и `TemplateElement` с кириллицей в
  значении. Сообщение называет требование и ссылается на capability
  `runtime-message-language`
- [x] 1.2 Ограничить область правила файлами `src/**/*.ts`, исключив
  `*.spec.ts`, `*.test.ts`, `*.type-test.ts` и `__fixtures__/**`
- [x] 1.3 Добавить `createEslintConfig` второй аргумент `options` с полем
  `published` (умолчание `true`); `published: false` выключает только правило
  языка. Причину и границу записать в JSDoc фабрики одним экземпляром
- [x] 1.4 Передать `{ published: false }` во всех шести
  `examples/*/eslint.config.js`
- [x] 1.5 Проверить, что `lint` падает на русской строке в `src/` пакета и
  молчит на спеке, фикстуре, комментарии и JSDoc

## 2. Перевод строк, которые видит пользователь

- [x] 2.1 `packages/nestling.transport.http/src/probes.ts`: причина `detached`
  и `doc.hidden` проб — по-английски
- [x] 2.2 `packages/nestling.openapi/src/module.ts`: причина `doc.hidden`
  endpoint'а документа — по-английски
- [x] 2.3 `packages/nestling.subscriptions/src/operations.ts`: `summary` и
  `description` фактов `subscriptions.opened` и `subscriptions.closed` —
  по-английски
- [x] 2.4 `packages/nestling.outbox/src/operations.ts`: `summary` и
  `description` фактов `outbox.published` и `outbox.stuck` — по-английски
- [x] 2.5 `packages/common.misc/src/validate.ts`: сообщения
  `NotAStandardSchemaError` и `AsyncSchemaNotSupportedError` — целиком
  по-английски, подсказка о причине сохранена
- [x] 2.6 Прогнать `yarn lint` по всем пакетам: 0 совпадений правила языка

## 3. Страховка от `any` в форме компонента

- [x] 3.1 В `packages/nestling.container/src/providers/role.decorators.ts`
  вывести тип экземпляра через `infer` и отсечь `any` приёмом
  `0 extends 1 & Inst` до сравнения с `HandlerShape`
- [x] 3.2 Проверить рантайм-спеками пакета, что поведение декораторов не
  изменилось, а `@ts-expect-error` в спеках по-прежнему стоят там же

## 4. Снапшоты диагностик контейнера

- [x] 4.1 Завести `packages/nestling.container/type-tests/` по образцу
  `@nestlingjs/transport.http`: `tsconfig.json`, `support/compile.ts`,
  `support/fixture-kit.ts`, `diagnostics.spec.ts`. В шапке `compile.ts`
  записать, что это третья копия и когда её выносят (design D5)
- [x] 4.2 Добавить фикстуру: класс без метода `handle` с лишним DI-токеном в
  `@Component([...])`. Сверка показала: этот случай ограничение параметра
  проходит и чужого текста не даёт — добавлена вторая фикстура с
  переставленными DI-токенами, на которой утечка и воспроизводится
- [x] 4.3 Добавить фикстуру: класс с методом `handle`, объявленный
  `@Component` — обратный случай, который должен остаться ошибкой про
  `@Handler`
- [x] 4.4 Включить `type-tests` в `tsconfig.json` пакета, исключить
  `type-tests/fixtures`; проверить, что `tsconfig.build.json` их не берёт и
  `dist` не изменился
- [x] 4.5 Снять снапшоты и прочитать глазами: в тексте ошибки длины списка нет
  ни `@Handler`, ни `handle`

## 5. Пустой ответ и подъём `find-my-way`

- [x] 5.1 В `packages/nestling.transport.http/src/adapter.ts` поставить
  `content-length: 0` в ветке `value === null` для всех статусов, кроме 204 и
  304
- [x] 5.2 Рантайм-тесты транспорта: редирект `302` несёт `content-length: 0` и
  не несёт `transfer-encoding`; `Ok.noContent()` не несёт ни того, ни другого
- [x] 5.3 Поднять `find-my-way` до `^9.7.0` в
  `packages/nestling.transport.http/package.json`, обновить `yarn.lock`
- [x] 5.4 Прогнать спеки и `e2e` транспорта; сверить поведение маршрутизации
  на параметрах, wildcard и повторном паттерне. Спеки транспорта зелёные
  (162 теста). Маршрутизация на 9.9.0 совпадает с восьмёркой: параметры,
  вложенные параметры, wildcard, промах, чужой метод, дубликат паттерна
  бросает. `e2e` примера `app-with-http`: 16 из 17, падение
  `users-crud` на `Location` у 201 — красное и до change'а, воспроизведено
  с откатом adapter.ts и с `find-my-way` 8.2.2; endpoint примера заголовок
  не ставит, ждёт решения отдельно
- [x] 5.5 Прогнать `yarn bench:http` под Node 24 и сравнить с цифрами
  change'а 38; расхождение записать в отчёт change'а. `GET` 0.89 от
  Fastify против 0.92, `POST` 1.13 против 1.14 — в пределах ±0.04, которые
  change 38 назвал шумом. Числа в записи `ideas.md`

## 6. Тексты для пользователя

- [x] 6.1 Убрать `Ok.of` из трёх JSDoc: два в
  `packages/nestling.transport.http/src/helpers.ts` и один в
  `packages/nestling.app/src/health/tokens.ts` — форма записи `new Ok(value)`
- [x] 6.2 Добавить в корневой `README.md` раздел «When Nestling is not the
  tool» после «What it is»: три-четыре предложения о том, что сервис без
  разделения на процессы, без типизированного клиента и без документации из
  кода дешевле написать на Fastify
- [x] 6.3 Обновить блок кода в `docs/guide/26-extending.md`, цитирующий
  `operations.ts` подписок, и дату в плашке «сверено с кодом» главы
- [x] 6.4 Прогнать `node .claude/skills/docs-style/scripts/lint.mjs` по
  изменённым русским текстам — 0 запрещённых слов

## 7. Документация решений

- [x] 7.1 Обновить README затронутых пакетов, если менялись описания экспортов
  или плашки статуса (`container`, `transport.http`, `openapi`, `outbox`,
  `subscriptions`, `common.misc`). Сверка: правок нет — экспорты и плашки
  change не трогает, переведённых строк README не цитируют, версию
  `find-my-way` README транспорта не называет
- [x] 7.2 Записать правило языка в `docs/README.md` или `docs/conventions.md` —
  туда, где живут правила репозитория, одним экземпляром
- [x] 7.3 Поставить на записи `docs/decisions/ideas.md` [2026-09-12]
  «Runtime-строки на английском и четыре починки по первому внешнему прогону»
  пометку «РЕАЛИЗОВАНО» с тем, что вышло целиком, что уехало дальше и чем
  реализация уточнила решение (в том числе два лишних места в
  `@nestlingjs/common.misc` и флаг `published` у фабрики конфига)
- [x] 7.4 Обновить статус change'а 67 в `docs/decisions/roadmap.md`

## 8. Definition of Done

- [x] 8.1 Все задачи выше отмечены
- [x] 8.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` +
  `type-budget` по всем пакетам)
- [x] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 8.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`, а
  запись `ideas.md`, по которой шёл change, несёт пометку «РЕАЛИЗОВАНО»
- [x] 8.5 `yarn docs:audit` → 0 ERROR
- [x] 8.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с
  обновлённой датой в плашке «сверено с кодом» (ожидается: примеры — только
  строка `published: false` в конфиге линтера, из глав затронута 26)
- [ ] 8.7 Коммиты осмысленные, ветка `change/feedback-polish` запушена
