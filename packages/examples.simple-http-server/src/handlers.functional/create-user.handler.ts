import { defineHandler } from '@nestling/transport';
import z from 'zod';

// POST /users/schema - создание пользователя со схемой
const CreateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.email(),
  address: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
  }),
});

const CreateUserResponseSchema = z.object({
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

export const CreateUser = defineHandler({
  transport: 'http',
  method: 'POST',
  path: '/users',
  payloadSchema: CreateUserSchema,
  responseSchema: CreateUserResponseSchema,
  handler: async (payload) => {
    // payload: { name: string; email: string; address: { street: string; city: string } }
    // Типы выводятся автоматически из CreateUserSchema!
    return {
      status: 201,
      value: {
        message: 'User created',
        user: {
          id: Math.floor(Math.random() * 1000),
          ...payload,
        },
      },
      meta: {},
    };
  },
});
