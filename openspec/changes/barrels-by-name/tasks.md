## 1. Проверка на `export *`

- [x] 1.1 Научить `collectBarrel` в `.claude/skills/docs-audit/scripts/package-exports.mjs`
      возвращать найденные операторы `export *` вместе со специфаерами, не меняя
      формат `names` и `reexports`
- [x] 1.2 Добавить в `.claude/skills/docs-audit/scripts/check.mjs` проверку: ERROR
      на каждый `export *` в бареле, названном полем `exports`; сообщение
      называет файл и специфаер
- [x] 1.3 Пакет без поля `exports` проверку проходит — убедиться на
      `@nestlingjs/viz`
- [x] 1.4 Расширить самопроверку `package-exports.mjs --self-test` случаем
      бареля с `export *`
- [x] 1.5 Прогнать `yarn docs:audit` и записать список нарушителей: ожидается
      восемь барелей

## 2. Разведка читателей

- [x] 2.1 Собрать по каждому пакету из списка имена без читателя: нет импорта
      вне `src` пакета и нет упоминания в `docs/design/` и `docs/guide/`
- [x] 2.2 Завести `openspec/changes/barrels-by-name/inventory.md`: пакет, имя,
      решение (осталось / ушло / вернулось по TS2742)
- [x] 2.3 Решить судьбу `natsConfigKeys` и применить то же решение к
      `httpServerKeys`: либо оба уходят, либо оба получают строку в
      `docs/design/config.md` или `docs/design/transports.md`

## 3. Мелкие пакеты

- [x] 3.1 `@nestlingjs/common.static-server` — барель поимённо (2 имени)
- [x] 3.2 `@nestlingjs/common.graphs` — барель поимённо (5 имён)
- [x] 3.3 `@nestlingjs/models` — барель поимённо, все три имени остаются
- [x] 3.4 `@nestlingjs/common.misc` — барель поимённо (14 имён)
- [x] 3.5 `yarn verify`; имена, упавшие с TS2742, вернуть строкой и отметить в
      `inventory.md`

## 4. Транспорты

- [x] 4.1 `@nestlingjs/transport.nats` — убрать `export *` из `./connector.js`,
      перечислить шов коннектора поимённо
- [x] 4.2 `@nestlingjs/transport.http` — заменить тринадцать `export *`
      поимённым перечнем
- [x] 4.3 Проверить `examples/app-with-http` и `examples/split-nats`: импорты
      разрешаются, либо имя возвращается в барель
- [x] 4.4 `yarn verify`; записи в `inventory.md`

## 5. Контейнер

- [x] 5.1 `@nestlingjs/container` — заменить семь `export *` поимённым перечнем
- [x] 5.2 `@nestlingjs/container/tokens` — тот же перечень для подпути;
      сверить, что он подмножество корневого
- [x] 5.3 Проверить импорты `@nestlingjs/container` и
      `@nestlingjs/container/tokens` во всех пакетах и примерах
- [x] 5.4 `yarn verify`; записи в `inventory.md`

## 6. README затронутых пакетов

- [x] 6.1 Сократить `## Экспорты` в README восьми пакетов вслед за перечнями
- [x] 6.2 Сверить плашки статуса и потолок в 120 строк
- [x] 6.3 `yarn docs:audit` — 0 ERROR

## 7. Спеки и журнал

- [x] 7.1 Проверить дельту `specs/packages-layout/spec.md` командой
      `openspec validate --changes barrels-by-name`
- [x] 7.2 В записи [ideas.md [2026-09-09]](../../../docs/decisions/ideas.md)
      отметить открытый вопрос №1 закрытым и назвать, чем он закрыт
- [x] 7.3 Прогнать `node .claude/skills/docs-style/scripts/lint.mjs` по всем
      изменённым текстам

## 8. Definition of Done

- [x] 8.1 Все задачи выше отмечены
- [x] 8.2 `yarn verify` зелёный (`build`, `typecheck`, `lint`, `test`,
      `type-budget` по всем пакетам)
- [x] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 8.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`, а
      запись `ideas.md` несёт пометку «РЕАЛИЗОВАНО» с тем, что вышло целиком,
      что уехало дальше и чем реализация уточнила решение
- [x] 8.5 `yarn docs:audit` — 0 ERROR
- [x] 8.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с
      обновлённой датой в плашке «сверено с кодом»
- [x] 8.7 Коммиты осмысленные, ветка запушена
