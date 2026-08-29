import { Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const HealthOutput = z.object({ status: z.string() });

/**
 * Liveness-проба: единственный endpoint приложения вне политик.
 *
 * Политика корня требует слой `observability` от каждого HTTP-endpoint'а.
 * Для пробы это лишнее: балансировщик обращается к ней раз в секунду, и
 * строка аудита на каждый запрос вытеснила бы из лога полезные записи.
 *
 * Исключение оформлено полем `detached` с причиной, а не флагом. Причину
 * видно в диффе, в выводе при старте и в отчёте `check()`, поэтому список
 * исключений можно прочитать на ревью.
 */
export const Health = httpEndpoint({
  method: 'GET',
  path: '/health',
  output: HealthOutput,
  detached:
    'liveness-проба балансировщика: строка аудита на каждый удар — шум, а не наблюдаемость',
  // Второе исключение того же вида: endpoint не входит в публичный API,
  // поэтому не попадает в документ OpenAPI. `hidden` тоже требует причину
  doc: { hidden: 'служебная проба балансировщика, не часть публичного API' },
  handle: async () => new Ok({ status: 'up' }),
});
