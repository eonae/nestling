import { withTiming } from '../common/middleware';

import { makeEndpoint, makePipeline, validate } from '@nestling/pipeline';
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

export const CreateUser = makeEndpoint({
  transport: 'http',
  pattern: 'POST /users',
  input: CreateUserInput,
  output: CreateUserOutput,
  pipeline: makePipeline().pre(withTiming).pre(validate()),
  handle: async (input: CreateUserInput): Promise<CreateUserOutput> => {
    // input типизирован после validate()
    return {
      message: 'User created',
      user: {
        id: Math.floor(Math.random() * 1000),
        ...input,
      },
    };
  },
});
