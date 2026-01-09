import { Fail, Ok } from '@nestling/pipeline';
import type { FilePart } from '@nestling/pipeline';
import { MAX_AVATAR_SIZE } from '../../../common/constants';
import { UploadAvatarEndpoint } from './upload-avatar.endpoint';
import type { UserService } from '../user.service';
import type { ILoggerService } from '../../logger/logger.service';
import { Readable } from 'node:stream';
import { mock } from 'jest-mock-extended';

describe('UploadAvatarEndpoint', () => {
  let endpoint: UploadAvatarEndpoint;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    userService = mock<UserService>();
    logger = mock<ILoggerService>();

    endpoint = new UploadAvatarEndpoint(userService, logger);
  });

  describe('Успешные сценарии', () => {
    it('должен загрузить аватар для пользователя', async () => {
      const avatarFile: FilePart = {
        field: 'avatar',
        filename: 'avatar.png',
        mime: 'image/png',
        stream: Readable.from('fake image data'),
        size: 1000,
      };

      const updatedUser = {
        id: '1',
        name: 'Alice',
        email: 'alice@test.com',
        avatarUrl: '/uploads/1/avatar.png',
      };

      userService.updateAvatar.mockResolvedValue(updatedUser);

      const result = await endpoint.handle({
        data: { id: '1' },
        files: [avatarFile],
      });

      if (result instanceof Ok) {
        expect(result.value).toEqual(updatedUser);
        expect(userService.updateAvatar).toHaveBeenCalledWith('1', '/uploads/1/avatar.png');
      } else {
        expect(result).toBeInstanceOf(Ok);
      }
    });
  });

  describe('Ошибочные сценарии', () => {
    it('должен бросить Fail.badRequest если файл отсутствует', async () => {
      await expect(
        endpoint.handle({
          data: { id: '1' },
          files: [],
        }),
      ).rejects.toThrow(Fail);

      await expect(
        endpoint.handle({
          data: { id: '1' },
          files: [],
        }),
      ).rejects.toMatchObject({
        status: 'BAD_REQUEST',
        message: 'Avatar file is required',
      });
    });

    it('должен бросить Fail.badRequest для не-изображения', async () => {
      const textFile: FilePart = {
        field: 'avatar',
        filename: 'document.txt',
        mime: 'text/plain',
        stream: Readable.from('text content'),
        size: 100,
      };

      await expect(
        endpoint.handle({
          data: { id: '1' },
          files: [textFile],
        }),
      ).rejects.toThrow(Fail);

      await expect(
        endpoint.handle({
          data: { id: '1' },
          files: [textFile],
        }),
      ).rejects.toMatchObject({
        status: 'BAD_REQUEST',
        message: 'Only images are allowed',
      });
    });

    it('должен бросить Fail.badRequest для слишком большого файла', async () => {
      const largeFile: FilePart = {
        field: 'avatar',
        filename: 'large.png',
        mime: 'image/png',
        stream: Readable.from('large image data'),
        size: MAX_AVATAR_SIZE + 1,
      };

      await expect(
        endpoint.handle({
          data: { id: '1' },
          files: [largeFile],
        }),
      ).rejects.toThrow(Fail);

      await expect(
        endpoint.handle({
          data: { id: '1' },
          files: [largeFile],
        }),
      ).rejects.toMatchObject({
        status: 'BAD_REQUEST',
      });
    });

    it('должен бросить Fail.notFound если пользователь не найден', async () => {
      const avatarFile: FilePart = {
        field: 'avatar',
        filename: 'avatar.png',
        mime: 'image/png',
        stream: Readable.from('fake image data'),
        size: 1000,
      };

      userService.updateAvatar.mockResolvedValue(null);

      await expect(
        endpoint.handle({
          data: { id: '999' },
          files: [avatarFile],
        }),
      ).rejects.toThrow(Fail);

      await expect(
        endpoint.handle({
          data: { id: '999' },
          files: [avatarFile],
        }),
      ).rejects.toMatchObject({
        status: 'NOT_FOUND',
        message: 'User not found',
      });
    });
  });
});

