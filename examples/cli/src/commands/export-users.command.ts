import { baseUrl } from '../api.js';

import { EXPORT_USERS_PATH, User } from '@examples/microservice/operations';
import type { Output } from '@nestlingjs/app';
import { stream } from '@nestlingjs/operations';
import { cliEndpoint } from '@nestlingjs/transport.cli';

/**
 * Читает выгрузку сервиса построчно.
 *
 * Каждая строка — один пользователь в JSON. Схема та же, что у сервиса:
 * `User` приезжает из его операций, второго описания строки нет.
 */
async function* rows(): AsyncIterableIterator<User> {
  const response = await fetch(`${baseUrl}${EXPORT_USERS_PATH}`);

  if (!response.body) {
    throw new Error('export response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let rest = '';

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    const lines = (rest + decoder.decode(value, { stream: true })).split('\n');
    rest = lines.pop() ?? '';

    for (const line of lines.filter((item) => item.trim())) {
      yield User.parse(JSON.parse(line));
    }
  }

  if (rest.trim()) {
    yield User.parse(JSON.parse(rest));
  }
}

/**
 * `export-users`: скачивает выгрузку сервиса и печатает её построчно.
 *
 * Форма `stream(T)` на выходе: команда возвращает `AsyncIterable`, а
 * транспорт печатает строки по мере готовности — выгрузка не собирается в
 * памяти целиком.
 *
 * Идёт она не типизированным клиентом: клиент строится над операциями,
 * вход и выход которых — значения, а здесь выход поток. Адрес выгрузки
 * объявлен в тех же операциях сервиса, поэтому копии знания и тут нет.
 */
export const ExportUsers = cliEndpoint('export-users', {
  output: stream(User),
  handler: async (): Output<AsyncIterableIterator<User>> => rows(),
});
