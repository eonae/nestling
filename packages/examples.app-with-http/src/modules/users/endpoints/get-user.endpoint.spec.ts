import type { ILoggerService } from '../../logger/logger.service';
import { UserNotFound } from '../user.errors';
import type { UserService } from '../user.service';

import { getUserHandler } from './get-user.endpoint';

import { Ok } from '@nestling/pipeline';
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
    it('должен вернуть UserNotFound если пользователь не найден', async () => {
      userService.getById.mockResolvedValue(null);

      // Канал возврата: отказ — значение, а не исключение
      const result = await handle({ id: '999' });

      expect(UserNotFound.is(result)).toBe(true);
      expect(result).toMatchObject({
        status: 'NOT_FOUND',
        code: 'USER_NOT_FOUND',
        details: { id: '999' },
      });
    });
  });
});
