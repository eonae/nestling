/**
 * Писатель переменной `IdempotencyKey` для слоя приёма.
 *
 * Берёт ключ из конверта сообщения и роняет обработку, если ключа там
 * нет. Штатный писатель ядра `withIdempotencyKey()` в слое не участвует:
 * он чеканит недостающий ключ сам, а отчеканенный ключ различается у двух
 * доставок одного сообщения.
 */

import { InboxKeyMissingError } from './errors.js';

import type { EmptyInput, PreUnitFn } from '@nestlingjs/app';
import { IDEMPOTENCY_KEY_ATTRIBUTE, IdempotencyKey } from '@nestlingjs/app';

/**
 * Кладёт ключ идемпотентности из транспортных атрибутов в контекст.
 *
 * Хендлер читает его привычным `meta.idempotencyKey`, а политики
 * `hasVar(IdempotencyKey)` продолжают работать: переменная та же, что у
 * ядра.
 *
 * @throws {InboxKeyMissingError} В конверте сообщения ключа нет
 */
export function readIdempotencyKey(): PreUnitFn<
  EmptyInput,
  { idempotencyKey: string }
> {
  return IdempotencyKey.provide((ctx) => {
    const key = ctx.raw.attributes[IDEMPOTENCY_KEY_ATTRIBUTE];

    if (typeof key !== 'string' || key.length === 0) {
      throw new InboxKeyMissingError(
        ctx.raw.pattern,
        IDEMPOTENCY_KEY_ATTRIBUTE,
      );
    }

    return key;
  });
}
