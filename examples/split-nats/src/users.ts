/**
 * Фича `users`: принимает команду регистрации, занимает место в квоте у
 * соседней фичи и публикует факт регистрации.
 *
 * Про транспорт, брокер и процессы здесь ничего нет. Фича знает только
 * операции соседей; где работают их владельцы, решает корень.
 */

import { randomUUID } from 'node:crypto';

import { base } from './base.js';
import type { RegisterUserInput } from './operations.js';
import { ClaimQuota, RegisterUser, UserRegistered } from './operations.js';

import type { Emitter, Logger, Port } from '@nestlingjs/app';
import { implement, Logger$, makeFeature } from '@nestlingjs/app';
import { Component, Handler } from '@nestlingjs/container';

/**
 * Регистрирует пользователей.
 *
 * Зависит от вызывателя и эмиттера операций, а не от сервисов соседней
 * фичи. Вызов `this.quotas.call(...)` выглядит одинаково, когда владелец
 * работает в этом же процессе и когда он в другом.
 */
@Component([ClaimQuota.caller, UserRegistered.emitter, Logger$.auto])
export class RegistrationService {
  constructor(
    private readonly quotas: Port<typeof ClaimQuota>,
    private readonly registered: Emitter<typeof UserRegistered>,
    private readonly logger: Logger,
  ) {}

  /** Регистрирует пользователя; возвращает `false`, если квота исчерпана */
  async register(email: string): Promise<boolean> {
    // Идентификатор трассы в запись кладёт логгер ядра: он читает его из
    // контекста сам, и руками поле не пишется
    this.logger.info('register');

    const claim = await this.quotas.call({ email });

    if (claim.isFail) {
      // Отказ владельца приходит `Fail` того же определения `QuotaExceeded`
      // и из соседнего процесса, и из этого
      return false;
    }

    await this.registered.emit({ id: randomUUID(), email });

    return true;
  }
}

@Handler([RegistrationService])
class RegisterUserHandler {
  constructor(private readonly registration: RegistrationService) {}

  async handle(payload: RegisterUserInput) {
    await this.registration.register(payload.email);
  }
}

export const UsersFeature = makeFeature({
  name: 'users',
  providers: [RegistrationService],
  endpoints: [
    implement(RegisterUser, {
      // Базовый слой возвращает в контекст трассу и арендатора: оба
      // приехали в конверте сообщения, и вызыватель `quotas.claim`
      // передаст их дальше
      pipeline: base,
      handler: RegisterUserHandler,
    }),
  ],
});
