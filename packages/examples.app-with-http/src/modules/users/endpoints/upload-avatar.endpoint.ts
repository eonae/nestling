import { Injectable } from '@nestling/container';
import type { IEndpoint, Output, FilePart } from '@nestling/pipeline';
import { Endpoint, Fail, Ok, withFiles } from '@nestling/pipeline';
import { z } from 'zod';
import { MAX_AVATAR_SIZE } from '../../../common/constants';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

const UploadAvatarDataSchema = z.object({
  id: z.string(), // userId из params
});

const UploadAvatarInput = withFiles(UploadAvatarDataSchema);

const UploadAvatarOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().optional(),
});

type UploadAvatarInput = {
  data: z.infer<typeof UploadAvatarDataSchema>;
  files: FilePart[];
};
type UploadAvatarOutput = z.infer<typeof UploadAvatarOutput>;

/**
 * Endpoint для загрузки аватара пользователя
 * Демонстрирует:
 * - Работа с файлами (multipart/form-data)
 * - Валидация типа и размера файла
 * - Fail.badRequest() для невалидных файлов
 */
@Injectable([UserService, ILogger])
@Endpoint({
  transport: 'http',
  pattern: 'POST /api/users/:id/avatar',
  input: UploadAvatarInput,
  output: UploadAvatarOutput,
})
export class UploadAvatarEndpoint implements IEndpoint {
  constructor(
    private userService: UserService,
    private logger: ILoggerService,
  ) {}

  async handle(payload: UploadAvatarInput): Output<UploadAvatarOutput> {
    const { id } = payload.data;
    this.logger.log(`Handling POST /api/users/${id}/avatar`);

    // Находим файл с именем поля 'avatar'
    const avatarFile = payload.files.find((f) => f.field === 'avatar');

    if (!avatarFile) {
      throw Fail.badRequest('Avatar file is required');
    }

    // Валидация типа файла
    if (!avatarFile.mime.startsWith('image/')) {
      throw Fail.badRequest('Only images are allowed');
    }

    // Валидация размера файла
    if (avatarFile.size && avatarFile.size > MAX_AVATAR_SIZE) {
      throw Fail.badRequest(`File too large (max ${MAX_AVATAR_SIZE / 1_000_000}MB)`);
    }

    // Сохраняем файл (мок - просто сохраняем путь в памяти)
    const avatarUrl = `/uploads/${id}/${avatarFile.filename}`;

    const user = await this.userService.updateAvatar(id, avatarUrl);

    if (!user) {
      throw Fail.notFound('User not found');
    }

    return new Ok(user);
  }
}

