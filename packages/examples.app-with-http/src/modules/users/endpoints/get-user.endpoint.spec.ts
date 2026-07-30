import type { ILoggerService } from '../../logger/logger.service';
import type { UserService } from '../user.service';

import { getUserHandler } from './get-user.endpoint';

import { Fail, Ok } from '@nestling/pipeline';
import { mock } from 'jest-mock-extended';

describe('getUserHandler', () => {
  let handle: ReturnType<typeof getUserHandler>;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    userService = mock<UserService>();
    logger = mock<ILoggerService>();

    handle = getUserHandler(userService, logger);
  });

  describe('Успешные сценарии', () => {
    it('должен вернуть пользователя с заголовками', async () => {
      const user = { id: '1', name: 'Alice', email: 'alice@test.com' };
      userService.getById.mockResolvedValue(user);

      const result = await handle({ id: '1' });

      if (result instanceof Ok) {
        expect(result.value).toEqual(user);
        expect(result.headers).toHaveProperty('ETag');
        expect(result.headers).toHaveProperty('Cache-Control', 'max-age=300');
        expect(userService.getById).toHaveBeenCalledWith('1');
      } else {
        expect(result).toBeInstanceOf(Ok); // Will fail
      }
    });
  });

  describe('Ошибочные сценарии', () => {
    it('должен бросить Fail.notFound если пользователь не найден', async () => {
      userService.getById.mockResolvedValue(null);

      await expect(handle({ id: '999' })).rejects.toThrow(Fail);

      await expect(handle({ id: '999' })).rejects.toMatchObject({
        status: 'NOT_FOUND',
        message: 'User not found',
      });
    });
  });
});
