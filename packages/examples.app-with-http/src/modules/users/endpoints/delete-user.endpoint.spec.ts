import { Fail, Ok } from '@nestling/pipeline';
import { ADMIN_USER_ID } from '../../../common/constants';
import { DeleteUserEndpoint } from './delete-user.endpoint';
import type { UserService } from '../user.service';
import type { ILoggerService } from '../../logger/logger.service';
import { mock } from 'jest-mock-extended';

describe('DeleteUserEndpoint', () => {
  let endpoint: DeleteUserEndpoint;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    userService = mock<UserService>();
    logger = mock<ILoggerService>();

    endpoint = new DeleteUserEndpoint(userService, logger);
  });

  describe('Успешные сценарии', () => {
    it('должен удалить пользователя и вернуть Ok.noContent', async () => {
      userService.delete.mockResolvedValue(true);

      const result = await endpoint.handle({ id: '2' });

      if (result instanceof Ok) {
        expect(result.status).toBe('NO_CONTENT');
        expect(userService.delete).toHaveBeenCalledWith('2');
      } else {
        expect(result).toBeInstanceOf(Ok); // Will fail
      }
    });
  });

  describe('Ошибочные сценарии', () => {
    it('должен бросить Fail.notFound если пользователь не найден', async () => {
      userService.delete.mockResolvedValue(false);

      await expect(endpoint.handle({ id: '999' })).rejects.toThrow(Fail);

      await expect(endpoint.handle({ id: '999' })).rejects.toMatchObject({
        status: 'NOT_FOUND',
        message: 'User not found',
      });
    });

    it('должен бросить Fail.forbidden при попытке удалить admin', async () => {
      await expect(endpoint.handle({ id: ADMIN_USER_ID })).rejects.toThrow(Fail);

      await expect(endpoint.handle({ id: ADMIN_USER_ID })).rejects.toMatchObject({
        status: 'FORBIDDEN',
        message: 'Cannot delete admin user',
      });
    });
  });
});

