import { MAX_AVATAR_SIZE } from '../../../common/constants';
import { noValidationPipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

import { Injectable } from '@nestling/container';
import type { FilePart, Output } from '@nestling/pipeline';
import { Fail, Ok, withFiles } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const UploadAvatarInput = z.object({
  id: z.string(), // userId из params
});

const UploadAvatarOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().optional(),
});

type UploadAvatarInput = z.infer<typeof UploadAvatarInput>;
type UploadAvatarOutput = z.infer<typeof UploadAvatarOutput>;

@Injectable([UserService, ILogger])
export class UploadAvatarHandler {
  constructor(
    private readonly users: UserService,
    private readonly logger: ILoggerService,
  ) {}

  async handle(payload: {
    data: UploadAvatarInput;
    files: FilePart[];
  }): Output<UploadAvatarOutput> {
    const { data, files } = payload;
    this.logger.log(`Handling POST /api/users/${data.id}/avatar`);

    // Находим файл с именем поля 'avatar'
    const avatarFile = files.find((f) => f.field === 'avatar');

    if (!avatarFile) {
      throw Fail.badRequest('Avatar file is required');
    }

    // Валидация типа файла
    if (!avatarFile.mime.startsWith('image/')) {
      throw Fail.badRequest('Only images are allowed');
    }

    // Валидация размера файла
    if (avatarFile.size !== undefined && avatarFile.size > MAX_AVATAR_SIZE) {
      throw Fail.badRequest(
        `File too large (max ${MAX_AVATAR_SIZE / 1_000_000}MB)`,
      );
    }

    // Сохраняем файл (мок - просто сохраняем путь в памяти)
    const avatarUrl = `/uploads/${data.id}/${avatarFile.filename}`;

    const user = await this.users.updateAvatar(data.id, avatarUrl);

    if (!user) {
      throw Fail.notFound('User not found');
    }

    return new Ok(user);
  }
}

/**
 * Endpoint для загрузки аватара пользователя
 * Демонстрирует:
 * - Работа с файлами (multipart/form-data)
 * - Валидация типа и размера файла
 * - Fail.badRequest() для невалидных файлов
 */
export const UploadAvatar = httpEndpoint({
  method: 'POST',
  path: '/api/users/:id/avatar',
  input: withFiles(UploadAvatarInput),
  output: UploadAvatarOutput,
  pipeline: noValidationPipeline,
  handle: UploadAvatarHandler,
});
