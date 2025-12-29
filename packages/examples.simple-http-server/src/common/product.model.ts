import z from 'zod';

export const Product = z.object({
  id: z.number().int().positive().describe('Product ID'),
  name: z.string().min(1).max(100).describe('Product name'),
  price: z.number().min(0).max(1_000_000).describe('Product price'),
});
