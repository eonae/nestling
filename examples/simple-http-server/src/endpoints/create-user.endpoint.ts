import { EmailTaken } from '../errors.js';

import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const CreateUserInput = z.object({
  name: z.string().min(1).max(100),
  email: z.email(),
});

const CreateUserOutput = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
});

type CreateUserInput = z.infer<typeof CreateUserInput>;
type CreateUserOutput = z.infer<typeof CreateUserOutput>;

/** Занятые адреса; в примере вместо базы */
const taken = new Set(['taken@example.com']);

/**
 * `POST /users`: вход проверяется схемой до вызова хендлера, отказ
 * возвращается значением.
 */
export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/users',
  input: CreateUserInput,
  output: CreateUserOutput,
  errors: [EmailTaken],
  handler: async (
    input: CreateUserInput,
  ): Output<CreateUserOutput, typeof EmailTaken> => {
    if (taken.has(input.email)) {
      return EmailTaken({ email: input.email });
    }

    return { id: Math.floor(Math.random() * 1000), ...input };
  },
});
