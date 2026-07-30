import { withTiming } from '../common/middleware';
import { EmailTaken } from '../errors';

import type { Output } from '@nestling/pipeline';
import { makePipeline, validate } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import z from 'zod';

// POST /users - создание пользователя со схемой
const CreateUserInput = z.object({
  name: z.string().min(1).max(100),
  email: z.email(),
  address: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
  }),
});

const CreateUserOutput = z.object({
  message: z.string(),
  user: z.object({
    id: z.number(),
    name: z.string(),
    email: z.string(),
    address: z.object({
      street: z.string(),
      city: z.string(),
    }),
  }),
});

type CreateUserInput = z.infer<typeof CreateUserInput>;
type CreateUserOutput = z.infer<typeof CreateUserOutput>;

/** Заглушка «уже занятых» адресов вместо базы */
const taken = new Set(['taken@example.com']);

export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/users',
  input: CreateUserInput,
  output: CreateUserOutput,
  errors: [EmailTaken],
  pipeline: makePipeline().pre(withTiming).pre(validate()),
  handle: async (
    input: CreateUserInput,
  ): Output<CreateUserOutput, ReturnType<typeof EmailTaken>> => {
    // input типизирован после validate()

    // Отказ возвращается значением: рантайм трактует возврат так же, как
    // бросок, и клиент получает 409 с кодом `EMAIL_TAKEN`
    if (taken.has(input.email)) {
      return EmailTaken({ email: input.email });
    }

    return {
      message: 'User created',
      user: {
        id: Math.floor(Math.random() * 1000),
        ...input,
      },
    };
  },
});
