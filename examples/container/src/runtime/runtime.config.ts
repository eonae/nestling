import { makeConfig } from '@nestling/app';
import { z } from 'zod';

/**
 * Секция, значения которой обновляются без перезапуска.
 *
 * Чтение поля отдаёт последнее валидное значение. Подписка на обновления
 * — `onChange(signal, callback)`; её снимает взведённый `signal`.
 */
export const RuntimeConfig = makeConfig.reloadable('runtime', {
  rps: z.coerce.number().int().positive().default(100),
});

export const runtimeConfigKeys = RuntimeConfig.keys;
