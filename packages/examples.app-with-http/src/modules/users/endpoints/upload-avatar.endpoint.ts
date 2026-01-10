import { Injectable } from '@nestling/container';
import type { IEndpoint, Output, WithFiles } from '@nestling/pipeline';
import { Fail, Ok, withFiles } from '@nestling/pipeline';
import { HttpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

import { noValidationPipeline } from '../../../common/pipelines';
import { MAX_AVATAR_SIZE } from '../../../common/constants';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

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

/**
 * Endpoint для загрузки аватара пользователя
 * Демонстрирует:
 * - Работа с файлами (multipart/form-data)
 * - Валидация типа и размера файла
 * - Fail.badRequest() для невалидных файлов
 */
@Injectable([UserService, ILogger])
@HttpEndpoint('POST', '/api/users/:id/avatar', {
  input: withFiles(UploadAvatarInput),
  output: UploadAvatarOutput,
  pipeline: noValidationPipeline,
})
export class UploadAvatarEndpoint implements IEndpoint
{
  constructor(
    private userService: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(
    input: WithFiles<UploadAvatarInput>,
  ): Output<UploadAvatarOutput> {
    const { data, files } = input;
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
    if (avatarFile.size && avatarFile.size > MAX_AVATAR_SIZE) {
      throw Fail.badRequest(
        `File too large (max ${MAX_AVATAR_SIZE / 1_000_000}MB)`,
      );
    }

    // Сохраняем файл (мок - просто сохраняем путь в памяти)
    const avatarUrl = `/uploads/${data.id}/${avatarFile.filename}`;

    const user = await this.userService.updateAvatar(data.id, avatarUrl);

    if (!user) {
      throw Fail.notFound('User not found');
    }

    return new Ok(user);
  }
}
