import {
  closeTestApp,
  createTestApp,
  type TestAppContext,
} from './helpers/create-test-app';
import { HttpClient } from './helpers/http-client';

/** Первые байты PNG: транспорт проверяет MIME, а не содержимое */
const png = (): FormData => {
  const form = new FormData();
  form.append(
    'avatar',
    new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], {
      type: 'image/png',
    }),
    'avatar.png',
  );

  return form;
};

describe('загрузка файлов', () => {
  let context: TestAppContext;
  let client: HttpClient;

  beforeAll(async () => {
    context = await createTestApp();
    client = new HttpClient(context.baseUrl);
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('загружает аватар и возвращает пользователя со ссылкой', async () => {
    const response = await client.raw(
      'POST',
      '/users/1/avatar',
      png(),
      {},
      true,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: '1',
      avatarUrl: expect.stringContaining('avatar.png'),
    });
  });

  it('отвечает 404 для неизвестного пользователя', async () => {
    const response = await client.raw(
      'POST',
      '/users/999/avatar',
      png(),
      {},
      true,
    );

    expect(response.status).toBe(404);
  });

  it('отклоняет файл чужого типа до чтения тела', async () => {
    const form = new FormData();
    form.append(
      'avatar',
      new Blob(['not an image'], { type: 'text/plain' }),
      'note.txt',
    );

    const response = await client.raw(
      'POST',
      '/users/1/avatar',
      form,
      {},
      true,
    );

    expect(response.status).toBe(400);
  });

  it('не принимает файл без токена', async () => {
    const response = await client.raw('POST', '/users/1/avatar', png());

    expect(response.status).toBe(401);
  });
});
