import { from, makeConfig } from '@nestling/config';
import { z } from 'zod';

/**
 * Секция здоровья: второй читатель ключа `DATABASE_URL`.
 *
 * Схема и значение по умолчанию свои: каждая секция проверяет сырое
 * значение независимо. `secret()` здесь не нужен: ключ уже пометила
 * секция `app`, а секретность ключа общая для всех его читателей.
 */
export const HealthConfig = makeConfig('health', {
  databaseUrl: from(
    'DATABASE_URL',
    z.string().default('postgresql://localhost:5432/myapp'),
  ),
});
