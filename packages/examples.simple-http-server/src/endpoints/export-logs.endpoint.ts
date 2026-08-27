import { withTiming } from '../common/middleware';

import { makePipeline, Ok, stream } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import z from 'zod';

// GET /logs/export — потоковый ответ: framing выбирает форма, не хендлер
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
 * Демонстрирует форму `stream(T)` на выходе: хендлер возвращает обычный
 * `AsyncIterable`, транспорт отдаёт NDJSON (`application/x-ndjson`,
 * chunked) — заголовки руками ставить не нужно.
 *
 * Выходная цепочка — только тип-сохраняющая: оба конца зафиксированы
 * схемой, поэтому `.batch(...)` здесь не скомпилировался бы.
 */
export const ExportLogs = httpEndpoint({
  method: 'GET',
  path: '/logs/export',
  output: stream(LogLine).limit(1000),
  pipeline: makePipeline().pre(withTiming),
  handle: async () => new Ok(generate(5)),
});
