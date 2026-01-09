import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Ok, stream } from '@nestling/pipeline';
import { z } from 'zod';
import type { User } from '../../../common/types';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';
import { HttpEndpoint } from '@nestling/transport.http';

const ExportUsersOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

type ExportUsersOutput = z.infer<typeof ExportUsersOutput>;

/**
 * Endpoint для экспорта пользователей через streaming
 * Демонстрирует:
 * - Streaming данных на выход через AsyncIterableIterator
 * - Кастомные заголовки (Content-Type, Content-Disposition)
 */
@Injectable([UserService, ILogger])
@HttpEndpoint('GET', '/api/users/export', {
  output: stream(ExportUsersOutput),
})
export class ExportUsersEndpoint implements IEndpoint {
  constructor(
    private userService: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(): Output<AsyncIterableIterator<User>> {
    this.logger.log('Handling GET /api/users/export');

    const stream = this.userService.exportAll();

    return new Ok(stream, {
      'Content-Type': 'application/x-ndjson',
      'Content-Disposition': 'attachment; filename="users.ndjson"',
    });
  }
}

