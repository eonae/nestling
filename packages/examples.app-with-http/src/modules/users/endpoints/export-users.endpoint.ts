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

    // Content-Type ставит framing по форме `stream(...)` — руками его
    // задавать больше не нужно
    return new Ok(userStream, {
      'Content-Disposition': 'attachment; filename="users.ndjson"',
    });
  }
}

/** Верхняя граница строк одного экспорта */
const MAX_EXPORT_ROWS = 100_000;

/**
 * Endpoint для экспорта пользователей через streaming
 * Демонстрирует:
 * - `stream(T)` на выходе: framing NDJSON выбирает форма, а не хендлер
 * - выходную item-цепочку (только тип-сохраняющую: оба конца зафиксированы
 *   схемой) — `.batch(...)` здесь не скомпилировался бы
 * - Кастомные заголовки (Content-Disposition)
 */
export const ExportUsers = httpEndpoint({
  method: 'GET',
  path: '/api/users/export',
  output: stream(ExportUsersOutput).limit(MAX_EXPORT_ROWS),
  pipeline: noValidationPipeline,
  handle: ExportUsersHandler,
});
