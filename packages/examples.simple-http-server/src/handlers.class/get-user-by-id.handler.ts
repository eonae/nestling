import type { ResponseContext } from '@nestling/pipeline';
import { Handler } from '@nestling/pipeline';
import z from 'zod';

// Схемы для GetUserById
const GetUserByIdPayload = z.object({
  id: z
    .string()
    .transform((val: string) => Number.parseInt(val, 10))
    .describe('ID пользователя из path параметра'),
  include: z
    .enum(['profile', 'posts', 'comments'])
    .optional()
    .describe('Дополнительные данные для включения'),
});

const GetUserByIdMetadata = z.object({
  authorization: z
    .string()
    .optional()
    .describe('Optional Bearer token из заголовка Authorization'),
});

const GetUserByIdResponse = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  profile: z
    .object({
      bio: z.string(),
    })
    .optional(),
  posts: z
    .array(
      z.object({
        id: z.number(),
        title: z.string(),
      }),
    )
    .optional(),
});

type GetUserByIdMetadata = z.infer<typeof GetUserByIdMetadata>;
type GetUserByIdPayload = z.infer<typeof GetUserByIdPayload>;
type GetUserByIdResponse = z.infer<typeof GetUserByIdResponse>;

/**
 * Handler-класс с ПОЛНОЙ проверкой типов через декоратор @Handler
 *
 * ПРЕИМУЩЕСТВА:
 * - TypeScript РЕАЛЬНО проверяет типы параметров handle()
 * - Типы выводятся АВТОМАТИЧЕСКИ из схем
 * - Нельзя ошибиться в типах - получишь ошибку компиляции!
 * - Изолированная логика handler'а в отдельном классе
 * - Один класс = один endpoint (Single Responsibility)
 */
@Handler({
  transport: 'http',
  pattern: 'GET /api/users/:id',
  payloadSchema: GetUserByIdPayload,
  metadataSchema: GetUserByIdMetadata,
  responseSchema: GetUserByIdResponse,
})
export class GetUserByIdHandler {
  async handle(
    payload: GetUserByIdPayload,
    metadata: GetUserByIdMetadata,
  ): Promise<ResponseContext<GetUserByIdResponse>> {
    // payload и metadata - типы проверяются компилятором!
    const user = {
      id: payload.id,
      name: `User ${payload.id}`,
      email: `user${payload.id}@example.com`,
      ...(payload.include === 'profile' && {
        profile: { bio: `Bio for user ${payload.id}` },
      }),
      ...(payload.include === 'posts' && {
        posts: [
          { id: 1, title: `Post 1 by user ${payload.id}` },
          { id: 2, title: `Post 2 by user ${payload.id}` },
        ],
      }),
    };

    return {
      status: 200,
      value: user,
      meta: {
        authenticated: !!metadata.authorization,
      },
    };
  }
}
