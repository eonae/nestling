import { Injectable } from '@nestling/container';
import type { IEndpoint, Output } from '@nestling/pipeline';
import { Ok, stream } from '@nestling/pipeline';
import { HttpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

import { noValidationPipeline } from '../../../common/pipelines';
import type { User } from '../../../common/types';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

const ExportUsersOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

/**
 * Endpoint для экспорта пользователей через streaming
 * Демонстрирует:
 * - Streaming данных на выход через AsyncIterableIterator
 * - Кастомные заголовки (Content-Type, Content-Disposition)
 */
@Injectable([UserService, ILogger])
@HttpEndpoint('GET', '/api/users/export', {
  output: stream(ExportUsersOutput),
  pipeline: noValidationPipeline,
})
export class ExportUsersEndpoint
  implements IEndpoint
{
  constructor(
    private userService: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(payload: undefined, meta: {}): Output<AsyncIterableIterator<User>> {
    this.logger.log('Handling GET /api/users/export');

    const userStream = this.userService.exportAll();

    return new Ok(userStream, {
      'Content-Type': 'application/x-ndjson',
      'Content-Disposition': 'attachment; filename="users.ndjson"',
    });
  }
}
