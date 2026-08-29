import { withTiming } from '../common/middleware';

import { makePipeline, validate } from '@nestling/pipeline';
import { httpEndpoint, query } from '@nestling/transport.http';
import z from 'zod';

// GET /users - поиск: по канону поля метода без тела приходят из query
const SearchUsersInput = z.object({
  q: z.string().min(1),

  // Повтор ключа (?tag=a&tag=b) и так дал бы массив; пометка `multiple`
  // делает его массивом и при одном вхождении — иначе `?tag=a` был бы
  // скаляром и не прошёл бы `z.array(...)`
  tag: z.array(z.string()).optional(),

  // Query-параметры — всегда строки: коерсия — забота схемы, не транспорта
  limit: z.coerce.number().int().positive().optional(),
});

const SearchUsersOutput = z.object({
  query: z.string(),
  tags: z.array(z.string()),
  limit: z.number(),
});

type SearchUsersInput = z.infer<typeof SearchUsersInput>;
type SearchUsersOutput = z.infer<typeof SearchUsersOutput>;

export const SearchUsers = httpEndpoint({
  method: 'GET',
  path: '/users',
  input: SearchUsersInput,
  output: SearchUsersOutput,
  bind: { tag: query({ multiple: true }) },
  pipeline: makePipeline().pre(withTiming).pre(validate()),
  handle: async (input: SearchUsersInput): Promise<SearchUsersOutput> => ({
    query: input.q,
    tags: input.tag ?? [],
    limit: input.limit ?? 20,
  }),
});
