import { api } from '../api.js';
import { EmptyStdin } from '../errors.js';

import { CreateUserInput } from '@examples/microservice/operations';
import type { Output } from '@nestlingjs/app';
import { stream } from '@nestlingjs/operations';
import { cliEndpoint } from '@nestlingjs/transport.cli';
import { z } from 'zod';

const ImportUsersOutput = z.object({
  imported: z.number(),
  skipped: z.number(),
});

type ImportUsersOutput = z.infer<typeof ImportUsersOutput>;

/**
 * `import-users`: читает NDJSON из stdin и создаёт пользователей.
 *
 * Форма `stream('binary')` на входе: команда получает поток байтов и
 * разбирает его сама, не дожидаясь конца ввода.
 *
 * Запуск:
 *   cat users.ndjson | yarn workspace @examples/cli start:dev import-users
 */
export const ImportUsers = cliEndpoint('import-users', {
  input: stream('binary'),
  output: ImportUsersOutput,
  errors: [EmptyStdin],
  handler: async (
    payload: AsyncIterableIterator<Buffer>,
  ): Output<ImportUsersOutput, typeof EmptyStdin> => {
    const decoder = new TextDecoder();
    let rest = '';
    let bytes = 0;
    let imported = 0;
    let skipped = 0;

    /** Создаёт пользователя; отказ сервиса считается пропуском */
    const send = async (line: string): Promise<void> => {
      const parsed = CreateUserInput.safeParse(JSON.parse(line));

      if (!parsed.success) {
        skipped += 1;

        return;
      }

      const created = await api.createUser(parsed.data);

      if (created.isFail) {
        skipped += 1;
      } else {
        imported += 1;
      }
    };

    for await (const chunk of payload) {
      bytes += chunk.length;

      const lines = (rest + decoder.decode(chunk, { stream: true })).split(
        '\n',
      );
      rest = lines.pop() ?? '';

      for (const line of lines.filter((item) => item.trim())) {
        await send(line);
      }
    }

    if (rest.trim()) {
      await send(rest);
    }

    return bytes === 0 ? EmptyStdin() : { imported, skipped };
  },
});
