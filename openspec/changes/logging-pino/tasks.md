## 1. Подготовка

- [x] 1.1 Дождаться, пока `logging-core` окажется в `main`, перебазировать
      ветку на свежий `main` и убедиться, что `packages/nestling.logging`
      на месте: без него сателлиту не на чём стоять
- [x] 1.2 `yarn install` и `nx run-many -t build` в worktree: соседние
      пакеты видны друг другу через `dist`

## 2. Формат одним экземпляром в `@nestlingjs/logging`

- [x] 2.1 Вынести формат из `src/console.ts` в `src/format.ts`: тип
      `LogEntry`, функции `formatLine(entry, format)` и
      `serializeError(err)`, приватные `formatValue`, `formatError` и
      `toJson`
- [x] 2.2 `formatError` печатает сериализованный вид `{ name, message,
      stack, cause? }`, а не живой `Error`; значение, которое не ошибка,
      уходит через `formatValue`
- [x] 2.3 `ConsoleLogger` строит `LogEntry` и печатает через `formatLine`;
      `err` сериализуется до формата в обеих ветках
- [x] 2.4 Барель пакета отдаёт `formatLine`, `serializeError` и `LogEntry`
      поимённо; JSDoc модуля объясняет, зачем формат публичный
- [x] 2.5 `console.spec.ts`: вывод не изменился; добавить записи с
      сериализованной ошибкой в `text` и со строкой в ключе `err`

## 3. Пакет `@nestlingjs/logging.pino`

- [x] 3.1 Каталог `packages/nestling.logging.pino` с полным набором
      конфигурации из `CLAUDE.md`: `tsconfig.json`, `tsconfig.build.json`,
      `eslint.config.js`, `jest.config.js`, `LICENSE`
- [x] 3.2 Манифест: имя, описание, ключевые слова, `exports`, `files`,
      `publishConfig`, одинаковые скрипты, `@nestlingjs/logging` в
      `dependencies`, `pino` в `peerDependencies` диапазоном `^10.0.0` и в
      `devDependencies`; `yarn install` обновляет `yarn.lock`
- [x] 3.3 Писатель в `stderr`: поток назначения с `write(line)` через
      `process.stderr.write`, в `json` строка уходит как есть, в `text`
      разбирается и печатается через `formatLine`, неразобранная строка
      уходит как есть
- [x] 3.4 `pinoLogger(options)`: умолчания `info` и `text`, отображение
      `trace` на `debug` и `fatal` на `error`, значения адаптера —
      `timestamp` ISO, `formatters.level` меткой, `base: null`,
      `messageKey`, `errorKey`, `serializers.err = serializeError`
- [x] 3.5 Занятые ключи: тип поля `pino` снимает их через `Omit`,
      конструктор проверяет их и вложенный `serializers.err` и даёт
      `TypeError` с именем ключа и заменой, текст английский
- [x] 3.6 Три формы вызова на каждом из четырёх уровней и `child(bindings)`
      поверх `pino.child`
- [x] 3.7 Барель: `pinoLogger` и `PinoLoggerOptions`, без `export *`

## 4. Тесты пакета

- [x] 4.1 Формы вызова, уровни и привязки — перехватом
      `process.stderr.write`, как в `console.spec.ts`
- [x] 4.2 Совпадение с штатным логгером: одна последовательность вызовов
      через оба логгера в `text`, строки сравниваются после подмены
      времени
- [x] 4.3 Формат `json`: `time` строкой ISO, `level` меткой, `msg`, `err`
      объектом с `cause`, нет `pid` и `hostname`
- [x] 4.4 Порог: `trace`, `fatal`, `silent` и умолчание `info`
- [x] 4.5 Занятые ключи дают `TypeError`; `serializers` другого ключа и
      `redact` доходят до библиотеки
- [x] 4.6 `boundary.spec.ts`: в поставляемом коде нет `@nestlingjs/app`,
      состав зависимостей — `@nestlingjs/logging` и peer `pino`

## 5. Документация

- [x] 5.1 README пара нового пакета: шесть разделов в порядке, плашка со
      ссылкой в `design/` и в главу 9 своего языка, не длиннее 120 строк,
      один блок кода в примере, перечень экспортов совпадает с баррелем
- [x] 5.2 README пара `@nestlingjs/logging`: три новых имени в «Экспортах»
      на обоих языках
- [x] 5.3 `docs/README.md`: строка нового пакета в таблице «Инструменты и
      сателлиты», счёт каталогов «Двадцать три»
- [x] 5.4 Глава 9, раздел «Свой логгер» (RU и EN): выдуманный
      `pinoAdapter(pino())` заменяется настоящим `pinoLogger`, названы
      формат `text`, занятые ключи и установка пакета; дата в плашке
      «сверено с кодом» обновляется
- [x] 5.5 `design/composition.md`, раздел «Логгер» (RU и EN): итоговая
      форма опций сателлита, писатель в `stderr`, разница форматов `text`
      и `json`
- [x] 5.6 Проверить `docs/glossary.md`, `docs/compatibility.md` и их
      английские пары: нужна ли строка о новом пакете
- [x] 5.7 `node .claude/skills/docs-style/scripts/lint.mjs` по всем
      изменённым текстам — 0 запрещённых слов

## 6. Закрытие

- [ ] 6.1 `yarn verify` и `yarn docs:audit` зелёные
- [x] 6.2 `roadmap.md`: строка 94 переходит в **done** с итогом
- [x] 6.3 `ideas.md`: пометка «РЕАЛИЗОВАНО» записи [2026-09-13] дополняется
      пунктом 5 — что вышло, чем реализация уточнила решение; оглавление
      пересобирается `ideas-toc.mjs`
- [ ] 6.4 Коммиты осмысленные, ветка передана Merger'у сообщением

## 7. Definition of Done

- [ ] 7.1 Все задачи выше отмечены
- [ ] 7.2 `yarn verify` зелёный
- [ ] 7.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 7.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [ ] 7.5 Запись `ideas.md`, по которой шёл change, несёт пометку
      «РЕАЛИЗОВАНО»
- [ ] 7.6 `yarn docs:audit` — 0 ERROR
- [ ] 7.7 Затронутые `examples/*` мигрированы, гайды пересверены с
      обновлённой датой в плашке «сверено с кодом»
- [ ] 7.8 `main` не тронут — слияние делает Merger после `/opsx:archive`
