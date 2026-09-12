## MODIFIED Requirements

### Requirement: Скилл описывает настройку проекта

`references/setup.md` SHALL описывать, чем собирают и запускают приложение на
Nestling. Файл SHALL называть:

- `tsconfig.json` проекта: цель и `lib` с `esnext.disposable` для `await using`,
  отсутствие `experimentalDecorators` и `emitDecoratorMetadata`, требование к
  относительным импортам нести расширение `.js`;
- скрипты `package.json`: сборка через `tsc`, разработка через `tsx`, тесты;
- запуск тестов с условием резолва `testing` — флагом `--conditions=testing`
  для `node --test` либо полем `customExportConditions` для jest;
- установку и конфигурацию `@nestlingjs/eslint-plugin` с правилами
  `import-through-barrel`, `endpoint-has-layer` и `dependency-list`; у
  каждого правила — одно предложение о том, что оно ловит, и уровень.

Файл SHALL содержать одно утверждение о декораторах: type stripping в Node их не
исполняет, поэтому для разработки берут `tsx`.

Файл SHALL NOT предлагать шаблон проекта, генератор и выбор сборщика: он
описывает настройку существующего проекта.

#### Scenario: Запуск тестов без условия

- **WHEN** агент читает `setup.md` перед тем, как написать скрипт тестов
- **THEN** он видит флаг `--conditions=testing` и не получает
  `ERR_PACKAGE_PATH_NOT_EXPORTED` на импорте `@nestlingjs/testing`

#### Scenario: Разработка с декораторами

- **WHEN** агент ищет, чем запустить исходники без сборки
- **THEN** `setup.md` называет `tsx` и причину, по которой
  `node --experimental-strip-types` здесь не работает

#### Scenario: Список зависимостей из привычки NestJS

- **WHEN** агент пишет `@Component()` с пустым списком при непустом
  конструкторе в проекте, настроенном по `setup.md`
- **THEN** правило `dependency-list` подсвечивает декоратор в редакторе и
  дописывает список автофиксом, а имя правила в `setup.md` совпадает с
  ключом экспорта плагина
