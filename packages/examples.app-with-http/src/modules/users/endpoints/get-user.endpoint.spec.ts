import { Fail, Ok } from '@nestling/pipeline';
import { GetUserEndpoint } from './get-user.endpoint';
import type { UserService } from '../user.service';
import type { ILoggerService } from '../../logger/logger.service';
import { mock } from 'jest-mock-extended';

describe('GetUserEndpoint', () => {
  let endpoint: GetUserEndpoint;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    userService = mock<UserService>();
    logger = mock<ILoggerService>();

    endpoint = new GetUserEndpoint(userService, logger);
  });

  describe('Успешные сценарии', () => {
    it('должен вернуть пользователя с заголовками', async () => {
      const user = { id: '1', name: 'Alice', email: 'alice@test.com' };
      userService.getById.mockResolvedValue(user);

      const result = await endpoint.handle({ id: '1' });

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

      await expect(endpoint.handle({ id: '999' })).rejects.toThrow(Fail);

      await expect(endpoint.handle({ id: '999' })).rejects.toMatchObject({
        status: 'NOT_FOUND',
        message: 'User not found',
      });
    });
  });
});

