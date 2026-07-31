import { from, makeConfig } from '@nestling/config';
import { z } from 'zod';

/**
 * Секция конфигурации приложения.
 *
 * Объявление — значение: ни декоратора, ни регистрации в `providers`,
 * ни ключа `configs:` у модуля. Секция появится в графе ровно тогда,
 * когда кто-то её инжектнет.
 *
 * Ключи выводятся из префикса (`logLevel` → `APP_LOG_LEVEL`);
 * `from('DATABASE_URL', …)` задаёт точное имя — так объявляют ключ,
 * который читает не только это приложение.
 *
 * Уберите `.default(...)` у `DATABASE_URL` и запустите без переменной
 * окружения — приложение не поднимется: невалидный конфиг на старте
 * это fail-fast, а не «undefined где-то в рантайме».
 */
export const AppConfig = makeConfig('app', {
  databaseUrl: from(
    'DATABASE_URL',
    z.url().default('postgresql://localhost:5432/myapp'),
  ),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/**
 * Право **привязки** — единственное, что уезжает из этой папки наружу
 * (см. `./index.ts`). Хэндлом нечего инжектить, поэтому его экспорт
 * безопасен; сам токен секции наружу не отдаётся.
 */
export const appConfigKeys = AppConfig.keys;
