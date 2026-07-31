import type { ClaimQuota, UserRegistered } from '../../../contracts';
import { QuotaExceeded } from '../../../contracts';
import type { ILoggerService } from '../../logger';
import { EmailTaken } from '../user.errors';
import type { UserService } from '../user.service';

import { createUserHandler } from './create-user.endpoint';

import { Ok } from '@nestling/pipeline';
import type { Emitter, Port } from '@nestling/ports';
import { mock } from 'jest-mock-extended';

describe('createUserHandler', () => {
  let handle: ReturnType<typeof createUserHandler>;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;
  let quotas: jest.Mocked<Port<typeof ClaimQuota>>;
  let registered: jest.Mocked<Emitter<typeof UserRegistered>>;

  beforeEach(() => {
    userService = mock<UserService>();
    logger = mock<ILoggerService>();

    // Порт — обычная зависимость, поэтому юнит-тест хендлера его просто
    // подменяет: ни контейнера, ни шины здесь нет
    quotas = mock<Port<typeof ClaimQuota>>();
    registered = mock<Emitter<typeof UserRegistered>>();

    quotas.call.mockResolvedValue(new Ok({ remaining: 4 }));
    registered.emit.mockResolvedValue();

    handle = createUserHandler(userService, logger, quotas, registered);
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

    it('отказ соседней фичи возвращается как есть, а пользователь не создаётся', async () => {
      userService.findByEmail.mockResolvedValue(null);
      quotas.call.mockResolvedValue(QuotaExceeded({ limit: 5 }));

      const result = await handle({ name: 'Test', email: 'test@example.com' });

      expect(QuotaExceeded.is(result)).toBe(true);
      expect(userService.create).not.toHaveBeenCalled();
      expect(registered.emit).not.toHaveBeenCalled();
    });
  });
});
