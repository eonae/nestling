import { from, makeConfig, secret } from '@nestling/config';
import { z } from 'zod';

/**
 * Секция конфига приложения.
 *
 * Имя ключа выводится из префикса секции и имени поля: `pageSize`
 * читается из `APP_PAGE_SIZE`. `from()` задаёт точное имя ключа.
 * `secret()` скрывает значение в печати секции и в тексте ошибок.
 *
 * Значение без умолчания обязательно: без `API_TOKEN` приложение не
 * стартует.
 */
export const AppConfig = makeConfig('app', {
  pageSize: z.coerce.number().int().positive().default(20),
  databaseUrl: secret(
    from('DATABASE_URL', z.url().default('postgresql://localhost:5432/users')),
  ),
  apiToken: secret(from('API_TOKEN', z.string().min(1))),
});
