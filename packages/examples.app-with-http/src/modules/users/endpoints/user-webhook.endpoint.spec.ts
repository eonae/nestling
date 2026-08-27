import { createHmac } from 'node:crypto';

import { WEBHOOK_SECRET } from '../../../common/constants';
import type { ILoggerService } from '../../logger';
import type { UserService } from '../user.service';

import { userWebhookHandler, verifySignature } from './user-webhook.endpoint';

import type { ExtendableContext } from '@nestling/pipeline';
import { Fail, Ok } from '@nestling/pipeline';
import { mock } from 'jest-mock-extended';

const payload = JSON.stringify({ type: 'user.deleted', userId: '42' });
const rawBody = Buffer.from(payload);

/** Контекст с сырыми байтами — то, что кладёт транспорт при `rawBody: true` */
function makeContext(signature: string): ExtendableContext<{
  rawBody: Uint8Array;
}> {
  return {
    endpoint: { transport: 'http', pattern: 'POST /api/hooks/users' },
    raw: {
      transport: 'http',
      pattern: 'POST /api/hooks/users',
      payload: undefined,
      attributes: { 'x-signature': signature },
    },
    signal: new AbortController().signal,
    summary: { itemsIn: 0, itemsOut: 0 },
    input: { rawBody },
  };
}

describe('verifySignature', () => {
  const verify = verifySignature(WEBHOOK_SECRET);

  it('пропускает запрос с верной подписью', () => {
    const signature = createHmac('sha256', WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    expect(verify(makeContext(signature))).toBeUndefined();
  });

  it('отвергает подделанную подпись', () => {
    expect(() => verify(makeContext('deadbeef'))).toThrow(Fail);
  });
});

describe('userWebhookHandler', () => {
  it('обрабатывает событие и подтверждает приём', async () => {
    const users = mock<UserService>();
    const logger = mock<ILoggerService>();
    users.delete.mockResolvedValue(true);

    const result = await userWebhookHandler(
      users,
      logger,
    )({
      type: 'user.deleted',
      userId: '42',
    });

    expect(result).toBeInstanceOf(Ok);
    expect(users.delete).toHaveBeenCalledWith('42');
  });
});
