import { noValidationPipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

import { Injectable } from '@nestling/container';
import type { Output } from '@nestling/pipeline';
import { Ok, stream } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const ImportUserInput = z.object({
  name: z.string(),
  email: z.string(), // Валидация email будет в UserService для обработки частичных ошибок
  avatarUrl: z.string().optional(),
});

const ImportUsersOutput = z.object({
  imported: z.number(),
  failed: z.number(),
  errors: z
    .array(
      z.object({
        line: z.number(),
        error: z.string(),
      }),
    )
    .optional(),
});

type ImportUserInput = z.infer<typeof ImportUserInput>;
type ImportUsersOutput = z.infer<typeof ImportUsersOutput>;

@Injectable([UserService, ILogger])
export class ImportUsersHandler {
  constructor(
    private readonly users: UserService,
    private readonly logger: ILoggerService,
  ) {}

  async handle(
    payload: AsyncIterableIterator<ImportUserInput>,
  ): Output<ImportUsersOutput> {
    this.logger.log('Handling POST /api/users/import');

    const result = await this.users.importUsers(payload);

    return new Ok(result, {
      'X-Import-Status': result.failed > 0 ? 'partial' : 'complete',
    });
  }
}

/**
 * Endpoint для импорта пользователей из стрима
 * Демонстрирует:
 * - Streaming данных на вход (обработка входящего stream)
 * - Валидация каждого chunk'а стрима
 * - Возврат статистики импорта
 */
export const ImportUsers = httpEndpoint({
  method: 'POST',
  path: '/api/users/import',
  input: stream(ImportUserInput),
  output: ImportUsersOutput,
  pipeline: noValidationPipeline,
  handle: ImportUsersHandler,
});
