import {
  createTestApp,
  closeTestApp,
  type TestAppContext,
} from './helpers/create-test-app';
import { HttpClient } from './helpers/http-client';

describe('Users CRUD (E2E)', () => {
  let testContext: TestAppContext;
  let client: HttpClient;

  beforeAll(async () => {
    testContext = await createTestApp();
    client = new HttpClient(testContext.baseUrl);
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(testContext);
  });

  describe('GET /api/users', () => {
    it('должен вернуть список пользователей', async () => {
      const response = await client.get('/api/users');

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);

      // Проверяем структуру первого пользователя
      expect(data[0]).toHaveProperty('id');
      expect(data[0]).toHaveProperty('name');
      expect(data[0]).toHaveProperty('email');
    });
  });

  describe('GET /api/users/:id', () => {
    it('должен вернуть пользователя с заголовками', async () => {
      const response = await client.get('/api/users/1');

      expect(response.status).toBe(200);
      expect(response.headers.get('etag')).toBeDefined();
      expect(response.headers.get('cache-control')).toBe('max-age=300');

      const user = await response.json();
      expect(user).toHaveProperty('id', '1');
      expect(user).toHaveProperty('name');
      expect(user).toHaveProperty('email');
    });

    it('должен вернуть 404 если пользователь не найден', async () => {
      const response = await client.get('/api/users/999');

      expect(response.status).toBe(404);

      const error = await response.json();
      expect(error).toHaveProperty('error', 'User not found');
    });
  });

  describe('POST /api/users', () => {
    it('должен создать пользователя с заголовком Location', async () => {
      const newUser = {
        name: 'Test User',
        email: `test-${Date.now()}@example.com`, // Уникальный email
      };

      const response = await client.post('/api/users', newUser);

      expect(response.status).toBe(201);
      expect(response.headers.get('location')).toBeDefined();
      expect(response.headers.get('location')).toMatch(/^\/api\/users\/\d+$/);

      const user = await response.json();
      expect(user).toHaveProperty('id');
      expect(user.name).toBe(newUser.name);
      expect(user.email).toBe(newUser.email);
    });

    it('должен вернуть 400 если email дублируется', async () => {
      const duplicate = {
        name: 'Duplicate',
        email: 'alice@example.com', // Уже существует
      };

      const response = await client.post('/api/users', duplicate);

      expect(response.status).toBe(400);

      const error = await response.json();
      expect(error).toHaveProperty('error', 'Email already taken');
      expect(error).toHaveProperty('details', { field: 'email' });
    });

    it('должен вернуть 400 для невалидного email', async () => {
      const invalid = {
        name: 'Test',
        email: 'not-an-email',
      };

      const response = await client.post('/api/users', invalid);

      expect(response.status).toBe(400);

      const error = await response.json();
      expect(error).toHaveProperty('error');
    });
  });

  describe('PATCH /api/users/:id', () => {
    it('должен обновить пользователя', async () => {
      // Сначала создаем пользователя
      const created = await client.post('/api/users', {
        name: 'To Update',
        email: `update-${Date.now()}@example.com`,
      });
      const createdUser = await created.json();

      // Обновляем
      const update = { name: 'Updated Name' };
      const response = await client.patch(`/api/users/${createdUser.id}`, update);

      expect(response.status).toBe(200);

      const user = await response.json();
      expect(user.name).toBe('Updated Name');
      expect(user.email).toBe(createdUser.email); // email не изменился
    });

    it('должен вернуть 404 если пользователь не найден', async () => {
      const response = await client.patch('/api/users/999', {
        name: 'Test',
      });

      expect(response.status).toBe(404);
    });

    it('должен вернуть 400 если email занят', async () => {
      const response = await client.patch('/api/users/2', {
        email: 'alice@example.com', // Уже занят пользователем с id=1
      });

      expect(response.status).toBe(400);

      const error = await response.json();
      expect(error).toHaveProperty('error', 'Email already taken');
    });

    it('должен вернуть 400 если нет данных для обновления', async () => {
      const response = await client.patch('/api/users/1', {});

      expect(response.status).toBe(400);

      const error = await response.json();
      expect(error).toHaveProperty('error', 'No data to update');
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('должен удалить пользователя с 204 No Content', async () => {
      // Создаем пользователя для удаления
      const created = await client.post('/api/users', {
        name: 'To Delete',
        email: `delete-${Date.now()}@example.com`,
      });
      const createdUser = await created.json();

      // Удаляем
      const response = await client.delete(`/api/users/${createdUser.id}`);

      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');

      // Проверяем, что пользователь действительно удален
      const checkResponse = await client.get(`/api/users/${createdUser.id}`);
      expect(checkResponse.status).toBe(404);
    });

    it('должен вернуть 404 если пользователь не найден', async () => {
      const response = await client.delete('/api/users/999');

      expect(response.status).toBe(404);
    });

    it('должен вернуть 403 при попытке удалить admin (id=1)', async () => {
      const response = await client.delete('/api/users/1');

      expect(response.status).toBe(403);

      const error = await response.json();
      expect(error).toHaveProperty('error', 'Cannot delete admin user');
    });
  });
});

