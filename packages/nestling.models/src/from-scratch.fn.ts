import type { z } from 'zod';

export function fromScratch() {
  return {
    makeModel: <S extends z.ZodTypeAny>(schema: S) => {
      return schema;
    },
  };
}

export function makeModel<S extends z.ZodTypeAny>(schema: S) {
  return schema;
}
