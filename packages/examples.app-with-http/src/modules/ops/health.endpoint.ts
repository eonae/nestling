import { Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const HealthOutput = z.object({ status: z.string() });

/**
 * Liveness-проба: единственная ручка приложения вне инвариантов.
 *
 * Политика корня требует слой `observability` от каждой HTTP-ручки, и это
 * правильно для всех ручек, кроме этой: балансировщик бьёт сюда раз в
 * секунду, а слой пишет строку аудита на каждый запрос — тысячи строк
 * «пробуем, живы ли» вытеснили бы из лога то, ради чего он заведён.
 *
 * Отсюда форма opt-out'а: не флаг, а **причина**. Её видно в диффе, в
 * выводе старта приложения и в отчёте `check()` — ровно затем, чтобы такой
 * список можно было прочитать на ревью и спросить «а это точно ещё так?».
 */
export const Health = httpEndpoint({
  method: 'GET',
  path: '/health',
  output: HealthOutput,
  detached:
    'liveness-проба балансировщика: строка аудита на каждый удар — шум, а не наблюдаемость',
  handle: async () => new Ok({ status: 'up' }),
});
