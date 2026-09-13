## 0. Сверка с `main`

- [ ] 0.1 `git rebase main`; если `config-run-bind` или `terminology` уже
      влиты — сверить дельты `specs/` с новым текстом main-спек и
      переписать затронутые блоки (`config-sources-binding`,
      имена `assemble`/`AssembleArgs`)
- [ ] 0.2 Сверить имена методов и типов в задачах ниже с тем, что в `main`:
      при влитом `terminology` читать `assemble` как `build`,
      `AssembleArgs` как `BuildArgs`

## 1. Маркер и разбор командной строки

- [ ] 1.1 `root/argv.ts`: `argv(strings)` — замороженное брендированное
      значение, хранящее список; проверка на срезанный список (ведущий
      дефис в первом или втором элементе) с сообщением про
      `argv(process.argv)`
- [ ] 1.2 `root/command-line.ts`: чистая функция разбора — схема флагов из
      декларации (`--features`, `--include-deps`, флаг на переключатель,
      `--help`), две записи значения (`--name value`, `--name=value`)
- [ ] 1.3 Строгие отказы разбора: неизвестный флаг, значение вне словаря,
      флаг без значения, значение у флага без значения, позиционный
      аргумент, переключатель без умолчания без флага — каждое сообщение
      называет известные варианты
- [ ] 1.4 Текст справки чистой функцией: строка вызова с именем скрипта,
      фичи, флаги, переключатели со значениями и умолчаниями
- [ ] 1.5 Печать справки в `stdout` и выход кодом `0` — тонкой обёрткой на
      границе `parseArgs`
- [ ] 1.6 Спеки разбора: все отказы из 1.3, обе записи значения, текст
      справки без завершения процесса

## 2. Аргумент сборки: две формы

- [ ] 2.1 `AssembleArgs` = `AssembleObject<S> | ArgvArgs`; строковая форма
      и массив имён удалены из типа и из `parseArgs`
- [ ] 2.2 `parseArgs` принимает маркер и разбирает его в тот же
      `ParsedArgs`; сигнатуре добавлены имена фич для справки
- [ ] 2.3 Зарезервированные имена флагов (`features`, `includeDeps`,
      `include-deps`, `help`) — отказ при создании декларации в
      `root/plan.ts`, сообщение называет причину
- [ ] 2.4 `argv` экспортирован из `@nestlingjs/app`; тип `ArgvArgs`
      экспортирован рядом с `AssembleArgs`
- [ ] 2.5 Спеки и type-тесты: маркер принимают `assemble`, `discover` и
      `check`; строковая форма не проходит по типам; `argv` в матрице
      `checkTopologies` не принимается

## 3. Миграция вызовов со строковой формой

- [ ] 3.1 Спеки пакета `app` (`check.spec`, `discovery-token.spec`,
      `app.spec`, `policies.spec`, `switches.spec`, `operations.spec`,
      `args.type-test`) — на объектную форму
- [ ] 3.2 `packages/nestling.openapi/src/module.spec.ts` — на объектную
      форму
- [ ] 3.3 `@nestlingjs/testing`: `checkTopologies` и `describeArgs` —
      объектная форма элементом списка, маркер отвергается типом

## 4. Удаление `load()`

- [ ] 4.1 Перенести покрытие `config/load.spec.ts` на проекцию из
      контейнера: сверить каждый сценарий с тем, что уже проверяют
      `section.spec.ts` и `secrets.spec.ts`, недостающие перенести
- [ ] 4.2 Удалить `config/load.ts`, `config/load.spec.ts` и экспорт `load`
      из `packages/nestling.app/src/index.ts`
- [ ] 4.3 Убрать вызовы `load()` из `derived.spec.ts`, `blank.spec.ts`,
      `secrets.spec.ts`, `section.spec.ts`, `switches.spec.ts`
- [ ] 4.4 Проверить, что `process.env` в `@nestlingjs/app` остался только
      в читалке и в источнике окружения

## 5. Примеры

- [ ] 5.1 `examples/microservice/src/main.ts`: `RootConfig` и `load()`
      удалены, точка входа — `app.assemble(argv(process.argv))`
- [ ] 5.2 `examples/modular-app/src/main.ts`: то же; `includeDeps`
      приходит флагом `--include-deps`
- [ ] 5.3 `examples/microservice/src/openapi.ts` и
      `examples/modular-app/src/graph.ts`: `process.argv[2]` заменён на
      `argv(process.argv)`
- [ ] 5.4 `examples/cli/src/main.ts`: локальная переменная `argv` не
      затеняет импорт
- [ ] 5.5 README и `.env.example` примеров: ключи `APP_FEATURES`,
      `APP_DOCS`, `APP_MAIL` заменены командами с флагами
- [ ] 5.6 `docker-compose` профили `modular-app`, если они задают состав
      переменными окружения

## 6. Документация

- [ ] 6.1 `docs/design/composition.md` и `docs/design/config.md` — сверить
      с реализацией, обновить дату в плашке; пара в `docs/en`
- [ ] 6.2 Главы гайда 02, 12, 19, 20 и `guide/README.md`: строковая форма
      и `load()`; пары в `docs/en/guide`
- [ ] 6.3 `docs/design/endpoints.md`, `docs/design/transports.md` и их
      английские пары
- [ ] 6.4 `docs/glossary.md` и `docs/en/glossary.md`: статья «Аргумент
      сборки» — две формы; статьи про `load()` нет
- [ ] 6.5 `docs/guarantees.md` и `docs/en/guarantees.md`: строка про
      отказ на неизвестном флаге до фазы 0 и утверждение о независимости
      состава от окружения
- [ ] 6.6 README пакетов `app`, `testing`, `transport.nats` (обе языковые
      половины), включая плашки статуса
- [ ] 6.7 `node .claude/skills/docs-style/scripts/lint.mjs` на всех
      правленых текстах — 0 запрещённых слов

## 7. Definition of Done

- [ ] 7.1 Все задачи выше отмечены
- [ ] 7.2 `yarn verify` зелёный (build + typecheck + lint + test +
      type-budget по всем пакетам)
- [ ] 7.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 7.4 `design/` и `decisions/` синхронизированы по правилам
      `CLAUDE.md`; запись `ideas.md` «Аргумент сборки: `argv()` по схеме
      декларации» несёт пометку «РЕАЛИЗОВАНО» с тем, что вышло целиком,
      что уехало дальше и чем реализация уточнила решение (открытый
      вопрос про `load()` закрыт удалением)
- [ ] 7.5 `yarn docs:audit` — 0 ERROR
- [ ] 7.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с
      обновлённой датой в плашке «сверено с кодом»
- [ ] 7.7 Коммиты осмысленные, `main` не тронут: слияние делает Merger
      после `/opsx:archive`
