import { makeFail } from '@nestling/operations';

/**
 * Отказ «stdin пуст».
 *
 * `status` не зависит от транспорта: CLI печатает его как есть, HTTP
 * перевёл бы `bad_request` в 400.
 */
export const EmptyStdin = makeFail('bad_request:empty_stdin', {
  message: 'No data received on stdin',
});
