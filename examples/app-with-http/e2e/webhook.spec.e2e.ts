import { createHmac } from 'node:crypto';

import {
  closeTestApp,
  createTestApp,
  E2E_WEBHOOK_SECRET,
  type TestAppContext,
} from './helpers/create-test-app.js';
import { HttpClient } from './helpers/http-client.js';

/** Подпись тела тем же алгоритмом, что проверяет `VerifySignature` */
const sign = (body: string, secret = E2E_WEBHOOK_SECRET): string =>
  createHmac('sha256', secret).update(body).digest('hex');

describe('webhook с подписью', () => {
  let context: TestAppContext;
  let client: HttpClient;

  beforeAll(async () => {
    context = await createTestApp();
    client = new HttpClient(context.baseUrl);
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('принимает тело с верной подписью и применяет событие', async () => {
    const body = JSON.stringify({ type: 'user.deleted', userId: '2' });

    const response = await client.raw('POST', '/hooks/users', body, {
      'content-type': 'application/json',
      'x-signature': sign(body),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    const deleted = await client.get('/users/2');
    expect(deleted.status).toBe(404);
  });

  it('отклоняет тело с чужой подписью', async () => {
    const body = JSON.stringify({ type: 'user.deleted', userId: '1' });

    const response = await client.raw('POST', '/hooks/users', body, {
      'content-type': 'application/json',
      'x-signature': sign(body, 'wrong-secret'),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: 'unauthorized:invalid_signature',
    });
    const kept = await client.get('/users/1');
    expect(kept.status).toBe(200);
  });
});
