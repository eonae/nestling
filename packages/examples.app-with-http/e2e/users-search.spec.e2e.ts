import {
  createTestApp,
  closeTestApp,
  type TestAppContext,
} from './helpers/create-test-app';
import { HttpClient } from './helpers/http-client';

describe('Users Search (E2E)', () => {
  let testContext: TestAppContext;
  let client: HttpClient;

  beforeAll(async () => {
    testContext = await createTestApp();
    client = new HttpClient(testContext.baseUrl);
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(testContext);
  });

  describe('GET /api/users/search', () => {
    it('должен найти пользователей по имени с заголовками', async () => {
      const response = await client.get('/api/users/search?q=Alice');

      expect(response.status).toBe(200);
      expect(response.headers.get('x-total-count')).toBeDefined();
      expect(response.headers.get('cache-control')).toBe('max-age=60');

      const users = await response.json();
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeGreaterThan(0);

      // Проверяем, что все найденные пользователи содержат "Alice"
      for (const user of users) {
        expect(user.name.toLowerCase()).toContain('alice');
      }
    });

    it('должен найти пользователей по email', async () => {
      const response = await client.get('/api/users/search?q=bob@example.com');

      expect(response.status).toBe(200);

      const users = await response.json();
      expect(users.length).toBeGreaterThan(0);
      expect(users[0].email).toBe('bob@example.com');
    });

    it('должен вернуть пустой массив если ничего не найдено', async () => {
      const response = await client.get('/api/users/search?q=NonExistentUser12345');

      expect(response.status).toBe(200);
      expect(response.headers.get('x-total-count')).toBe('0');

      const users = await response.json();
      expect(users).toEqual([]);
    });

    it('должен вернуть 400 если query параметр отсутствует', async () => {
      const response = await client.get('/api/users/search');

      expect(response.status).toBe(400);

      const error = await response.json();
      expect(error).toHaveProperty('error');
    });

    it('должен вернуть 400 если query параметр пустой', async () => {
      const response = await client.get('/api/users/search?q=');

      expect(response.status).toBe(400);
    });
  });
});

