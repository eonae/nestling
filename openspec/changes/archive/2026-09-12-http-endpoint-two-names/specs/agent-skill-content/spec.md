## MODIFIED Requirements

### Requirement: Скилл состоит из `SKILL.md` и каталога `references/`

Скилл SHALL состоять из файла `SKILL.md` и каталога `references/` рядом с ним.
Других файлов и вложенных каталогов в скилле SHALL NOT быть.

Каталог `references/` SHALL содержать одиннадцать файлов: `setup.md`,
`endpoints.md`, `http.md`, `container.md`, `pipeline.md`, `errors.md`,
`config.md`, `features.md`, `testing.md`, `from-nest.md`,
`diagnostics.md`.

`diagnostics.md` SHALL быть таблицей вида «что напечатал компилятор или
ASSEMBLE → что это значит → что чинить». Строки SHALL цитировать тексты,
закреплённые снапшотами и тестами репозитория, а не пересказывать их. Файл
SHALL покрывать как минимум: незаявленный отказ хендлера, отказ слоя вне
`errors:` операции, ошибку длины списка зависимостей, ошибку формы класса
роли и отказ ASSEMBLE о пересечении границы фичи. Каждый файл SHALL быть назван в
таблице «куда смотреть дальше» в `SKILL.md`.

Файл `references/`, на который `SKILL.md` не ссылается, SHALL быть ошибкой:
агент читает эти файлы по ссылке из `SKILL.md` и без ссылки не найдёт файл.

#### Scenario: Файл без ссылки

- **WHEN** в `skill/references/` лежит `streaming.md`, которого нет в таблице
  `SKILL.md`
- **THEN** `yarn verify` печатает ошибку с именем файла

#### Scenario: Ссылка без файла

- **WHEN** таблица `SKILL.md` называет `references/openapi.md`, а файла нет
- **THEN** `yarn verify` печатает ошибку с именем ссылки

#### Scenario: Полный состав

- **WHEN** каталог содержит десять файлов перечня и все они названы в таблице
- **THEN** `yarn verify` по составу скилла молчит
