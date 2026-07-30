# CLI-транспорт

✅ **Статус: актуально** — сверено с кодом `examples.simple-cli` (2026-07-31).
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

## Транспорт: два режима

```typescript
import { makePipeline } from '@nestling/pipeline';
import { CliTransport } from '@nestling/transport.cli';
import { Help, ProcessStdin } from './endpoints';

// дефолтный pipeline можно передать в конструктор
const cli = new CliTransport(makePipeline());

cli.endpoint(Help);
cli.endpoint(ProcessStdin);

// 1) single-shot: разобрать argv, выполнить команду, выйти
const result = await cli.execute({
  command: 'process-stdin',
  args: [],
  options: { verbose: true },
});

// 2) REPL: интерактивный цикл (exit/quit для выхода)
await cli.listen();
```

Разбор `process.argv` в single-shot режиме — на стороне приложения
(см. `parseArgs()` в примере): `--key value` → options, `--flag` → `true`,
остальное → args. Встроенный парсер REPL такой же и не поддерживает
`-x`-сокращения, `--key=value` и кавычки.

Ненулевой exit-код: в REPL-режиме (`listen()`) транспорт сам выставляет
`process.exitCode = 1` при ошибочном статусе / брошенном `Fail`; в single-shot
(`execute()`) транспорт код выхода не трогает — его выставляет приложение по
результату (см. `main.ts` примера).

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
- `cli.endpoint()`, как и `server.route()`, принимает только deps-free
  декларацию: ручку с `deps` или класс-хендлером сначала гасят
  (`endpoint.resolve(...)`) — либо объявляют в модуле и поднимают под `App`.

> Целевой дизайн: единая модель endpoint'ов для всех транспортов сохранится;
> см. [decisions/ideas.md](../decisions/ideas.md).
