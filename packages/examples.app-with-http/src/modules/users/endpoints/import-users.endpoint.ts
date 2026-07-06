import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Ok, stream } from '@nestling/pipeline';
import { HttpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

import { noValidationPipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

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

/**
 * Endpoint для импорта пользователей из стрима
 * Демонстрирует:
 * - Streaming данных на вход (обработка входящего stream)
 * - Валидация каждого chunk'а стрима
 * - Возврат статистики импорта
 */
@Injectable([UserService, ILogger])
@HttpEndpoint('POST', '/api/users/import', {
  input: stream(ImportUserInput),
  output: ImportUsersOutput,
  pipeline: noValidationPipeline,
})
export class ImportUsersEndpoint implements IEndpoint
{
  constructor(
    private userService: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(
    payload: AsyncIterableIterator<ImportUserInput>,
    meta: {},
  ): Output<ImportUsersOutput> {
    this.logger.log('Handling POST /api/users/import');

    const result = await this.userService.importUsers(payload);

    return new Ok(result, {
      'X-Import-Status': result.failed > 0 ? 'partial' : 'complete',
    });
  }
}
