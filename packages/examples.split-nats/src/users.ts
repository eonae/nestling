/**
 * Фича `users`: принимает команду регистрации, занимает место в квоте у
 * соседней фичи и публикует факт регистрации.
 *
 * Про транспорт, брокер и процессы здесь ничего нет. Фича знает только
 * операции соседей; где работают их владельцы, решает корень.
 */

import { randomUUID } from 'node:crypto';

import { TenantId } from './context.js';
import type { RegisterUserInput } from './operations.js';
import { ClaimQuota, RegisterUser, UserRegistered } from './operations.js';

import { makeFeature } from '@nestling/app';
import { Injectable } from '@nestling/container';
import { makePipeline } from '@nestling/pipeline';
import type { Emitter, Port } from '@nestling/ports';
import { implement } from '@nestling/ports';

/**
 * Регистрирует пользователей.
 *
 * Зависит от вызывателя и эмиттера операций, а не от сервисов соседней
 * фичи. Вызов `this.quotas.call(...)` выглядит одинаково, когда владелец
 * работает в этом же процессе и когда он в другом.
 */
@Injectable([ClaimQuota.caller, UserRegistered.emitter])
export class RegistrationService {
  constructor(
    private readonly quotas: Port<typeof ClaimQuota>,
    private readonly registered: Emitter<typeof UserRegistered>,
  ) {}

  /** Регистрирует пользователя; возвращает `false`, если квота исчерпана */
  async register(email: string): Promise<boolean> {
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

@Injectable([RegistrationService])
class RegisterUserHandler {
  constructor(private readonly registration: RegistrationService) {}

  async handle(payload: RegisterUserInput) {
    await this.registration.register(payload.email);

    // eslint-disable-next-line unicorn/no-useless-undefined
    return undefined;
  }
}

export const UsersFeature = makeFeature({
  name: 'users',
  providers: [RegistrationService],
  endpoints: [
    implement(RegisterUser, {
      // Арендатор приходит в конверте сообщения. Юнит кладёт его в контекст
      // запроса, откуда вызыватель `quotas.claim` передаст его дальше
      pipeline: makePipeline().pre(TenantId.propagated()),
      handler: RegisterUserHandler,
    }),
  ],
});
