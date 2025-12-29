import { Product } from '../common';

import { Handler } from '@nestling/transport';
import z from 'zod';

// Схемы для ListProducts
export const ProductListResponse = z
  .object({
    products: z
      .array(Product.describe('Single Product'))
      .describe('List of products'),
  })
  .describe('Product list response');

@Handler({
  transport: 'http',
  method: 'GET',
  path: '/products',
  responseSchema: ProductListResponse,
})
export class ListProducts {
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
