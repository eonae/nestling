# Точка возобновления: что показал аудит до правки README

Снято на задаче 2.9, сразу после того как четыре инварианта появились в
`.claude/skills/docs-audit/scripts/check.mjs`. Прогон: `yarn docs:audit`.

**Итог первого прогона: 128 ERROR по 18 файлам `packages/*/README.md`.**
Все восемнадцать README нарушают хотя бы один инвариант.

## Время аудита (задача 2.8)

| Прогон | Время (5 замеров, медиана) |
|---|---|
| До инвариантов README | 1.19 с |
| После | 1.40 с |

Разбор восемнадцати барелей через TypeScript compiler API стоит 340 мс:
218 мс — загрузка `typescript`, 122 мс — сам разбор. Аудит замедлился на 18 %,
поэтому все четыре инварианта остаются в слое 1 (`/docs-audit quick`), а
полнота перечня в полный аудит не переносится.

## Публичные имена по пакетам

Числа сняты `node .claude/skills/docs-audit/scripts/package-exports.mjs
<пакет>`. Столбец «строк на перечень» — оценка: сумма длин имён с обратными
кавычками и запятыми, делённая на 76 символов в строке.

| Пакет | README, строк | Публичных имён | Строк на перечень |
|---|---|---|---|
| `@nestling/app` | 2092 | 287 (282 корень + 5 `./testing`) | 68 |
| `@nestling/operations` | 481 | 168 | 36 |
| `@nestling/container` | 992 | 96 (корень) + 19 (`./tokens`) | 22 |
| `@nestling/transport.http` | 595 | 62 | 15 |
| `@nestling/transport.nats` | 218 | 29 + 9 (`./testing`) | 10 |
| `@nestling/outbox` | 226 | 24 | 7 |
| `@nestling/testing` | 422 | 24 | 5 |
| `@nestling/subscriptions` | 228 | 17 | 4 |
| `@nestling/openapi` | 150 | 16 | 4 |
| `@common/misc` | 42 | 14 | 3 |
| `@nestling/client` | 97 | 9 | 2 |
| `@nestling/transport.cli` | 143 | 9 | 2 |
| `@common/graphs` | 11 | 5 | 1 |
| `@nestling/models` | 284 | 3 | 1 |
| `@nestling/eslint-plugin` | 199 | 2 | 1 |
| `@nestling/openapi.zod` | 58 | 2 | 1 |
| `@common/static-server` | 10 | 2 | 1 |
| `@nestling/viz` | 29 | нет барреля, команда `nestling-viz` | — |

Реэкспорт соседних пакетов: `@nestling/app` берёт имена из
`@nestling/operations` и `@common/misc`, `@nestling/operations` — из
`@common/misc`, `@nestling/openapi` и `@nestling/testing` — из
`@nestling/app`, `@nestling/transport.http` — из `@nestling/operations`.

## Расхождение с числами design.md

`design.md` оценивал перечни по старому подсчёту: 125 собственных имён у
`app`, 67 у `operations`, 45 у `container` и `transport.http`. Фактические
числа выше в два-три раза. Бюджет «Экспорты — 40 строк» выполним у всех
пакетов, кроме `@nestling/app` (68 строк только на имена) и
`@nestling/operations` (36 строк на имена плюс заголовки групп).

## Нарушения по файлам

Категории: `pkg-readme-sections` — состав и порядок разделов,
`pkg-readme-length` — потолок 120 строк, `pkg-readme-plate` — плашка статуса,
`pkg-exports` и `pkg-exports-budget` — перечень экспортов. Раздела «Экспорты»
сегодня нет почти нигде, поэтому проверка перечня по большинству пакетов ещё
не срабатывала: она включится, когда раздел появится.

| Пакет | Разделы | Потолок | Плашка |
|---|---|---|---|
| `@common/graphs` | разделов нет | — | нет плашки |
| `@common/misc` | «Типы схем», «Единая точка валидации» | — | нет плашки |
| `@common/static-server` | разделов нет | — | нет плашки |
| `@nestling/app` | 7 лишних | 2092 | 6 design-доков, 7 глав |
| `@nestling/client` | 3 лишних | — | — |
| `@nestling/container` | 6 лишних | 992 | — |
| `@nestling/eslint-plugin` | 2 лишних, нет «Минимального примера» | 199 | нет ссылок |
| `@nestling/models` | 3 лишних | 284 | нет ссылок |
| `@nestling/openapi` | 5 лишних | 150 | — |
| `@nestling/openapi.zod` | 4 лишних, нет «Минимального примера» | — | — |
| `@nestling/operations` | 12 лишних | 481 | — |
| `@nestling/outbox` | 7 лишних | 226 | нет ссылок |
| `@nestling/subscriptions` | 4 лишних | 228 | — |
| `@nestling/testing` | 11 лишних | 422 | — |
| `@nestling/transport.cli` | 5 лишних | 143 | нет ссылки на design |
| `@nestling/transport.http` | 10 лишних | 595 | 5 глав гайда |
| `@nestling/transport.nats` | 2 лишних | 218 | — |
| `@nestling/viz` | «Использование», нет трёх разделов | — | нет плашки |

Отдельно: `packages/nestling.viz/package.json` объявляет вход `.` на
`./dist/index.js`, а файла `src/index.ts` в пакете нет. Пакет ставится ради
команды `nestling-viz`.
