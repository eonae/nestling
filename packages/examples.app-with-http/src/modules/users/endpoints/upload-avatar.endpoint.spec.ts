import { Readable } from 'node:stream';

import type { ILoggerService } from '../../logger/logger.service';
import { InvalidAvatar, UserNotFound } from '../user.errors';
import type { UserService } from '../user.service';

import { UploadAvatarHandler } from './upload-avatar.endpoint';

import type { FilePart } from '@nestling/pipeline';
import { Fail, Ok } from '@nestling/pipeline';
import { mock } from 'jest-mock-extended';

const avatarFile = (): FilePart => ({
  field: 'avatar',
  filename: 'avatar.png',
  mime: 'image/png',
  stream: Readable.from('fake image data'),
  size: 1000,
});

describe('UploadAvatarHandler', () => {
  let endpoint: UploadAvatarHandler;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    userService = mock<UserService>();
    logger = mock<ILoggerService>();

    endpoint = new UploadAvatarHandler(userService, logger);
  });

  describe('Успешные сценарии', () => {
    it('должен загрузить аватар для пользователя', async () => {
      const updatedUser = {
        id: '1',
        name: 'Alice',
        email: 'alice@test.com',
        avatarUrl: '/uploads/1/avatar.png',
      };

      userService.updateAvatar.mockResolvedValue(updatedUser);

      const result = await endpoint.handle({
        fields: { id: '1' },
        files: { avatar: avatarFile() },
      });

      expect(result).toBeInstanceOf(Ok);
      expect((result as Ok<typeof updatedUser>).value).toEqual(updatedUser);
      expect(userService.updateAvatar).toHaveBeenCalledWith(
        '1',
        '/uploads/1/avatar.png',
      );
    });
  });

  describe('Ошибочные сценарии', () => {
    it('должен отказать, если файлового поля нет вовсе', async () => {
      const payload = {
        fields: { id: '1' },
        files: {} as { avatar: FilePart },
      };

      await expect(endpoint.handle(payload)).rejects.toThrow(Fail);
      await expect(endpoint.handle(payload)).rejects.toMatchObject({
        status: 'BAD_REQUEST',
        code: InvalidAvatar.code,
        details: { reason: 'file is required' },
      });
    });

    it('должен бросить UserNotFound, если пользователь не найден', async () => {
      userService.updateAvatar.mockResolvedValue(null);

      const payload = {
        fields: { id: '999' },
        files: { avatar: avatarFile() },
      };

      await expect(endpoint.handle(payload)).rejects.toThrow(Fail);
      await expect(endpoint.handle(payload)).rejects.toMatchObject({
        status: 'NOT_FOUND',
        code: UserNotFound.code,
      });
    });
  });
});
