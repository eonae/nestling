# docs-publication

## Purpose

Как документация попадает на GitHub Pages и что проверяется до выкладки.
Сайт выкладывает workflow `.github/workflows/docs.yml` по тегу релиза и
по ручному запуску: push в `main` сайт не трогает. Базовый адрес записан
в workflow одной строкой, а вывод сборки несёт файлы раздачи статикой:
`.nojekyll`, `robots.txt`, `sitemap.xml` и `404.html`. Документацию
проверяет CI в каждой ветке: `yarn docs:audit` и `yarn docs:build` идут в
том же job'е, что `yarn verify`, поэтому битая ссылка и нарушенный
паритет языков известны до тега.

## Requirements

### Requirement: Сайт выкладывается на GitHub Pages по тегу релиза

Репозиторий SHALL содержать workflow `.github/workflows/docs.yml`. Он
SHALL запускаться по push тега `v*` и по ручному запуску
(`workflow_dispatch`). Других триггеров у него SHALL NOT быть: push в
`main` сайт не выкладывает.

Workflow SHALL собирать документацию командой `yarn docs:build --base
https://eonae.github.io/nestling` и выкладывать каталог `docs/.site/` на
GitHub Pages. Права job'а SHALL включать `pages: write` и
`id-token: write`. Группа `concurrency` SHALL быть общей для выкладок и
SHALL NOT отменять начатую: две выкладки подряд не перегоняют друг
друга.

Базовый адрес SHALL быть записан в workflow одной строкой. Второго места,
где сайт знает свой адрес, SHALL NOT существовать.

#### Scenario: Релиз выкладывает сайт

- **WHEN** в репозиторий отправлен тег `v0.4.0`
- **THEN** workflow `Docs` собирает сайт с базовым адресом
  `https://eonae.github.io/nestling` и выкладывает его на Pages

#### Scenario: Push в main сайт не трогает

- **WHEN** коммит отправлен в `main` без тега
- **THEN** workflow `Docs` не запускается

#### Scenario: Ручной запуск

- **WHEN** пользователь запустил workflow `Docs` кнопкой
- **THEN** сайт собирается и выкладывается из состояния ветки по
  умолчанию

### Requirement: Вывод сборки готов к раздаче статикой

Сборка SHALL печатать в корень вывода `.nojekyll`: файл выключает
обработку Jekyll на стороне Pages.

`robots.txt` SHALL называть адрес `sitemap.xml`, когда базовый адрес
задан, и SHALL NOT называть его, когда базовый адрес не задан.

Страница `404.html` SHALL лежать в корне вывода и SHALL открываться из
любого подпути: её ссылки на оформление SHALL быть встроены в файл.

#### Scenario: Файлы адресации на месте

- **WHEN** выполнено `yarn docs:build --base https://eonae.github.io/nestling`
- **THEN** в `docs/.site/` лежат `.nojekyll`, `robots.txt` с адресом
  карты сайта, `sitemap.xml` и `404.html`

#### Scenario: Сборка без базового адреса

- **WHEN** выполнено `yarn docs:build`
- **THEN** `.nojekyll` и `404.html` напечатаны, а `sitemap.xml` нет, и
  `robots.txt` карту сайта не называет

### Requirement: CI проверяет документацию в каждой ветке

Workflow `.github/workflows/ci.yml` SHALL выполнять `yarn docs:audit` и
`yarn docs:build`. Оба шага SHALL идти в том же job'е, что `yarn verify`,
и их падение SHALL ронять проверку ветки.

Расхождение оглавления и состава папки, битая ссылка и нарушенный паритет
языков SHALL становиться известными до тега, а не во время выкладки.

#### Scenario: Глава без строки в оглавлении

- **WHEN** в ветку добавлена глава, не названная в
  `docs/guide/README.md`
- **THEN** CI падает на шаге проверки документации

#### Scenario: Документация в порядке

- **WHEN** ветка не трогает документацию
- **THEN** шаги `docs:audit` и `docs:build` проходят
