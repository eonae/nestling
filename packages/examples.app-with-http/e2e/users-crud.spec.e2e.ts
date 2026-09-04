import {
  closeTestApp,
  createTestApp,
  type TestAppContext,
} from './helpers/create-test-app.js';
import { HttpClient } from './helpers/http-client.js';

describe('пользователи по HTTP', () => {
  let context: TestAppContext;
  let client: HttpClient;

  beforeAll(async () => {
    context = await createTestApp();
    client = new HttpClient(context.baseUrl);
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('отдаёт список и одного пользователя', async () => {
    const list = await client.get('/users');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: '1', name: 'Alice' }),
      ]),
    );

    const one = await client.get('/users/1');
    expect(one.status).toBe(200);
    expect(await one.json()).toMatchObject({
      id: '1',
      email: 'alice@example.com',
    });
  });

  it('отвечает 404 с кодом отказа', async () => {
    const response = await client.get('/users/999');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: 'not_found:user',
      details: { id: '999' },
    });
  });

  it('не принимает запись без токена', async () => {
    const response = await client.json('POST', '/users', {
      name: 'Eve',
      email: 'eve@example.com',
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'unauthorized' });
  });

  it('создаёт пользователя: 201, Location и отказы 409 и 400', async () => {
    const created = await client.json(
      'POST',
      '/users',
      { name: 'Carol', email: 'carol@example.com' },
      { auth: true },
    );
    expect(created.status).toBe(201);
    expect(created.headers.get('location')).toMatch(/^\/users\/\d+$/);
    expect(await created.json()).toMatchObject({ name: 'Carol' });

    const duplicate = await client.json(
      'POST',
      '/users',
      { name: 'Carol II', email: 'carol@example.com' },
      { auth: true },
    );
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      code: 'conflict:email_taken',
    });

    const invalid = await client.json(
      'POST',
      '/users',
      { name: 'Broken', email: 'not-an-email' },
      { auth: true },
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'bad_request' });
  });

  it('проверяет данные без записи по ?dryRun=true', async () => {
    const response = await client.json(
      'POST',
      '/users?dryRun=true',
      { name: 'Dry', email: 'dry@example.com' },
      { auth: true },
    );
    // Проверка без записи: обычный `200`, а не `201`
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 'dry-run' });

    const check = await client.get('/users');
    expect(await check.json()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: 'dry@example.com' }),
      ]),
    );
  });

  it('изменяет пользователя и отклоняет пустое изменение', async () => {
    const updated = await client.json(
      'PATCH',
      '/users/2',
      { name: 'Robert' },
      { auth: true },
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ id: '2', name: 'Robert' });

    const empty = await client.json('PATCH', '/users/2', {}, { auth: true });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({
      code: 'bad_request:nothing_to_update',
    });
  });

  it('удаляет пользователя: 204, затем 404', async () => {
    const deleted = await client.json('DELETE', '/users/2', undefined, {
      auth: true,
    });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe('');

    const gone = await client.get('/users/2');
    expect(gone.status).toBe(404);
  });
});
