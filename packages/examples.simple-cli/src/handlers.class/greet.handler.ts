/* eslint-disable no-console */
import { fromScratch } from '@nestling/models';
import type { ResponseContext } from '@nestling/pipeline';
import { Handler } from '@nestling/pipeline';
import { z } from 'zod';

// Схема для команды greet
const GreetPayload = fromScratch().makeModel(
  z.object({
    name: z.string().min(1).max(50).describe('Имя для приветствия'),
    enthusiastic: z.boolean().optional().describe('Энтузиастичное приветствие'),
  }),
);

const GreetResponse = z.object({
  greeting: z.string(),
});

type GreetPayload = z.infer<typeof GreetPayload>;
type GreetResponse = z.infer<typeof GreetResponse>;

/**
 * Handler-класс для команды greet-schema - приветствие со схемой
 */
@Handler({
  transport: 'cli',
  pattern: 'greet-schema',
  payloadSchema: GreetPayload,
  responseSchema: GreetResponse,
})
export class GreetHandler {
  async handle(payload: GreetPayload): Promise<ResponseContext<GreetResponse>> {
    // payload уже валидирован через схему и строго типизирован!
    const { name, enthusiastic = false } = payload;

    const greeting = enthusiastic ? `Hello, ${name}!!!` : `Hello, ${name}!`;

    console.log(greeting);

    return {
      status: 0,
      value: { greeting },
      meta: {},
    };
  }
}
