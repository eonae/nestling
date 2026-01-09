import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Endpoint, Ok, stream } from '@nestling/pipeline';
import { z } from 'zod';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

const ImportUserSchema = z.object({
  name: z.string(),
  email: z.string(), // Валидация email будет в UserService для обработки частичных ошибок
  avatarUrl: z.string().optional(),
});

const ImportUsersInput = stream(ImportUserSchema);

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

type ImportUsersOutput = z.infer<typeof ImportUsersOutput>;

/**
 * Endpoint для импорта пользователей из стрима
 * Демонстрирует:
 * - Streaming данных на вход (обработка входящего stream)
 * - Валидация каждого chunk'а стрима
 * - Возврат статистики импорта
 */
@Injectable([UserService, ILogger])
@Endpoint({
  transport: 'http',
  pattern: 'POST /api/users/import',
  input: ImportUsersInput,
  output: ImportUsersOutput,
})
export class ImportUsersEndpoint implements IEndpoint {
  constructor(
    private userService: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(
    payload: AsyncIterableIterator<z.infer<typeof ImportUserSchema>>,
  ): Output<ImportUsersOutput> {
    this.logger.log('Handling POST /api/users/import');

    const result = await this.userService.importUsers(payload);

    return new Ok(result, {
      'X-Import-Status': result.failed > 0 ? 'partial' : 'complete',
    });
  }
}

