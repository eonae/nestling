import { from, makeConfig, secret } from '@nestling/config';
import { z } from 'zod';

/**
 * Секция конфига приложения.
 *
 * Ключ выводится из префикса и имени поля (`APP_PAGE_SIZE`) или задаётся
 * точно через `from()`. `secret()` скрывает значение в печати секции и в
 * тексте ошибок. Поля без умолчания обязательны: без них приложение не
 * стартует.
 */
export const AppConfig = makeConfig('app', {
  pageSize: z.coerce.number().int().positive().default(20),
  databaseUrl: secret(
    from('DATABASE_URL', z.url().default('postgresql://localhost:5432/users')),
  ),
  apiToken: secret(from('API_TOKEN', z.string().min(1))),
  webhookSecret: secret(from('WEBHOOK_SECRET', z.string().min(1))),
});

/** Право привязать источник к ключам секции; читать значения оно не даёт */
export const appConfigKeys = AppConfig.keys;
