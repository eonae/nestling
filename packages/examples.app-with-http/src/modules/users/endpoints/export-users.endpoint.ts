import { noValidationPipeline } from '../../../common/pipelines';
import type { User } from '../../../common/types';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

import { Injectable } from '@nestling/container';
import type { Output } from '@nestling/pipeline';
import { Ok, stream } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const ExportUsersOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

@Injectable([UserService, ILogger])
export class ExportUsersHandler {
  constructor(
    private readonly users: UserService,
    private readonly logger: ILoggerService,
  ) {}

  async handle(): Output<AsyncIterableIterator<User>> {
    this.logger.log('Handling GET /api/users/export');

    const userStream = this.users.exportAll();

    return new Ok(userStream, {
      'Content-Type': 'application/x-ndjson',
      'Content-Disposition': 'attachment; filename="users.ndjson"',
    });
  }
}

/**
 * Endpoint для экспорта пользователей через streaming
 * Демонстрирует:
 * - Streaming данных на выход через AsyncIterableIterator
 * - Кастомные заголовки (Content-Type, Content-Disposition)
 */
export const ExportUsers = httpEndpoint({
  method: 'GET',
  path: '/api/users/export',
  output: stream(ExportUsersOutput),
  pipeline: noValidationPipeline,
  handle: ExportUsersHandler,
});
