import { defineFail } from '@nestling/pipeline';

/**
 * Доменные отказы CLI-примера.
 *
 * Статус не зависит от транспорта: HTTP-транспорт перевёл бы
 * `BAD_REQUEST` в 400, CLI печатает статус как есть.
 */
export const EmptyStdin = defineFail('EMPTY_STDIN', {
  status: 'BAD_REQUEST',
  message: 'No data received on stdin',
});
