import type { EmptyInput } from '../core';
import { describeForm, isPrimitiveLeaf, ValidationFailed } from '../core';
import type { PreUnitFn } from '../core/types';
import { SchemaValidationError, validateSync } from '../schema';

import type { Schema } from '@common/misc';

/**
 * Валидирует raw.payload и создаёт payload
 *
 * Работает только с формой значения (`kind: 'value'`) и схемой-листом:
 * потоковые формы валидируются поэлементно обёртками форм
 * (`bindInputStream`), `multipart` — транспортом при разборе, примитивы —
 * это байты, схемы у них нет.
 *
 * При ошибке валидации бросает kernel-отказ `ValidationFailed`
 * (`VALIDATION_FAILED`, HTTP 400). Kernel-код входит в контракт любой
 * ручки неявно: страж границы пропускает его без объявления в `errors:` —
 * иначе штатный 400 валидации превращался бы в 500.
 *
 * Ошибки конфигурации приложения — async-схема
 * (`AsyncSchemaNotSupportedError`) и объект-не-схема
 * (`NotAStandardSchemaError`) — пробрасываются наружу как есть: это не
 * ошибка входа, и 400 их бы замаскировал.
 *
 * @example
 * ```typescript
 * const pipeline = makePipeline()
 *   .pre(validate());
 * ```
 */
export function validate(): PreUnitFn<
  EmptyInput,
  { payload: unknown | undefined }
> {
  return async (ctx) => {
    const form = describeForm(ctx.endpoint.input);

    if (
      form.kind !== 'value' ||
      form.leaf === undefined ||
      isPrimitiveLeaf(form.leaf)
    ) {
      return;
    }

    try {
      const payload = validateSync(
        form.leaf as Schema,
        ctx.raw.payload,
        'Validation failed',
      );

      return {
        payload,
      };
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        throw ValidationFailed(error.issues, { cause: error });
      }

      throw error;
    }
  };
}
