# @nestlingjs/transport.cli

CLI-транспорт Nestling: те же endpoint'ы и пайплайны, что в HTTP, но вместо
маршрутов — команды, а поток ввода служит потоковым входом. Процесс выполняет
одну команду и завершается либо остаётся в REPL. Недостающий обязательный
вход команда спрашивает в терминале, если объявила `missing: 'prompt'`.

> 🚧 Активная разработка, API может меняться. Валидатора среди зависимостей
> нет: команды проверяются через `@nestlingjs/app` любой схемой
> [Standard Schema](https://standardschema.dev).
> Дизайн: [`docs/design/transports.md`](../../docs/design/transports.md).
> Гайд: [рецепт «CLI-утилита на тех же примитивах»](../../docs/recipes/cli.md).

## Установка

```bash
npm install @nestlingjs/transport.cli
```

## Минимальный пример

```typescript
import { makeApp, Ok } from '@nestlingjs/app';
import { cli, cliEndpoint } from '@nestlingjs/transport.cli';
import { z } from 'zod';

export const Deploy = cliEndpoint('deploy', {
  input: z.object({
    env: z.enum(['dev', 'prod']).describe('Target environment'),
    force: z.boolean(),
  }),
  output: z.object({ done: z.boolean() }),
  // Недостающий флаг спрашивается в терминале; без поля — отказ валидации
  missing: 'prompt',
  handler: async ({ env, force }) => new Ok({ done: await deploy(env, force) }),
});

// node dist/main.js deploy --env prod --force
await makeApp({
  features: [ToolsFeature],
  transports: [cli()],
})
  .build()
  .run();
```

Вопрос выводится из JSON Schema формы `input`: Standard Schema
интроспекции не даёт, и схему кто-то должен перевести. Объявлять
переводчик не нужно — конвертер вендора, на котором написаны схемы
фреймворка, транспорт подставляет умолчанием. Приложение на другом
валидаторе передаёт свой список в `cli({ converters })`. Схема, которую не
перевёл ни один конвертер, роняет `serve` с именем команды и вендором её
схемы. Поток на входе вместе с политикой тоже роняет `serve`: вопросы и
поток читают один и тот же ввод.

## Экспорты

| Имя | Что делает |
|---|---|
| `cli` | провайдер транспорта для `transports:`; принимает опции |
| `cliEndpoint` | декларация endpoint'а: имя команды первым аргументом вместо маршрута |
| `cliBindingOf` | читает политику `missing` с декларации или проекции маршрута |
| `CliTransport` | реализация `ITransport`: разбор argv, запуск, REPL, вопросы |
| `CliTransport$` | DI-токен транспорта |
| `CLI_TRANSPORT_NAME` | короткое имя транспорта (`'cli'`) |
| `CliTransportOptions` | режим, аргументы, потоки, необязательные конвертеры, вопросы |
| `CliEndpointDictionary` | словарь CLI-декларации для `cliEndpoint` |
| `CliBinding` | политика биндинга в поле `binding` декларации |
| `CliMissingPolicy` | `'error'` или `'prompt'` |
| `CliInput` | разобранный вход команды: позиционные аргументы и флаги |
| `CliInputStream` | поток ввода транспорта |
| `CLI_CAPABILITIES` | что транспорт умеет: потоковый вход и NDJSON на выходе |
| `parseArgv` | разбирает argv в `CliInput` без запуска приложения |
| `buildPromptPlan` | строит план вопросов команды из её схемы |
| `PromptPlan` | план вопросов команды |
| `PromptQuestion` | вопрос по одному полю входа |
| `PromptKind` | форма вопроса: список, подтверждение, строка |

`CliTransportOptions` принимает `mode` и `argv` (режим запуска), `input`,
`output` и `errorOutput` (умолчания — каналы процесса), необязательные
`converters` и `interactive`. Потоки подставляются значением, поэтому вопросы и печать
результата проверяются тестом без терминала.

## Границы пакета

Транспорт не разбирает подкоманды, не печатает справку и не рисует прогресс.
Формат вывода — JSON и NDJSON. Вопросы собирают только скалярные поля
верхнего уровня: массив и вложенный объект остаются за флагами. Скрытого
ввода нет — пароль в терминале печатается как есть.
