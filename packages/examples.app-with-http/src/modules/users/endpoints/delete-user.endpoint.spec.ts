import { ADMIN_USER_ID } from '../../../common/constants';
import type { ILoggerService } from '../../logger/logger.service';
import { UserNotDeletable, UserNotFound } from '../user.errors';
import type { UserService } from '../user.service';

import { deleteUserHandler } from './delete-user.endpoint';

import { Fail, Ok } from '@nestling/pipeline';
import { mock } from 'jest-mock-extended';

describe('deleteUserHandler', () => {
  let handle: ReturnType<typeof deleteUserHandler>;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    userService = mock<UserService>();
    logger = mock<ILoggerService>();

    handle = deleteUserHandler(userService, logger);
  });

  describe('Успешные сценарии', () => {
    it('должен удалить пользователя и вернуть Ok.noContent', async () => {
      userService.delete.mockResolvedValue(true);

      const result = await handle({ id: '2' });

      if (result instanceof Ok) {
        expect(result.status).toBe('NO_CONTENT');
        expect(userService.delete).toHaveBeenCalledWith('2');
      } else {
        expect(result).toBeInstanceOf(Ok); // Will fail
      }
    });
  });

  describe('Ошибочные сценарии', () => {
    it('должен бросить UserNotFound если пользователь не найден', async () => {
      userService.delete.mockResolvedValue(false);

      await expect(handle({ id: '999' })).rejects.toThrow(Fail);

      await expect(handle({ id: '999' })).rejects.toMatchObject({
        status: 'NOT_FOUND',
        code: UserNotFound.code,
        details: { id: '999' },
      });
    });

    it('должен бросить UserNotDeletable при попытке удалить admin', async () => {
      await expect(handle({ id: ADMIN_USER_ID })).rejects.toThrow(Fail);

      await expect(handle({ id: ADMIN_USER_ID })).rejects.toMatchObject({
        status: 'FORBIDDEN',
        code: UserNotDeletable.code,
        details: { id: ADMIN_USER_ID, reason: 'admin user' },
      });
    });
  });
});
