import type { z } from 'zod';

export function fromScratch() {
  return {
    defineModel: <S extends z.ZodTypeAny>(schema: S) => {
      return schema;
    },
  };
}
