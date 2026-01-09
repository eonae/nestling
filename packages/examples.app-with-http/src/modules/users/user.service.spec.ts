import { UserService } from './user.service';
import type { ILoggerService } from '../logger/logger.service';

describe('UserService', () => {
  let service: UserService;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    logger = {
      log: jest.fn(),
      error: jest.fn(),
    } as any;
    service = new UserService(logger);
  });

  describe('getById', () => {
    it('должен вернуть пользователя если существует', async () => {
      const user = await service.getById('1');
      expect(user).toBeDefined();
      expect(user?.id).toBe('1');
      expect(user?.name).toBe('Alice');
    });

    it('должен вернуть null если не существует', async () => {
      const user = await service.getById('999');
      expect(user).toBeNull();
    });
  });

  describe('getAll', () => {
    it('должен вернуть всех пользователей', async () => {
      const users = await service.getAll();
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeGreaterThan(0);
    });
  });

  describe('create', () => {
    it('должен создать пользователя с автоинкрементным ID', async () => {
      const initialLength = (await service.getAll()).length;

      const newUser = await service.create({
        name: 'Test',
        email: 'test@example.com',
      });

      expect(newUser).toBeDefined();
      expect(newUser.id).toBeDefined();
      expect(newUser.name).toBe('Test');
      expect(newUser.email).toBe('test@example.com');

      const allUsers = await service.getAll();
      expect(allUsers.length).toBe(initialLength + 1);
    });
  });

  describe('update', () => {
    it('должен обновить существующего пользователя', async () => {
      const updated = await service.update('1', { name: 'Updated' });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('Updated');
      expect(updated?.id).toBe('1');
    });

    it('должен вернуть null для несуществующего пользователя', async () => {
      const updated = await service.update('999', { name: 'Test' });
      expect(updated).toBeNull();
    });
  });

  describe('delete', () => {
    it('должен удалить пользователя', async () => {
      // Сначала создаем пользователя
      const created = await service.create({
        name: 'ToDelete',
        email: 'delete@test.com',
      });

      const result = await service.delete(created.id);
      expect(result).toBe(true);

      const deleted = await service.getById(created.id);
      expect(deleted).toBeNull();
    });

    it('должен вернуть false для несуществующего пользователя', async () => {
      const result = await service.delete('999');
      expect(result).toBe(false);
    });
  });

  describe('search', () => {
    it('должен найти пользователей по имени', async () => {
      const results = await service.search('Alice');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toContain('Alice');
    });

    it('должен найти пользователей по email', async () => {
      const results = await service.search('bob@example.com');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].email).toBe('bob@example.com');
    });

    it('должен вернуть пустой массив если ничего не найдено', async () => {
      const results = await service.search('NonExistent');
      expect(results).toEqual([]);
    });
  });

  describe('findByEmail', () => {
    it('должен найти пользователя по email', async () => {
      const user = await service.findByEmail('alice@example.com');

      expect(user).toBeDefined();
      expect(user?.email).toBe('alice@example.com');
    });

    it('должен вернуть null если email не найден', async () => {
      const user = await service.findByEmail('notfound@example.com');
      expect(user).toBeNull();
    });
  });

  describe('exportAll', () => {
    it('должен вернуть AsyncIterableIterator', async () => {
      const stream = service.exportAll();

      expect(stream[Symbol.asyncIterator]).toBeDefined();

      const users = [];
      for await (const user of stream) {
        users.push(user);
      }

      expect(users.length).toBeGreaterThan(0);
    });
  });

  describe('importUsers', () => {
    it('должен импортировать пользователей из стрима', async () => {
      async function* userStream() {
        yield { name: 'Import1', email: 'import1@test.com' };
        yield { name: 'Import2', email: 'import2@test.com' };
      }

      const result = await service.importUsers(userStream());

      expect(result.imported).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('должен обработать частичный импорт с ошибками', async () => {
      async function* userStream() {
        yield { name: 'Valid', email: 'valid@test.com' };
        yield { name: '', email: 'invalid@test.com' }; // Отсутствует name
        yield { name: 'Valid2', email: 'valid2@test.com' };
      }

      const result = await service.importUsers(userStream());

      expect(result.imported).toBeGreaterThan(0);
      expect(result.failed).toBeGreaterThan(0);
      expect(result.errors).toBeDefined();
    });
  });

  describe('updateAvatar', () => {
    it('должен обновить аватар пользователя', async () => {
      const user = await service.updateAvatar('1', '/uploads/1/avatar.png');

      expect(user).toBeDefined();
      expect(user?.avatarUrl).toBe('/uploads/1/avatar.png');
    });
  });
});

