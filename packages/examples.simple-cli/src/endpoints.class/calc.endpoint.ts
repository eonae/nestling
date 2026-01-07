/* eslint-disable no-console */

import { makeModel } from '@nestling/models';
import type { ResponseContext } from '@nestling/pipeline';
import { Endpoint } from '@nestling/pipeline';
import { z } from 'zod';

// Схема для калькулятора со строгой типизацией
const CalcPayload = makeModel(
  z.object({
    a: z.number().describe('Первое число'),
    b: z.number().describe('Второе число'),
    operation: z
      .enum(['add', 'sub', 'mul', 'div', '+', '-', '*', '/'])
      .describe('Операция: add/sub/mul/div или +/-/*//'),
  }),
);

const CalcResponse = z.object({
  a: z.number(),
  b: z.number(),
  operation: z.string(),
  result: z.number(),
});

const CalcErrorResponse = z.object({
  error: z.string(),
});

type CalcPayload = z.infer<typeof CalcPayload>;
type CalcResponse = z.infer<typeof CalcResponse>;
type CalcErrorResponse = z.infer<typeof CalcErrorResponse>;

@Endpoint({
  transport: 'cli',
  pattern: 'calc-schema',
  input: CalcPayload,
  output: z.union([CalcResponse, CalcErrorResponse]),
})
export class CalcEndpoint {
  async handle(
    payload: CalcPayload,
  ): Promise<ResponseContext<CalcResponse | CalcErrorResponse>> {
    // Преобразуем CLI input в формат для схемы
    const input = {
      a: payload.a,
      b: payload.b,
      operation: payload.operation,
    };

    // Валидируем через схему
    const validated = CalcPayload.parse(input);
    const { a: validatedA, b: validatedB, operation: validatedOp } = validated;

    // input строго типизирован после валидации!
    let result: number;
    let op: string;

    switch (validatedOp) {
      case 'add':
      case '+': {
        result = validatedA + validatedB;
        op = '+';
        break;
      }
      case 'sub':
      case '-': {
        result = validatedA - validatedB;
        op = '-';
        break;
      }
      case 'mul':
      case '*': {
        result = validatedA * validatedB;
        op = '*';
        break;
      }
      case 'div':
      case '/': {
        if (validatedB === 0) {
          console.error('Error: Division by zero');
          return {
            status: 'BAD_REQUEST',
            value: { error: 'Division by zero' },
          };
        }
        result = validatedA / validatedB;
        op = '/';
        break;
      }
      default: {
        console.error('Error: Unknown operation');
        return {
          status: 'BAD_REQUEST',
          value: { error: 'Unknown operation' },
        };
      }
    }

    console.log(`Result: ${validatedA} ${op} ${validatedB} = ${result}`);

    return {
      status: 'OK',
      value: { a: validatedA, b: validatedB, operation: op, result },
    };
  }
}
