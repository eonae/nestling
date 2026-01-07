import { Product } from '../common';

import { Endpoint } from '@nestling/pipeline';
import z from 'zod';

// Схемы для ListProducts
export const ListProductsOutput = z
  .object({
    products: z
      .array(Product.describe('Single Product'))
      .describe('List of products'),
  })
  .describe('Product list response');

@Endpoint({
  transport: 'http',
  pattern: 'GET /products',
  output: ListProductsOutput,
})
export class ListProductsEndpoint {
  async handle() {
    return {
      status: 200,
      value: {
        products: [
          { id: 1, name: 'Laptop', price: 1000 },
          { id: 2, name: 'Mouse', price: 25 },
          { id: 3, name: 'Keyboard', price: 75 },
        ],
      },
      meta: {},
    };
  }
}
