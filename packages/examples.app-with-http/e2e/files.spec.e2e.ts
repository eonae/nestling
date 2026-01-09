import {
  createTestApp,
  closeTestApp,
  type TestAppContext,
} from './helpers/create-test-app';
import { HttpClient } from './helpers/http-client';

describe('File Upload (E2E)', () => {
  let testContext: TestAppContext;
  let client: HttpClient;

  beforeAll(async () => {
    testContext = await createTestApp();
    client = new HttpClient(testContext.baseUrl);
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(testContext);
  });

  describe('POST /api/users/:id/avatar', () => {
    it('должен загрузить аватар для пользователя', async () => {
      // Создаем тестовый файл (простое изображение PNG)
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);

      const response = await client.upload('/api/users/1/avatar', {
        name: 'avatar.png',
        content: pngHeader,
        type: 'image/png',
      });

      expect(response.status).toBe(200);

      const user = await response.json();
      expect(user).toHaveProperty('id', '1');
      expect(user).toHaveProperty('avatarUrl');
      expect(user.avatarUrl).toContain('avatar.png');
    });

    it('должен вернуть 404 если пользователь не найден', async () => {
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);

      const response = await client.upload('/api/users/999/avatar', {
        name: 'avatar.png',
        content: pngHeader,
        type: 'image/png',
      });

      expect(response.status).toBe(404);
    });

    it('должен вернуть 400 для не-изображения', async () => {
      const textContent = Buffer.from('This is not an image');

      const response = await client.upload('/api/users/1/avatar', {
        name: 'document.txt',
        content: textContent,
        type: 'text/plain',
      });

      expect(response.status).toBe(400);

      const error = await response.json();
      expect(error).toHaveProperty('error');
      expect(error.error).toContain('image');
    });
  });
});

