import { MAX_AVATAR_SIZE } from '../../../common/constants';
import { basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger';
import { ILogger } from '../../logger';
import { InvalidAvatar, UserNotFound } from '../user.errors';
import { UserService } from '../user.service';

import { Injectable } from '@nestling/container';
import type { FilePart, Output } from '@nestling/pipeline';
import { multipart, Ok, upload } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const UploadAvatarFields = z.object({
  id: z.string(), // userId из path-параметра — подмешивается к полям формы
});

const UploadAvatarOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().optional(),
});

type UploadAvatarFields = z.infer<typeof UploadAvatarFields>;
type UploadAvatarOutput = z.infer<typeof UploadAvatarOutput>;

@Injectable([UserService, ILogger])
export class UploadAvatarHandler {
  constructor(
    private readonly users: UserService,
    private readonly logger: ILoggerService,
  ) {}

  async handle(payload: {
    fields: UploadAvatarFields;
    files: { avatar: FilePart };
  }): Output<
    UploadAvatarOutput,
    ReturnType<typeof InvalidAvatar> | ReturnType<typeof UserNotFound>
  > {
    const { fields, files } = payload;
    this.logger.log(`Handling POST /api/users/${fields.id}/avatar`);

    // Тип и размер файла проверил транспорт по `upload({ maxSize, mime })`:
    // endpoint'у остаётся только домен. Отсутствие поля — единственное, что
    // форма не гарантирует.
    if (!files.avatar) {
      throw InvalidAvatar({ reason: 'file is required' });
    }

    // Сохраняем файл: это мок, путь только хранится в памяти, не на диске
    const avatarUrl = `/uploads/${fields.id}/${files.avatar.filename}`;

    const user = await this.users.updateAvatar(fields.id, avatarUrl);

    if (!user) {
      throw UserNotFound({ id: fields.id });
    }

    return new Ok(user);
  }
}

/**
 * Endpoint для загрузки аватара пользователя.
 *
 * Демонстрирует форму `multipart({ fields, files })` с типизированным
 * файловым полем, лимит и MIME-фильтр на самом поле (`upload`), которые
 * применяются во время разбора — файл не буферизуется целиком, чтобы потом
 * быть отвергнутым, и объявленные отказы для доменных проверок.
 */
export const UploadAvatar = httpEndpoint({
  method: 'POST',
  path: '/api/users/:id/avatar',
  input: multipart({
    fields: UploadAvatarFields,
    files: {
      avatar: upload({
        maxSize: MAX_AVATAR_SIZE,
        mime: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
      }),
    },
  }),
  output: UploadAvatarOutput,
  errors: [InvalidAvatar, UserNotFound],
  pipeline: basePipeline,
  handle: UploadAvatarHandler,
});
