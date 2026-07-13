# CLI-транспорт

✅ **Статус: актуально** — сверено с кодом `examples.simple-cli` (2026-07-13).
Запускаемый код — в [`packages/examples.simple-cli/`](../../packages/examples.simple-cli/).

Те же endpoints и pipeline, что и в HTTP, — но команды вместо маршрутов.
`pattern` трактуется как имя команды.

## Endpoint-команда

```typescript
import { makeEndpoint, makePipeline, stream } from '@nestling/pipeline';
import { z } from 'zod';

export const ProcessStdin = makeEndpoint({
  transport: 'cli',
  pattern: 'process-stdin',
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
import { Help, ProcessStdin } from './endpoints.functional';

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

## Ограничения (текущие)

- `input: 'primitive'` (не-stream примитивы) в CLI не поддержан — регистрация
  пройдёт молча, ошибка «Primitive input type … is not supported» бросится
  при выполнении команды.
- Пакет пока без тестов; API может меняться.

> Целевой дизайн: единая модель endpoint'ов для всех транспортов сохранится;
> см. [decisions/ideas.md](../decisions/ideas.md).
