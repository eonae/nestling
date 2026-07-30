import type { ILoggerService } from '../../logger/logger.service';
import { EmailTaken } from '../user.errors';
import type { UserService } from '../user.service';

import { createUserHandler } from './create-user.endpoint';

import { Ok } from '@nestling/pipeline';
import { mock } from 'jest-mock-extended';

describe('createUserHandler', () => {
  let handle: ReturnType<typeof createUserHandler>;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    userService = mock<UserService>();
    logger = mock<ILoggerService>();

    handle = createUserHandler(userService, logger);
  });

  describe('Успешные сценарии', () => {
    it('должен создать пользователя с заголовком Location', async () => {
      const newUser = {
        name: 'Test',
        email: 'test@example.com',
      };
      const createdUser = { id: '3', ...newUser };
      userService.findByEmail.mockResolvedValue(null);
      userService.create.mockResolvedValue(createdUser);

      const result = await handle(newUser);

      if (result instanceof Ok) {
        expect(result.value).toEqual(createdUser);
        expect(result.headers).toHaveProperty('Location', '/api/users/3');
        expect(userService.findByEmail).toHaveBeenCalledWith(
          'test@example.com',
        );
        expect(userService.create).toHaveBeenCalledWith(newUser);
      } else {
        expect(result).toBeInstanceOf(Ok); // Will fail
      }
    });

    it('dryRun из query-строки проверяет, но не создаёт', async () => {
      userService.findByEmail.mockResolvedValue(null);

      const result = await handle({
        name: 'Test',
        email: 'test@example.com',
        dryRun: true,
      });

      expect(result).toBeInstanceOf(Ok);
      expect(userService.create).not.toHaveBeenCalled();
    });
  });

  describe('Ошибочные сценарии', () => {
    it('должен вернуть EmailTaken (409) если email дублируется', async () => {
      const newUser = {
        name: 'Test',
        email: 'existing@example.com',
      };
      const existingUser = {
        id: '1',
        name: 'Existing',
        email: 'existing@example.com',
      };
      userService.findByEmail.mockResolvedValue(existingUser);

      const result = await handle(newUser);

      expect(EmailTaken.is(result)).toBe(true);
      expect(result).toMatchObject({
        status: 'CONFLICT',
        code: EmailTaken.code,
        details: { email: 'existing@example.com' },
      });
    });
  });
});
