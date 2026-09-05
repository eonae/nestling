# docs-preview-guide

## REMOVED Requirements

### Requirement: Превью собирается из глав гайда

**Reason**: Capability заменена на `docs-site`. Результат сборки перестаёт
отслеживаться git, генератор и тема переезжают из `docs/preview/` в
`scripts/site/`, вывод идёт в `docs/.site/`, команда называется
`yarn docs:build`. Имя capability со словом «preview» пережило бы то, что
описывает: в волне 4 та же сборка станет публикуемым сайтом из нескольких
разделов. Логика и отвергнутые варианты — `design.md`, решения D1–D3, и
дискуссия
[d/11](../../../docs/history/discussions/11-docs-structure-and-site.md).

**Migration**: Требование перенесено в `docs-site` без изменения
поведения. Соответствия: `yarn docs:preview` становится `yarn docs:build`,
`yarn docs:preview:watch` становится `yarn docs:dev`, каталог
`docs/preview/` становится `docs/.site/`, каркас
`docs/preview/src/layout.html` становится `scripts/site/layout.html`.
Состав страниц, порядок и правила расхождения README и `docs/guide`
остаются прежними.

### Requirement: Навигация строится из частей гайда

**Reason**: Capability заменена на `docs-site`.

**Migration**: Требование перенесено в `docs-site` дословно. Группы
сайдбара, раскрытие открытой группы, подпункты из `##`-заголовков и
пейджер работают как прежде.

### Requirement: Ссылки и блоки кода переносятся без правки глав

**Reason**: Capability заменена на `docs-site`. Формулировка про соседние
папки называла `preview/`, а теперь называет `docs/.site/`.

**Migration**: Требование перенесено в `docs-site`. Соседство папок
сохранено намеренно: вывод остаётся внутри `docs/`, поэтому ссылки глав
вида `../design/errors.md` продолжают резолвиться и переписывать их не
нужно.

### Requirement: Разделы README вне «Часть N.»/«Приложения» не становятся страницами

**Reason**: Capability заменена на `docs-site`.

**Migration**: Требование перенесено в `docs-site` дословно, с заменой
имени команды в сценарии. Раздел «Карта понятий» оглавления гайда
продолжает опираться на это поведение.
