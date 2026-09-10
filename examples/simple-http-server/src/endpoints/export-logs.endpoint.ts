import { Ok, stream } from '@nestlingjs/operations';
import { httpEndpoint } from '@nestlingjs/transport.http';
import { z } from 'zod';

const LogLine = z.object({
  seq: z.number(),
  message: z.string(),
});

type LogLine = z.infer<typeof LogLine>;

async function* generate(count: number): AsyncIterableIterator<LogLine> {
  for (let seq = 1; seq <= count; seq++) {
    yield { seq, message: `line ${seq}` };
  }
}

/**
 * `GET /logs/export` с формой `stream(T)` на выходе.
 *
 * Хендлер возвращает `AsyncIterable`; транспорт отдаёт его как NDJSON.
 * `.limit(1000)` обрывает поток после тысячного элемента.
 */
export const ExportLogs = httpEndpoint({
  method: 'GET',
  path: '/logs/export',
  output: stream(LogLine).limit(1000),
  handler: async () => new Ok(generate(5)),
});
