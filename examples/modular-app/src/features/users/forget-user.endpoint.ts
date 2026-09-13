import type { ForgetUserInput } from '../../operations.js';
import { ForgetAddress, ForgetUser } from '../../operations.js';
import { transactional } from '../../persistence.js';

import type { UsersRepository } from './users.repository.js';
import { UsersRepository$ } from './users.repository.js';

import type { Emitter, Logger } from '@nestlingjs/app';
import { implement, Logger$ } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';

@Handler([UsersRepository$, ForgetAddress.emitter, Logger$.auto])
export class ForgetUserHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly forget: Emitter<typeof ForgetAddress>,
    private readonly logger: Logger,
  ) {}

  async handle(payload: ForgetUserInput): Promise<void> {
    const removed = await this.users.removeByEmail(payload.email);

    if (!removed) {
      this.logger.info('nothing to forget', { email: payload.email });

      return;
    }

    // Команда, а не событие: убрать адрес из рассылок обязан ровно один
    // владелец. Ключ идемпотентности задаёт вызывающий, чтобы повтор
    // после сбоя нёс тот же ключ; без ключа порт сгенерировал бы новый
    await this.forget.emit(
      { email: removed.email },
      { idempotencyKey: removed.id },
    );
  }
}

export const ForgetUserImpl = implement(ForgetUser, {
  pipeline: transactional,
  handler: ForgetUserHandler,
});
