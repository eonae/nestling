# CLI-транспорт

✅ **Статус: актуально** — сверено с кодом `examples.simple-cli` (2026-08-27).
Канон деклараций — per-transport конструкторы (`cliEndpoint`), см.
[design/endpoints.md](../design/endpoints.md).
Запускаемый код — в [`packages/examples.simple-cli/`](../../packages/examples.simple-cli/).

Те же декларации и pipeline, что и в HTTP, — но команды вместо маршрутов.
Транспортный словарь CLI — одно поле `command`, оно же становится `pattern`
ручки; пустое имя команды — ошибка в момент создания декларации.
zod в примерах — **один из вариантов**:
ядро принимает любую [Standard Schema](https://standardschema.dev) (valibot,
arktype, TypeBox, Effect Schema …) и валидатором не зависит.

## Endpoint-команда

```typescript
import { makePipeline, stream } from '@nestling/pipeline';
import { cliEndpoint } from '@nestling/transport.cli';
import { z } from 'zod';

export const ProcessStdin = cliEndpoint({
  command: 'process-stdin',
  input: stream('binary'),          // stdin как поток Buffer'ов
  output: z.object({ linesProcessed: z.number(), totalBytes: z.number() }),
  pipeline: makePipeline(),
  handle: async (chunks: AsyncIterableIterator<Buffer>) => {
    let linesProcessed = 0;
    let totalBytes = 0;
    for await (const chunk of chunks) {
      totalBytes += chunk.length;
      linesProcessed += chunk.toString().split('\n').filter((l) => l.trim()).length;
    }
    return { linesProcessed, totalBytes };
  },
});
```

## Формы io: что CLI умеет

Формы одни на все транспорты, но каждый транспорт объявляет, какие из них
умеет нести:

| Слот | CLI умеет |
|---|---|
| `input` | значение (из `args`/`options`), `stream(T)`, `stream('binary')` |
| `output` | значение, `stream(T)` |

`events` и `multipart` CLI **не** умеет: у команды нет открытого
соединения, дисконнект которого был бы нормальным завершением, а файлы
приходят путями в аргументах. Декларация с такой формой отвергается **при
регистрации**, до выполнения хоть одной команды:

```
Endpoint 'watch': transport 'cli' does not support form 'events'
in 'output' (supported: value, stream).
```

- `stream('binary')` — чанки stdin как есть: примитивный лист описывает
  байты, валидировать нечего;
- `stream(T)` со схемой — stdin читается как NDJSON, и ядро валидирует
  каждую строку схемой-листом, применяет item-цепочку и считает
  `ctx.summary.itemsIn`:

  ```typescript
  export const Import = cliEndpoint({
    command: 'import',
    input: stream(Row).limit(10_000).gapTimeout(30_000),
    output: z.object({ imported: z.number() }),
    pipeline: makePipeline(),
    handle: async (rows: AsyncIterableIterator<Row>) => { … },
  });
  ```

- `stream(T)` на выходе — NDJSON в stdout по мере того, как хендлер
  отдаёт элементы; `.finally` сработает после последнего.

## Транспорт: два режима

```typescript
import { makeDispatch } from '@nestling/transport';
import { CliTransport } from '@nestling/transport.cli';
import { Help, ProcessStdin } from './endpoints';

const argv = process.argv.slice(2);

// Что значит «выйти в эфир» для командной строки, решает режим
const cli = new CliTransport({
  mode: argv.length > 0 ? 'argv' : 'repl',
  argv,
});

// Маршруты приезжают одним объектом; исполнение ручки — в ядре
const shutdown = new AbortController();
await cli.serve(makeDispatch([Help, ProcessStdin]), shutdown.signal);
```

- **`mode: 'argv'`** (по умолчанию) — single-shot: транспорт разбирает
  аргументы, выполняет одну команду и возвращается из `serve`;
- **`mode: 'repl'`** — интерактивный цикл до `exit`/`quit`/EOF.

Обе ветки исполняют ручку через `dispatch.call`. Встроенный разбор
аргументов (`parseArgv`, он же экспортируется пакетом): `--key value` →
options, `--flag` → `true`, остальное → args; `-x`-сокращения,
`--key=value` и кавычки не поддерживаются.

Отдельную команду можно выполнить и руками — `execute({ command, args,
options })` после `serve`: это тот же single-shot, но `CliInput` строит
корень (или тест).

Ненулевой exit-код: транспорт выставляет `process.exitCode = 1` при
ошибочном статусе команды в обоих режимах go-live; вызвав `execute()`
напрямую, код выхода выставляет приложение по результату.

## Отказы

Модель ошибок одна на все транспорты ([design/errors.md](../design/errors.md)):
отказ объявляется `defineFail`, перечисляется в `errors:` декларации и
отдаётся возвратом либо броском. Статус CLI печатает как есть — маппинга на
провод, в отличие от HTTP, ему не нужно:

```typescript
export const EmptyStdin = defineFail('EMPTY_STDIN', {
  status: 'BAD_REQUEST',
  message: 'No data received on stdin',
});

export const ProcessStdin = cliEndpoint({
  command: 'process-stdin',
  input: stream('binary'),
  output: ProcessStdinResponse,
  errors: [EmptyStdin],       // без объявления граница отдаст UNKNOWN/500
  pipeline: makePipeline(),
  handle: async (payload) => (await isEmpty(payload) ? EmptyStdin() : summarize(payload)),
});
```

```
$ printf '' | node dist/main.js process-stdin
BAD_REQUEST: {"error":"No data received on stdin","code":"EMPTY_STDIN"}
```

Оригинал отказа, снятого стражем границы, уходит в
`new CliTransport(pipeline, { onUnknownFail })`; без хука — в
`console.error`.

## Ограничения (текущие)

- `input: 'primitive'` (не-stream примитивы) в CLI не поддержан — регистрация
  пройдёт молча, ошибка «Primitive input type … is not supported» бросится
  при выполнении команды.
- `makeDispatch()` для CLI, как и для HTTP, принимает только deps-free
  декларацию: ручку с `deps` или класс-хендлером сначала гасят
  (`endpoint.resolve(...)`) — либо объявляют в модуле и поднимают под `App`.

> Целевой дизайн: единая модель endpoint'ов для всех транспортов сохранится;
> см. [decisions/ideas.md](../decisions/ideas.md).
