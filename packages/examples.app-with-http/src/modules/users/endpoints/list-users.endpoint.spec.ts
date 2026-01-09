import { ListUsersEndpoint } from './list-users.endpoint';
import type { UserService } from '../user.service';
import type { ILoggerService } from '../../logger/logger.service';
import { mock } from 'jest-mock-extended';

describe('ListUsersEndpoint', () => {
  let endpoint: ListUsersEndpoint;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    userService = mock<UserService>();
    logger = mock<ILoggerService>();

    endpoint = new ListUsersEndpoint(userService, logger);
  });

  it('должен вернуть массив пользователей напрямую', async () => {
    const users = [
      { id: '1', name: 'Alice', email: 'alice@test.com' },
      { id: '2', name: 'Bob', email: 'bob@test.com' },
    ];
    userService.getAll.mockResolvedValue(users);

    const result = await endpoint.handle();

    // Проверяем, что возвращается напрямую (не new Ok)
    expect(result).toEqual(users);
    expect(userService.getAll).toHaveBeenCalled();
  });
});

