import type { ILoggerService } from '../../logger';
import { EmailTaken, NothingToUpdate, UserNotFound } from '../user.errors';
import type { UserService } from '../user.service';

import { updateUserHandler } from './update-user.endpoint';

import { mock } from 'jest-mock-extended';

describe('updateUserHandler', () => {
  let handle: ReturnType<typeof updateUserHandler>;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    userService = mock<UserService>();
    logger = mock<ILoggerService>();

    handle = updateUserHandler(userService, logger);
  });

  /**
   * Ключ `meta.fail` в проде добавляет рантайм пайплайна.
   * В юнит-тесте хендлера его, как и `signal`, подставляют вручную.
   */
  const meta = {
    fail: (error: unknown): never => {
      throw error;
    },
  };

  describe('Успешные сценарии', () => {
    it('должен обновить пользователя и вернуть напрямую', async () => {
      const updatedUser = { id: '1', name: 'Updated', email: 'alice@test.com' };
      userService.findByEmail.mockResolvedValue(null);
      userService.update.mockResolvedValue(updatedUser);

      const result = await handle({ id: '1', name: 'Updated' }, meta);

      // Возвращается напрямую, не через new Ok
      expect(result).toEqual(updatedUser);
      expect(userService.update).toHaveBeenCalledWith('1', { name: 'Updated' });
    });
  });

  describe('Ошибочные сценарии', () => {
    it('`meta.fail` бросает UserNotFound, если пользователь не найден', async () => {
      userService.update.mockResolvedValue(null);

      await expect(
        handle({ id: '999', name: 'Test' }, meta),
      ).rejects.toMatchObject({
        status: 'NOT_FOUND',
        code: UserNotFound.code,
        details: { id: '999' },
      });
    });

    it('`meta.fail` бросает EmailTaken (409), если email занят', async () => {
      const existingUser = { id: '2', name: 'Bob', email: 'bob@test.com' };
      userService.findByEmail.mockResolvedValue(existingUser);

      await expect(
        handle({ id: '1', email: 'bob@test.com' }, meta),
      ).rejects.toMatchObject({
        status: 'CONFLICT',
        code: EmailTaken.code,
        details: { email: 'bob@test.com' },
      });
    });

    it('`meta.fail` бросает NothingToUpdate, если нет данных для обновления', async () => {
      await expect(handle({ id: '1' }, meta)).rejects.toMatchObject({
        status: 'BAD_REQUEST',
        code: NothingToUpdate.code,
      });
    });
  });
});
