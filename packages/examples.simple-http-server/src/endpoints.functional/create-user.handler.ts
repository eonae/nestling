import { makeEndpoint } from '@nestling/pipeline';
import z from 'zod';

// POST /users/schema - создание пользователя со схемой
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

export const CreateUser = makeEndpoint({
  transport: 'http',
  pattern: 'POST /users',
  input: CreateUserInput,
  output: CreateUserOutput,
  handle: async (payload) => {
    // payload: { name: string; email: string; address: { street: string; city: string } }
    // Типы выводятся автоматически из CreateUserPayload!
    return {
      status: 'CREATED',
      value: {
        message: 'User created',
        user: {
          id: Math.floor(Math.random() * 1000),
          ...payload,
        },
      },
    };
  },
});
