import {
  createTestApp,
  closeTestApp,
  type TestAppContext,
} from './helpers/create-test-app';
import { HttpClient } from './helpers/http-client';

describe('Streaming (E2E)', () => {
  let testContext: TestAppContext;
  let client: HttpClient;

  beforeAll(async () => {
    testContext = await createTestApp();
    client = new HttpClient(testContext.baseUrl);
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(testContext);
  });

  describe('GET /api/users/export (streaming output)', () => {
    it('должен вернуть NDJSON stream с заголовками', async () => {
      const response = await client.get('/api/users/export');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/x-ndjson');
      expect(response.headers.get('content-disposition')).toContain('users.ndjson');

      // Читаем stream
      const text = await response.text();
      const lines = text.trim().split('\n').filter((line) => line.length > 0);

      expect(lines.length).toBeGreaterThan(0);

      // Каждая строка должна быть валидным JSON
      for (const line of lines) {
        const user = JSON.parse(line);
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('name');
        expect(user).toHaveProperty('email');
      }
    });
  });

  describe('POST /api/users/import (streaming input)', () => {
    it('должен импортировать пользователей из NDJSON stream', async () => {
      const timestamp = Date.now();
      const usersToImport = [
        { name: 'Import User 1', email: `import1-${timestamp}@example.com` },
        { name: 'Import User 2', email: `import2-${timestamp}@example.com` },
        { name: 'Import User 3', email: `import3-${timestamp}@example.com` },
      ];

      // Формируем NDJSON
      const ndjson = usersToImport.map((u) => JSON.stringify(u)).join('\n');

      const response = await fetch(`${testContext.baseUrl}/api/users/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-ndjson',
        },
        body: ndjson,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('x-import-status')).toBe('complete');

      const result = await response.json();
      expect(result).toHaveProperty('imported', 3);
      expect(result).toHaveProperty('failed', 0);
    });

    it('должен обработать частичный импорт с ошибками', async () => {
      const timestamp = Date.now();
      const usersToImport = [
        { name: 'Valid User', email: `valid-${timestamp}@example.com` },
        { name: 'Invalid', email: 'not-an-email' }, // Невалидный email
        { name: 'Valid User 2', email: `valid2-${timestamp}@example.com` },
      ];

      const ndjson = usersToImport.map((u) => JSON.stringify(u)).join('\n');

      const response = await fetch(`${testContext.baseUrl}/api/users/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-ndjson',
        },
        body: ndjson,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('x-import-status')).toBe('partial');

      const result = await response.json();
      expect(result.imported).toBeGreaterThan(0);
      expect(result.failed).toBeGreaterThan(0);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});

