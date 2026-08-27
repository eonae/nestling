import type { ILoggerService } from '../../logger';
import type { UserService } from '../user.service';

import { listUsersHandler } from './list-users.endpoint';

import { mock } from 'jest-mock-extended';

describe('listUsersHandler', () => {
  let handle: ReturnType<typeof listUsersHandler>;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    userService = mock<UserService>();
    logger = mock<ILoggerService>();

    handle = listUsersHandler(userService, logger);
  });

  it('должен вернуть массив пользователей напрямую', async () => {
    const users = [
      { id: '1', name: 'Alice', email: 'alice@test.com' },
      { id: '2', name: 'Bob', email: 'bob@test.com' },
    ];
    userService.getAll.mockResolvedValue(users);

    const result = await handle();

    // Проверяем, что возвращается напрямую (не new Ok)
    expect(result).toEqual(users);
    expect(userService.getAll).toHaveBeenCalled();
  });
});
