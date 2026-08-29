# @nestling/transport.cli

CLI-транспорт Nestling: те же endpoint'ы и пайплайны, что в HTTP, но вместо
маршрутов — команды, а stdin служит потоковым входом.

> 🚧 Активная разработка, API может меняться. Валидатора среди зависимостей
> нет: команды проверяются через `@nestling/pipeline` любой схемой
> [Standard Schema](https://standardschema.dev).
> Гайд: [CLI-транспорт](../../docs/guides/cli.md).

## Установка

```bash
npm install @nestling/transport.cli
```

## Минимальный пример

```ts
import { assemble } from '@nestling/app';
import { Ok } from '@nestling/pipeline';
import { cli, cliEndpoint } from '@nestling/transport.cli';
import { z } from 'zod';

export const Hello = cliEndpoint({
  command: 'hello',
  input: z.object({ args: z.array(z.string()), loud: z.boolean().optional() }),
  output: z.object({ greeting: z.string() }),
  handle: async ({ args, loud }) => {
    const text = `Hello, ${args[0] ?? 'world'}`;
    return new Ok({ greeting: loud ? text.toUpperCase() : text });
  },
});

await assemble({ modules: [ToolsModule], transports: [cli()] }).run();
```

```bash
node dist/main.js hello Alice --loud
# {"greeting": "HELLO, ALICE"}
```

## Команда

`cliEndpoint({ command, input, output, errors, pipeline, deps, handle, detached })`
— конструктор декларации, тонкий слой над `makeEndpoint` из
`@nestling/pipeline`. Транспорт декларации — токен пакета `CliTransport$`
с коротким именем `'cli'`; имя команды становится паттерном endpoint'а.
Пустое имя команды бросает ошибку при создании декларации.

Вход команды с формой `value` собирается из аргументов процесса:
`--key value` становится опцией, `--flag` без значения — `true`, остальное
попадает в массив `args`. Payload команды выглядит как
`{ args: string[], ...options }`; его проверяет схема `input`.

## Запуск: `serve(dispatch, signal)`

```ts
const argv = process.argv.slice(2);
const cli = new CliTransport({ mode: argv.length > 0 ? 'argv' : 'repl', argv });

await cli.serve(makeDispatch([Help, ProcessStdin]), new AbortController().signal);
```

`serve` — единственный способ запустить транспорт. Что значит «принимать
запросы» для командной строки, определяет режим:

- `'argv'` (по умолчанию) — одна команда из аргументов процесса, после
  чего `serve` возвращается; пустой `argv` ничего не выполняет;
- `'repl'` — команды читаются из stdin до `exit`, `quit` или конца ввода.

Оба режима выполняют команду через `dispatch.call`. Метод
`execute({ command, args, options })` остаётся публичным: корень или тест
может собрать `CliInput` сам и выполнить одну команду.

`makeDispatch` принимает только готовые к запуску декларации: сначала
получите зависимости (`endpoint.resolve(...)`) или объявите команду в
модуле и запустите её под `assemble`, где `cli()` регистрирует транспорт
как обычный провайдер.

## Потоки: stdin на входе, NDJSON на выходе

```ts
capabilities = {
  input:  new Set(['value', 'stream']),
  output: new Set(['value', 'stream']),
};
```

| Форма | Как передаётся |
|---|---|
| `stream(T)` на входе | stdin читается как NDJSON, по одному JSON на строку; ядро проверяет каждый элемент схемой, применяет item-цепочку и считает `ctx.summary.itemsIn` |
| `stream('binary')` на входе | чанки stdin отдаются как есть; байты проверять нечем |
| `stream(T)` на выходе | NDJSON пишется в stdout по мере выдачи хендлера |
| `events`, `multipart` | отклоняются при регистрации; ошибка называет команду, транспорт, слот и форму |

Итератор выходного потока транспорт закрывает по концу потока и по
сигналу транспорта. Это запускает отложенные `.finally`-юниты.

```ts
export const Import = cliEndpoint({
  command: 'import',
  input: stream(Row).limit(10_000).gapTimeout(30_000),
  output: z.object({ imported: z.number() }),
  handle: async (rows) => { … },
});
```

## Ошибки

Отказы подчиняются модели ошибок ядра: `errors:` объявляет отказы команды,
а незадекларированный отказ на выходе заменяется на `UnknownError`
([`docs/design/errors.md`](../../docs/design/errors.md)). Статус
печатается как есть: CLI не нуждается в таблице кодов. Оригинал
заменённого отказа передаётся в хук `onUnknownFail` из опций транспорта.
Детали необработанных ошибок (`stack`) в терминале показываются всегда.

Ошибка валидации приходит как `SchemaValidationError` с
`issues: { message, path? }[]` — формат Standard Schema без полей
конкретного валидатора. Асинхронная схема или объект, не являющийся
Standard Schema, — ошибка конфигурации: `AsyncSchemaNotSupportedError` и
`NotAStandardSchemaError`.

В режиме `'argv'` отказ команды печатается в stderr, а код выхода процесса
становится `1`.

## Справочник

| Имя | Что это |
|---|---|
| `cliEndpoint(declaration)` | конструктор декларации команды |
| `cli(options?)` | провайдер транспорта для `transports:` или `providers:` |
| `CliTransport` | класс транспорта: `serve`, `execute`, `close` |
| `CliTransport$` | токен транспорта; короткое имя `'cli'` |
| `parseArgv(argv)` | разбор аргументов в `CliInput` |
| `CliInput` | `{ command, args, options }` |
| `CliTransportOptions` | `mode`, `argv`, `onUnknownFail` |

## Границы пакета

Пакет не поддерживает формы `events` и `multipart` и не запрашивает
недостающие поля входа интерактивно.
