import { noValidationPipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { importMetrics } from '../import-metrics';
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

/** Верхняя граница строк одного импорта: `.limit` отказывает 413 */
const MAX_IMPORT_ROWS = 10_000;

/** Сколько секунд ждём следующую строку, прежде чем отказать 504 */
const IMPORT_GAP_TIMEOUT = 30_000;

/**
 * Endpoint для импорта пользователей из стрима
 * Демонстрирует:
 * - Streaming данных на вход (обработка входящего stream)
 * - поэлементную валидацию по схеме-листу — её делает ядро, не хендлер
 * - item-цепочку на декларации: наблюдение, лимит и таймаут молчания
 *   действуют без единой строки в теле хендлера
 */
export const ImportUsers = httpEndpoint({
  method: 'POST',
  path: '/api/users/import',
  input: stream(ImportUserInput)
    .tap(() => {
      importMetrics.rowsSeen += 1;
    })
    .limit(MAX_IMPORT_ROWS)
    .gapTimeout(IMPORT_GAP_TIMEOUT),
  output: ImportUsersOutput,
  pipeline: noValidationPipeline,
  handle: ImportUsersHandler,
});
