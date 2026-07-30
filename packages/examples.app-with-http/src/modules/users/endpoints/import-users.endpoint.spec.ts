import type { ILoggerService } from '../../logger/logger.service';
import type { UserService } from '../user.service';

import { ImportUsersHandler } from './import-users.endpoint';

import { Ok } from '@nestling/pipeline';
import { mock } from 'jest-mock-extended';

async function* mockTwoUsersStream() {
  yield { name: 'User1', email: 'user1@test.com' };
  yield { name: 'User2', email: 'user2@test.com' };
}

async function* mockOneUserStream() {
  yield { name: 'User1', email: 'user1@test.com' };
}

describe('ImportUsersHandler', () => {
  let endpoint: ImportUsersHandler;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    userService = mock<UserService>();
    logger = mock<ILoggerService>();

    endpoint = new ImportUsersHandler(userService, logger);
  });

  it('должен импортировать пользователей и вернуть статистику', async () => {
    const importResult = {
      imported: 2,
      failed: 0,
    };

    userService.importUsers.mockResolvedValue(importResult);

    const result = await endpoint.handle(mockTwoUsersStream());

    if (result instanceof Ok) {
      expect(result.value).toEqual(importResult);
      expect(result.headers).toHaveProperty('X-Import-Status', 'complete');
      expect(userService.importUsers).toHaveBeenCalled();
    } else {
      expect(result).toBeInstanceOf(Ok); // Will fail
    }
  });

  it('должен вернуть статус partial при наличии ошибок', async () => {
    const importResult = {
      imported: 1,
      failed: 1,
      errors: [{ line: 2, error: 'Invalid email' }],
    };

    userService.importUsers.mockResolvedValue(importResult);

    const result = await endpoint.handle(mockOneUserStream());

    if (result instanceof Ok) {
      expect(result.headers).toHaveProperty('X-Import-Status', 'partial');
    } else {
      expect(result).toBeInstanceOf(Ok); // Will fail
    }
  });
});
