# @nestlingjs/transport.cli

CLI-транспорт Nestling: те же endpoint'ы и пайплайны, что в HTTP, но вместо
маршрутов — команды, а stdin служит потоковым входом. Процесс выполняет одну
команду и завершается либо остаётся в REPL.

> 🚧 Активная разработка, API может меняться. Валидатора среди зависимостей
> нет: команды проверяются через `@nestlingjs/app` любой схемой
> [Standard Schema](https://standardschema.dev).
> Дизайн: [`docs/design/transports.md`](../../docs/design/transports.md).
> Гайд: [глава 21. CLI-утилита на тех же примитивах](../../docs/guide/21-cli.md).

## Установка

```bash
npm install @nestlingjs/transport.cli
```

## Минимальный пример

```typescript
import { makeApp, Ok } from '@nestlingjs/app';
import { cli, cliEndpoint } from '@nestlingjs/transport.cli';
import { z } from 'zod';

export const Hello = cliEndpoint({
  command: 'hello',
  input: z.object({ args: z.array(z.string()), loud: z.boolean().optional() }),
  output: z.object({ greeting: z.string() }),
  handler: async ({ args, loud }) => {
    const text = `Hello, ${args[0] ?? 'world'}`;
    return new Ok({ greeting: loud ? text.toUpperCase() : text });
  },
});

// node dist/main.js hello Alice --loud
await makeApp({ features: [ToolsFeature], transports: [cli()] })
  .assemble()
  .run();
```

## Экспорты

| Имя | Что делает |
|---|---|
| `cli` | провайдер транспорта для `transports:`; принимает опции |
| `cliEndpoint` | декларация endpoint'а с полем `command` вместо маршрута |
| `CliTransport` | реализация `ITransport`: разбор argv, запуск, REPL |
| `CliTransport$` | DI-токен транспорта |
| `CliTransportOptions` | имя программы, режим REPL, потоки ввода и вывода |
| `CliEndpointDictionary` | карта «команда — декларация» для `makeDispatch` |
| `CliInput` | разобранный вход команды: позиционные аргументы и флаги |
| `CLI_CAPABILITIES` | что транспорт умеет: потоковый вход и NDJSON на выходе |
| `parseArgv` | разбирает argv в `CliInput` без запуска приложения |

## Границы пакета

Транспорт не разбирает подкоманды, не печатает справку и не рисует прогресс.
Формат вывода — JSON и NDJSON.
