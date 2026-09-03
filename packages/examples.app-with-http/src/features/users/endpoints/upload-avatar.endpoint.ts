import { Unauthorized } from '../../../errors';
import { authed } from '../../../plugins/auth';
import { User } from '../user';
import { AvatarRequired, UserNotFound } from '../users.errors';
import type { UsersRepository } from '../users.repository';
import { UsersRepository$ } from '../users.repository';

import type { FailOf, FilePart } from '@nestling/operations';
import { multipart, upload } from '@nestling/operations';
import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const MiB = 1024 * 1024;

// `id` приходит из path-параметра и подмешивается к полям формы
const AvatarFields = z.object({ id: z.string() });

type AvatarFields = z.infer<typeof AvatarFields>;

export const uploadAvatarHandler =
  (users: UsersRepository) =>
  async (payload: {
    fields: AvatarFields;
    files: { avatar: FilePart };
  }): Output<
    User,
    FailOf<typeof UserNotFound> | FailOf<typeof AvatarRequired>
  > => {
    const { fields, files } = payload;

    // Размер и тип файла проверил транспорт по `upload({ maxSize, mime })`.
    // Наличие поля форма не гарантирует
    if (!files.avatar) {
      return AvatarRequired();
    }

    const avatarUrl = `/uploads/${fields.id}/${files.avatar.filename}`;
    const user = await users.patch(fields.id, { avatarUrl });

    return user ?? UserNotFound({ id: fields.id });
  };

/** Форма `multipart`: поля проверяет схема `fields`, файлы приходят под объявленными именами */
export const UploadAvatar = httpEndpoint({
  method: 'POST',
  path: '/users/:id/avatar',
  input: multipart({
    fields: AvatarFields,
    files: {
      avatar: upload({ maxSize: 2 * MiB, mime: ['image/png', 'image/jpeg'] }),
    },
  }),
  output: User,
  errors: [UserNotFound, AvatarRequired, Unauthorized],
  doc: { summary: 'Загрузить аватар', tags: ['users'] },
  pipeline: authed,
  deps: [UsersRepository$],
  handle: uploadAvatarHandler,
});
