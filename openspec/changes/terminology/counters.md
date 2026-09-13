# Счётчики словаря

Рабочая заметка change'а: замеры «до» и «после» для ворот 4.2 и 7.2.
Считал временный скрипт `scripts/tmp-terminology-rename.mjs` — тем же
набором правил, каким шла замена, поэтому «после» обязано давать ноль.
Скрипт удалён задачей 8.1; повторить замер можно `grep` из раздела ниже.
Архивы (`openspec/changes/archive/`, `docs/history/`, `docs/decisions/`)
из счёта исключены.

База замера — `main` после слияния `change/examples-rework`: ветка
перебазирована на него, и цифры «до» пересняты.

## До

| Область | `assemble` + `*Unit*` + «юнит», файлов | замен | «член семейства», файлов | замен | «юнит-тест» |
| --- | --- | --- | --- | --- | --- |
| `packages/` | 227 | 1456 | 34 | 70 | 4 |
| `examples/` | 22 | 56 | 0 | 0 | 2 |
| `docs/` | 96 | 1207 | 12 | 28 | 21 |
| `openspec/specs/` | 63 | 490 | 20 | 49 | 0 |
| `.claude/skills/` | 2 | 11 | 0 | 0 | 0 |

Слово «член» во всех значениях — 473 вхождения; в значении токена
семейства их взяла задача 5.10.

## После

| Область | старые формы | «член» | «юнит-тест» |
| --- | --- | --- | --- |
| `packages/` | 0 | 4 (исключения) | 4 |
| `examples/` | 0 | 0 | 2 |
| `docs/` | 8 (исключения) | 1 (исключение) | 21 |
| `openspec/specs/` | 0 | 2 (исключения) | 0 |
| `.claude/skills/` | 7 (исключения) | 0 | 4 |

Счётчик «юнит-теста» совпал со строкой «до» во всех областях, кроме
`.claude/skills/`: там его подняла новая подсказка линтера, которая сама
называет исключение.

## Исключения

Вхождения, которые остались намеренно:

- колонки запрещённых синонимов в `docs/glossary.md`, `docs/en/glossary.md`
  и таблице замен `.claude/skills/docs-style/SKILL.md`: там старое имя и
  есть содержание строки;
- правила и подсказки `.claude/skills/docs-style/scripts/lint.mjs`,
  которые ловят «юнит», `pre-unit` и «член»;
- требование capability `docs-terminology`, формулирующее тот же запрет;
- `docs/design/testing.md` — «unit- и модульные тесты», термин индустрии;
- английское `unit` в значении «единица состава»: `a unit of deployment`,
  `a unit of communication`, `a unit of selection`, `a unit in isolation`
  и `the package of the unit` в `docs/en/design/testing.md`. Это пара
  «единицы» из глоссария, а не пара «шага» — см. решение 8 в `design.md`;
- «член» в двух других значениях: член группы очереди NATS
  (`@nestlingjs/transport.nats`) и член объекта в правиле ESLint
  (`@nestlingjs/eslint-plugin`, capability `dependency-list-rule`).

## Как повторить замер

```sh
grep -rniE 'assembl|юнит|[^A-Za-z]unit' packages examples docs openspec/specs \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=archive \
  | grep -viE 'юнит-тест|unit[ -]test|unites'
grep -rn -E '[чЧ]лен' packages examples docs openspec/specs \
  --include='*.ts' --include='*.md' \
  --exclude-dir=node_modules --exclude-dir=dist
```
