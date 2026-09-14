import { from, makeConfig, secret } from '@nestlingjs/app';
import { z } from 'zod';

/**
 * Секция конфига приложения.
 *
 * Имя ключа выводится из префикса секции и имени поля: `pageSize`
 * читается из `APP_PAGE_SIZE`. `from()` задаёт точное имя ключа.
 * `secret()` скрывает значение в печати секции и в тексте ошибок.
 * `.describe()` — описание поля средствами схемы: его читает человек в
 * коде и таблица переменных в документации, фреймворк его не трогает.
 *
 * Значение без умолчания обязательно: без `API_TOKEN` приложение не
 * стартует.
 *
 * Адреса базы здесь нет: секцию соединения объявляет
 * `@nestlingjs/drizzle.pg`, и приложение читает её ключи через
 * `db.keys`.
 */
export const AppConfig = makeConfig('app', {
  buildVersion: from(
    'BUILD_VERSION',
    z
      .string()
      .min(1)
      .default('dev')
      .describe('Версия сборки, которую отдаёт служебный endpoint'),
  ),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .default(20)
    .describe('Размер страницы списка пользователей'),
  apiToken: secret(
    from(
      'API_TOKEN',
      z.string().min(1).describe('Bearer-токен для запросов, меняющих данные'),
    ),
  ),
  webhookSecret: secret(
    from(
      'WEBHOOK_SECRET',
      z.string().min(1).describe('Секрет HMAC-подписи тела webhook\'а'),
    ),
  ),
});

/** Право привязать источник к ключам секции; читать значения оно не даёт */
export const appConfigKeys = AppConfig.keys;
