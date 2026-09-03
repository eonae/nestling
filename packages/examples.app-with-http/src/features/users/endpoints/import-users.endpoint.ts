import { Unauthorized } from '../../../errors';
import { authed } from '../../../plugins/auth';
import { NewUser } from '../user';
import type { UsersRepository } from '../users.repository';
import { UsersRepository$ } from '../users.repository';

import { stream } from '@nestling/operations';
import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const ImportResult = z.object({
  imported: z.number(),
  skipped: z.number(),
});

type ImportResult = z.infer<typeof ImportResult>;

/** Больше строк за один запрос не принимается: ответ `413` */
const MAX_ROWS = 10_000;

/** Пауза между строками, после которой запрос отклоняется: ответ `504` */
const GAP_TIMEOUT_MS = 30_000;

export const importUsersHandler =
  (users: UsersRepository) =>
  async (rows: AsyncIterableIterator<NewUser>): Output<ImportResult> => {
    let imported = 0;
    let skipped = 0;

    // Каждая строка уже проверена схемой `NewUser`: невалидная строка
    // обрывает поток отказом `VALIDATION_FAILED`
    for await (const row of rows) {
      if (await users.byEmail(row.email)) {
        skipped += 1;
        continue;
      }

      await users.insert(row);
      imported += 1;
    }

    return { imported, skipped };
  };

/** Форма `stream(T)` на входе: тело запроса читается построчно как NDJSON */
export const ImportUsers = httpEndpoint({
  method: 'POST',
  path: '/users/import',
  input: stream(NewUser).limit(MAX_ROWS).gapTimeout(GAP_TIMEOUT_MS),
  output: ImportResult,
  errors: [Unauthorized],
  doc: { summary: 'Импорт пользователей из NDJSON', tags: ['users'] },
  pipeline: authed,
  deps: [UsersRepository$],
  handle: importUsersHandler,
});
