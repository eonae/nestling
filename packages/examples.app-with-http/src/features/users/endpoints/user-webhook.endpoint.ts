import { createHmac, timingSafeEqual } from 'node:crypto';

import { AppConfig } from '../../../app.config';
import { observability } from '../../../plugins/logging';
import { InvalidSignature } from '../users.errors';
import type { UsersRepository } from '../users.repository';
import { UsersRepository$ } from '../users.repository';

import type { Config } from '@nestling/config';
import { Injectable } from '@nestling/container';
import type { ExtendableContext, Output } from '@nestling/pipeline';
import { compose, makePipeline } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const UserEventInput = z.object({
  type: z.enum(['user.deleted']),
  userId: z.string(),
});

type UserEventInput = z.infer<typeof UserEventInput>;

const UserEventOutput = z.object({ received: z.boolean() });

type UserEventOutput = z.infer<typeof UserEventOutput>;

/**
 * Pre-юнит: проверяет HMAC-подпись тела.
 *
 * Подпись считается по сырым байтам: сериализованный заново JSON дал бы
 * другой HMAC. Байты приходят в стартовом контексте, когда декларация
 * помечена `rawBody: true`. Секрет читается из секции конфига.
 */
@Injectable([AppConfig])
export class VerifySignature {
  constructor(private readonly config: Config<typeof AppConfig>) {}

  handle(ctx: ExtendableContext<{ rawBody: Uint8Array }>): void {
    const provided = String(ctx.raw.attributes['x-signature'] ?? '');
    const expected = createHmac('sha256', this.config.webhookSecret)
      .update(ctx.input.rawBody)
      .digest('hex');

    const matches =
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

    if (!matches) {
      throw InvalidSignature();
    }
  }
}

export const userWebhookHandler =
  (users: UsersRepository) =>
  async (event: UserEventInput): Output<UserEventOutput> => {
    await users.remove(event.userId);

    return { received: true };
  };

/**
 * Webhook с проверкой подписи.
 *
 * `rawBody: true` кладёт сырые байты тела в стартовый контекст, и слой
 * `makePipeline<{ rawBody: Uint8Array }>()` компилируется только с этой
 * пометкой. Хендлер получает payload, разобранный из тех же байтов.
 *
 * Подлинность проверяется подписью, а не bearer-токеном, поэтому endpoint
 * выведен из-под политики `authed` через `detached` с причиной.
 */
export const UserWebhook = httpEndpoint({
  method: 'POST',
  path: '/hooks/users',
  input: UserEventInput,
  output: UserEventOutput,
  errors: [InvalidSignature],
  rawBody: true,
  detached:
    'webhook: подлинность проверяется подписью тела, а не bearer-токеном',
  doc: { summary: 'Webhook о событиях пользователя', tags: ['users'] },
  // Слой с требованием к стартовому контексту стоит снаружи: его
  // требование выполняет транспорт, а не соседний слой
  pipeline: compose(
    makePipeline<{ rawBody: Uint8Array }>().pre(VerifySignature),
    observability,
  ),
  handler: {
    deps: [UsersRepository$],
    handle: userWebhookHandler,
  },
});
