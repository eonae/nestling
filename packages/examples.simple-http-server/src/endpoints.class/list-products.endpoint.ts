import { Product } from '../common';

import type { Output } from '@nestling/pipeline';
import { HttpEndpoint } from '@nestling/transport.http';
import z from 'zod';

// Схемы для ListProducts
export const ListProductsOutput = z
  .object({
    products: z
      .array(Product.describe('Single Product'))
      .describe('List of products'),
  })
  .describe('Product list response');

type ListProductsOutput = z.infer<typeof ListProductsOutput>;

@HttpEndpoint('GET', '/products', {
  output: ListProductsOutput,
})
export class ListProductsEndpoint {
  async handle(): Output<ListProductsOutput> {
    return {
      products: [
        { id: 1, name: 'Laptop', price: 1000 },
        { id: 2, name: 'Mouse', price: 25 },
        { id: 3, name: 'Keyboard', price: 75 },
      ],
    };
  }
}
