# CLI-транспорт

> Гайд по **текущему API**; сверено с кодом `examples.simple-cli` (2026-09-02).
> Канон деклараций — [design/endpoints.md](../design/endpoints.md).
> Запускаемый код — в [`packages/examples.simple-cli/`](../../packages/examples.simple-cli/).

CLI-транспорт выполняет те же декларации и тот же пайплайн, что и HTTP,
но вместо маршрутов у него команды. Декларация создаётся конструктором
`cliEndpoint`; единственное транспортное поле — `command`, оно же
становится паттерном endpoint'а. Пустое имя команды — ошибка при создании
декларации.

zod в примерах — один из вариантов: ядро принимает любую
[Standard Schema](https://standardschema.dev) (valibot, arktype, TypeBox,
Effect Schema …) и от библиотеки схем не зависит.

## Команда

```typescript
// packages/examples.simple-cli/src/endpoints/process-stdin.endpoint.ts
import { EmptyStdin } from '../errors';

import { makePipeline, stream } from '@nestling/pipeline';
import { cliEndpoint } from '@nestling/transport.cli';
import { z } from 'zod';

const ProcessStdinResponse = z.object({
  linesProcessed: z.number(),
  totalBytes: z.number(),
});

export const ProcessStdin = cliEndpoint({
  command: 'process-stdin',
  input: stream('binary'),          // stdin как поток Buffer'ов
  output: ProcessStdinResponse,
  errors: [EmptyStdin],
  pipeline: makePipeline(),
  handle: async (payload: AsyncIterableIterator<Buffer>) => {
    let linesProcessed = 0;
    let totalBytes = 0;

    for await (const chunk of payload) {
      totalBytes += chunk.length;
      linesProcessed += chunk.toString().split('\n').filter((line) => line.trim()).length;
    }

    if (totalBytes === 0) {
      return EmptyStdin();
    }

    return { linesProcessed, totalBytes };
  },
});
```

Команда объявляется так же, как HTTP-endpoint: схемы `input` и `output`,
список `errors`, пайплайн и хендлер. Хендлер получает проверенный вход и
возвращает значение или отказ.

## Формы io

Формы входа и выхода общие для всех транспортов, но каждый транспорт
объявляет, какие из них поддерживает:

| Слот | CLI поддерживает |
|---|---|
| `input` | значение (из `args` и `options`), `stream(T)`, `stream('binary')` |
| `output` | значение, `stream(T)` |

`events` и `multipart` CLI не поддерживает: у команды нет открытого
соединения, а файлы передаются путями в аргументах. Декларацию с такой
формой транспорт отклоняет при регистрации, до выполнения первой команды:

```
Endpoint 'watch': transport 'cli' does not support form 'events'
in 'output' (supported: value, stream).
```

Как читается вход:

- значение — из аргументов и опций команды как объект `{ args, ...options }`;
  дальше его проверяет схема `input`;
- `stream('binary')` — фрагменты stdin как есть, без валидации;
- `stream(T)` со схемой — stdin читается как NDJSON. Ядро проверяет каждую
  строку схемой `T`, применяет item-цепочку и считает `ctx.summary.itemsIn`:

  ```typescript
  export const Import = cliEndpoint({
    command: 'import',
    input: stream(Row).limit(10_000).gapTimeout(30_000),
    output: z.object({ imported: z.number() }),
    pipeline: makePipeline(),
    handle: async (rows: AsyncIterableIterator<Row>) => { … },
  });
  ```

`stream(T)` на выходе печатает NDJSON в stdout по мере того, как хендлер
отдаёт элементы. `.finally` выполняется после последнего элемента.

## Транспорт и два режима

```typescript
// packages/examples.simple-cli/src/main.ts
import { Help, ProcessStdin } from './endpoints';

import { makeDispatch } from '@nestling/transport';
import { CliTransport } from '@nestling/transport.cli';

const argv = process.argv.slice(2);

const cli = new CliTransport({
  mode: argv.length > 0 ? 'argv' : 'repl',
  argv,
});

const dispatch = makeDispatch([Help, ProcessStdin]);
const shutdown = new AbortController();

await cli.serve(dispatch, shutdown.signal);
await cli.close();
```

`makeDispatch` собирает из деклараций таблицу команд.
`serve(dispatch, signal)` запускает транспорт; `signal` отменяет
выполняющиеся команды. Режим работы задаёт опция `mode`:

- `'argv'` (по умолчанию) — транспорт разбирает аргументы, выполняет одну
  команду и возвращается из `serve`. С пустым `argv` он не выполняет
  ничего.
- `'repl'` — транспорт читает команды из stdin до `exit`, `quit` или конца
  ввода.

В обоих режимах команда выполняется через `dispatch.call`. Аргументы
разбирает `parseArgv` (пакет его экспортирует): `--key value` становится
опцией, `--flag` без значения — опцией со значением `true`, остальное —
позиционными аргументами. Короткие ключи `-x`, форма `--key=value` и
кавычки не поддерживаются.

Одну команду можно выполнить и напрямую: `execute({ command, args, options })`
после `serve`. Так корень приложения или тест передают уже разобранный
ввод.

Если команда завершилась ошибкой, транспорт выставляет
`process.exitCode = 1` в обоих режимах. При вызове `execute()` код выхода
выставляет ваш код по результату.

Под `assemble` транспорт регистрируется провайдером `cli()`:

```typescript
await assemble({ features: [ToolsFeature], transports: [cli()] }).run();
```

## Отказы

```typescript
// packages/examples.simple-cli/src/errors.ts
import { defineFail } from '@nestling/pipeline';

export const EmptyStdin = defineFail('EMPTY_STDIN', {
  status: 'BAD_REQUEST',
  message: 'No data received on stdin',
});
```

Модель ошибок общая для всех транспортов
([design/errors.md](../design/errors.md)): отказ объявляется через
`defineFail`, перечисляется в `errors:` декларации и возвращается или
бросается из хендлера. Отказ, не указанный в `errors:`, заменяется на
`UnknownError` на выходе из пайплайна. CLI печатает статус как есть;
переводить его в код, как это делает HTTP, не нужно:

```
$ printf '' | node dist/main.js process-stdin
BAD_REQUEST: {"error":"No data received on stdin","code":"EMPTY_STDIN"}
```

Исходный отказ, который был заменён на `UnknownError`, передаётся в хук
`new CliTransport({ onUnknownFail })`. Без хука он печатается в
`console.error`.

## Ограничения

`makeDispatch()` принимает только декларации без зависимостей. Декларацию
с `deps` или классом-хендлером сначала нужно связать с контейнером через
`endpoint.resolve(...)`, либо объявить её в модуле и запустить под
`assemble`: там это делает фаза WIRE.
