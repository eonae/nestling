import type { ILoggerService } from '../../logger/logger.service';
import type { UserService } from '../user.service';

import { updateUserHandler } from './update-user.endpoint';

import { Fail } from '@nestling/pipeline';
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

  describe('Успешные сценарии', () => {
    it('должен обновить пользователя и вернуть напрямую', async () => {
      const updatedUser = { id: '1', name: 'Updated', email: 'alice@test.com' };
      userService.findByEmail.mockResolvedValue(null);
      userService.update.mockResolvedValue(updatedUser);

      const result = await handle({ id: '1', name: 'Updated' });

      // Возвращается напрямую, не через new Ok
      expect(result).toEqual(updatedUser);
      expect(userService.update).toHaveBeenCalledWith('1', { name: 'Updated' });
    });
  });

  describe('Ошибочные сценарии', () => {
    it('должен бросить Fail.notFound если пользователь не найден', async () => {
      userService.update.mockResolvedValue(null);

      await expect(handle({ id: '999', name: 'Test' })).rejects.toThrow(Fail);

      await expect(handle({ id: '999', name: 'Test' })).rejects.toMatchObject({
        status: 'NOT_FOUND',
        message: 'User not found',
      });
    });

    it('должен бросить Fail.badRequest если email занят', async () => {
      const existingUser = { id: '2', name: 'Bob', email: 'bob@test.com' };
      userService.findByEmail.mockResolvedValue(existingUser);

      await expect(handle({ id: '1', email: 'bob@test.com' })).rejects.toThrow(
        Fail,
      );

      await expect(
        handle({ id: '1', email: 'bob@test.com' }),
      ).rejects.toMatchObject({
        status: 'BAD_REQUEST',
        message: 'Email already taken',
      });
    });

    it('должен бросить Fail.badRequest если нет данных для обновления', async () => {
      await expect(handle({ id: '1' })).rejects.toThrow(Fail);

      await expect(handle({ id: '1' })).rejects.toMatchObject({
        status: 'BAD_REQUEST',
        message: 'No data to update',
      });
    });
  });
});
