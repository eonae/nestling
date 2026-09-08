/**
 * Типовые тесты интерфейса хендлера операции.
 *
 * Файл не гоняется jest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на сборке пакета. Негативные случаи закрыты `@ts-expect-error`:
 * исчезни ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { makePipeline, Ok } from '../pipeline/index.js';

import type { Handler as HandlerOf, HandlerMeta } from './handler.js';
import { Handler } from './handler.js';
import { implement } from './implement.js';

import { makeFail, makeRequest } from '@nestling/operations';
import { z } from 'zod';

const CardDeclined = makeFail('payment_required:handler_card_declined', {
  message: 'Card declined',
});

const ChargeCard = makeRequest({
  name: 'handler.billing.charge',
  input: z.object({ amount: z.number() }),
  output: z.object({ chargeId: z.string() }),
  errors: [CardDeclined],
});

/** Один импорт даёт и декоратор роли, и интерфейс */
@Handler([])
class ChargeCardHandler implements HandlerOf<typeof ChargeCard> {
  async handle(input: { amount: number }, meta: HandlerMeta) {
    return meta.signal.aborted
      ? CardDeclined()
      : new Ok({ chargeId: `ch_${input.amount}` });
  }
}

const Charge = implement(ChargeCard, { handler: ChargeCardHandler });

/** Расхождение с операцией ловится в классе, до декларации */
class WrongOutputHandler implements HandlerOf<typeof ChargeCard> {
  // @ts-expect-error результат другой формы: `chargeId` объявлен операцией
  async handle(input: { amount: number }) {
    return new Ok({ unexpected: input.amount });
  }
}

/** Незадекларированный отказ — то же расхождение */
class UndeclaredFailHandler implements HandlerOf<typeof ChargeCard> {
  // @ts-expect-error `not_found` в `errors:` операции не объявлен
  async handle() {
    return NotFound();
  }
}

const NotFound = makeFail('not_found:handler_charge', { message: 'No charge' });

/** Пайплайн без требований к стартовому контексту в `implement` проходит */
const neutral = implement(ChargeCard, {
  pipeline: makePipeline().pre(() => ({ tenant: 'acme' })),
  handler: async (input, meta: HandlerMeta) =>
    new Ok({ chargeId: `${String(meta.tenant)}:${input.amount}` }),
});

/** Пайплайн, требующий полей транспорта, в `implement` не компилируется */
const withStart = implement(ChargeCard, {
  // @ts-expect-error { __error; missing: { http: … }; hint }
  pipeline: makePipeline<{ http: { url: string } }>(),
  handler: async () => new Ok({ chargeId: 'ch_1' }),
});
