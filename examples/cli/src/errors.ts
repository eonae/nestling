import { makeFail } from '@nestlingjs/operations';
import { z } from 'zod';

/**
 * Отказ «сервис не ответил».
 *
 * Категория не зависит от транспорта: CLI печатает код как есть, HTTP
 * перевёл бы `service_unavailable` в 503.
 */
export const ServiceUnreachable = makeFail('service_unavailable:service', {
  details: z.object({ url: z.string(), reason: z.string() }),
  message: (d) => `Service at ${d.url} did not answer: ${d.reason}`,
});

/** Отказ «stdin пуст» */
export const EmptyStdin = makeFail('bad_request:empty_stdin', {
  message: 'No data received on stdin',
});
