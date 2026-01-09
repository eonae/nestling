import { Ok } from '@nestling/pipeline';
import { ImportUsersEndpoint } from './import-users.endpoint';
import type { UserService } from '../user.service';
import type { ILoggerService } from '../../logger/logger.service';
import { mock } from 'jest-mock-extended';

describe('ImportUsersEndpoint', () => {
  let endpoint: ImportUsersEndpoint;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    userService = mock<UserService>();
    logger = mock<ILoggerService>();

    endpoint = new ImportUsersEndpoint(userService, logger);
  });

  it('должен импортировать пользователей и вернуть статистику', async () => {
    async function* mockStream() {
      yield { name: 'User1', email: 'user1@test.com' };
      yield { name: 'User2', email: 'user2@test.com' };
    }

    const importResult = {
      imported: 2,
      failed: 0,
    };

    userService.importUsers.mockResolvedValue(importResult);

    const result = await endpoint.handle(mockStream());

    if (result instanceof Ok) {
      expect(result.value).toEqual(importResult);
      expect(result.headers).toHaveProperty('X-Import-Status', 'complete');
      expect(userService.importUsers).toHaveBeenCalled();
    } else {
      expect(result).toBeInstanceOf(Ok); // Will fail
    }
  });

  it('должен вернуть статус partial при наличии ошибок', async () => {
    async function* mockStream() {
      yield { name: 'User1', email: 'user1@test.com' };
    }

    const importResult = {
      imported: 1,
      failed: 1,
      errors: [{ line: 2, error: 'Invalid email' }],
    };

    userService.importUsers.mockResolvedValue(importResult);

    const result = await endpoint.handle(mockStream());

    if (result instanceof Ok) {
      expect(result.headers).toHaveProperty('X-Import-Status', 'partial');
    } else {
      expect(result).toBeInstanceOf(Ok); // Will fail
    }
  });
});

