import { defineFail } from '@nestling/operations';

/**
 * Отказ «stdin пуст».
 *
 * `status` не зависит от транспорта: CLI печатает его как есть, HTTP
 * перевёл бы `BAD_REQUEST` в 400.
 */
export const EmptyStdin = defineFail('EMPTY_STDIN', {
  status: 'BAD_REQUEST',
  message: 'No data received on stdin',
});
