import { makeFail } from '@nestling/operations';

/**
 * Отказ «stdin пуст».
 *
 * Категория не зависит от транспорта: CLI печатает код как есть, HTTP
 * перевёл бы `bad_request` в 400.
 */
export const EmptyStdin = makeFail('bad_request:empty_stdin', {
  message: 'No data received on stdin',
});
