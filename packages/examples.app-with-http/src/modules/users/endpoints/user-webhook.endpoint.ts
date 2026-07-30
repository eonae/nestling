import { createHmac, timingSafeEqual } from 'node:crypto';

import { WEBHOOK_SECRET } from '../../../common/constants';
import { basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { InvalidSignature } from '../user.errors';
import { UserService } from '../user.service';

import type { Output, PreUnitFn } from '@nestling/pipeline';
import { compose, makePipeline, Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const UserEventInput = z.object({
  type: z.enum(['user.deleted']),
  userId: z.string(),
});

const UserEventOutput = z.object({
  received: z.boolean(),
});

type UserEventInput = z.infer<typeof UserEventInput>;
type UserEventOutput = z.infer<typeof UserEventOutput>;

/**
 * Слой проверки подписи webhook'а.
 *
 * `makePipeline<{ rawBody: Uint8Array }>()` объявляет требование к
 * **стартовому контексту** — тому, что транспорт кладёт в контекст до
 * первого pre-юнита. Без `rawBody: true` в словаре декларации композиция
 * ниже не компилируется: забытая пометка — ошибка компилятора в точке
 * декларации, а не 500 в рантайме.
 *
 * Подпись считается по сырым байтам: пересериализованный JSON дал бы другой
 * HMAC (порядок ключей, пробелы), поэтому байты и нужны.
 */
export const verifySignature = (
  secret: string,
): PreUnitFn<{ rawBody: Uint8Array }, undefined> => {
  return (ctx) => {
    const provided = String(ctx.raw.attributes['x-signature'] ?? '');
    const expected = createHmac('sha256', secret)
      .update(ctx.input.rawBody)
      .digest('hex');

    const matches =
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

    if (!matches) {
      throw InvalidSignature();
    }
  };
};

export const userWebhookHandler =
  (users: UserService, logger: ILoggerService) =>
  async (event: UserEventInput): Output<UserEventOutput> => {
    logger.log(`Handling webhook ${event.type} for user ${event.userId}`);

    await users.delete(event.userId);

    return new Ok({ received: true });
  };

/**
 * Webhook с проверкой подписи.
 *
 * Демонстрирует `rawBody: true`: сырые байты тела попадают в типизированный
 * стартовый контекст, слой проверяет по ним HMAC, а хендлер получает уже
 * разобранный по схеме payload. Тело при этом читается **один раз** —
 * значение парсится из тех же байтов.
 */
export const UserWebhook = httpEndpoint({
  method: 'POST',
  path: '/api/hooks/users',
  input: UserEventInput,
  output: UserEventOutput,
  // Отказ бросает pre-юнит слоя, а не хендлер — объявлять его всё равно
  // обязан endpoint: контракт принадлежит ручке, а не слою.
  errors: [InvalidSignature],
  rawBody: true,
  pipeline: compose(
    makePipeline<{ rawBody: Uint8Array }>().pre(
      verifySignature(WEBHOOK_SECRET),
    ),
    basePipeline,
  ),
  deps: [UserService, ILogger],
  handle: userWebhookHandler,
});
