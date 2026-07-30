import type { ILoggerService } from '../../logger/logger.service';
import type { UserService } from '../user.service';

import { ExportUsersHandler } from './export-users.endpoint';

import { Ok } from '@nestling/pipeline';
import { mock } from 'jest-mock-extended';

async function* mockStream() {
  yield { id: '1', name: 'Alice', email: 'alice@test.com' };
  yield { id: '2', name: 'Bob', email: 'bob@test.com' };
}

describe('ExportUsersHandler', () => {
  let endpoint: ExportUsersHandler;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    userService = mock<UserService>();
    logger = mock<ILoggerService>();

    endpoint = new ExportUsersHandler(userService, logger);
  });

  it('должен вернуть AsyncIterableIterator с заголовками', async () => {
    userService.exportAll.mockReturnValue(mockStream());

    const result = await endpoint.handle();

    if (result instanceof Ok) {
      expect(result).toBeInstanceOf(Ok);
      expect(result.headers).toHaveProperty(
        'Content-Type',
        'application/x-ndjson',
      );
      expect(result.headers).toHaveProperty(
        'Content-Disposition',
        'attachment; filename="users.ndjson"',
      );

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
