import { Ok } from '@nestling/pipeline';
import { ExportUsersEndpoint } from './export-users.endpoint';
import type { UserService } from '../user.service';
import type { ILoggerService } from '../../logger/logger.service';
import { mock } from 'jest-mock-extended';

describe('ExportUsersEndpoint', () => {
  let endpoint: ExportUsersEndpoint;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    userService = mock<UserService>();
    logger = mock<ILoggerService>();

    endpoint = new ExportUsersEndpoint(userService, logger);
  });

  it('должен вернуть AsyncIterableIterator с заголовками', async () => {
    async function* mockStream() {
      yield { id: '1', name: 'Alice', email: 'alice@test.com' };
      yield { id: '2', name: 'Bob', email: 'bob@test.com' };
    }

    userService.exportAll.mockReturnValue(mockStream());

    const result = await endpoint.handle();

    if (result instanceof Ok) {
      expect(result).toBeInstanceOf(Ok);
      expect(result.headers).toHaveProperty('Content-Type', 'application/x-ndjson');
      expect(result.headers).toHaveProperty('Content-Disposition', 'attachment; filename="users.ndjson"');

      // Проверяем, что это AsyncIterableIterator
      const iterator = result.value;
      expect(iterator[Symbol.asyncIterator]).toBeDefined();
      const users = [];
      for await (const user of iterator) {
        users.push(user);
      }

      expect(users.length).toBe(2);
    } else {
      expect(result).toBeInstanceOf(Ok); // Will fail
    }
  });
});

