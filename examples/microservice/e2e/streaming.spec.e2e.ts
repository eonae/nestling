import {
  alice,
  closeTestApp,
  createTestApp,
  describeWithDatabase,
  type TestAppContext,
} from './helpers/create-test-app.js';
import { HttpClient } from './helpers/http-client.js';

import { afterAll, beforeAll, beforeEach, expect, it } from '@jest/globals';

describeWithDatabase('потоки по HTTP', () => {
  let context: TestAppContext;
  let client: HttpClient;

  beforeAll(async () => {
    context = await createTestApp();
    client = new HttpClient(context.baseUrl);
  });

  beforeEach(async () => {
    await context.reset();
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('выгружает пользователей строками NDJSON', async () => {
    const response = await client.get('/users/export');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');
    expect(response.headers.get('content-disposition')).toContain(
      'users.ndjson',
    );

    const text = await response.text();
    const lines = text.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(JSON.parse(line)).toMatchObject({
        id: expect.any(String),
        email: expect.any(String),
      });
    }
  });

  it('импортирует пользователей из NDJSON и пропускает занятые email', async () => {
    const rows = [
      { name: 'Import 1', email: 'import1@example.com' },
      { name: 'Alice again', email: alice.email },
      { name: 'Import 2', email: 'import2@example.com' },
    ];

    const response = await client.raw(
      'POST',
      '/users/import',
      rows.map((row) => JSON.stringify(row)).join('\n'),
      { 'content-type': 'application/x-ndjson' },
      true,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ imported: 2, skipped: 1 });
  });

  it('обрывает импорт на невалидной строке типом bad_request', async () => {
    const response = await client.raw(
      'POST',
      '/users/import',
      JSON.stringify({ name: 'Broken', email: 'not-an-email' }),
      { 'content-type': 'application/x-ndjson' },
      true,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      type: 'urn:error:bad_request',
    });
  });

  it('отдаёт событие создания по SSE', async () => {
    const controller = new AbortController();
    const feed = await fetch(`${context.baseUrl}/users/activity`, {
      signal: controller.signal,
    });
    expect(feed.status).toBe(200);
    expect(feed.headers.get('content-type')).toContain('text/event-stream');

    const created = await client.json(
      'POST',
      '/users',
      { name: 'Streamed', email: 'streamed@example.com' },
      { auth: true },
    );
    expect(created.status).toBe(201);

    if (!feed.body) {
      throw new Error('SSE response has no body');
    }

    const reader = feed.body.getReader();
    const { value } = await reader.read();
    const frame = new TextDecoder().decode(value);

    expect(frame).toContain('event: created');
    expect(frame).toContain('"kind":"created"');

    controller.abort();
  });

  it('показывает открытую подписку в реестре', async () => {
    const controller = new AbortController();
    const feed = await fetch(`${context.baseUrl}/users/activity`, {
      signal: controller.signal,
    });
    expect(feed.status).toBe(200);

    const listed = await client.get('/ops/subscriptions');
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pattern: 'GET /users/activity' }),
      ]),
    );

    controller.abort();
  });
});
