import { from, makeConfig, secret } from '@nestling/config';
import { z } from 'zod';

/**
 * Секция конфига приложения.
 *
 * Объявление — значение: регистрировать его не нужно. Секция попадает в
 * граф, когда кто-то её инжектит. Ключи выводятся из префикса
 * (`logLevel` читается из `APP_LOG_LEVEL`); `from('DATABASE_URL', …)`
 * задаёт точное имя ключа.
 *
 * `secret()` помечает поле: печать секции (`console.log`,
 * `JSON.stringify`) и текст ошибки валидации показывают `'***'` вместо
 * значения. Чтение поля отдаёт настоящее значение.
 *
 * Без `.default(...)` и без переменной окружения приложение не поднимется:
 * невалидный конфиг останавливает старт.
 */
export const AppConfig = makeConfig('app', {
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  databaseUrl: secret(
    from('DATABASE_URL', z.url().default('postgresql://localhost:5432/myapp')),
  ),
});

/**
 * Право привязать источник к ключам секции. Через `.keys` инжектировать
 * секцию нельзя, поэтому его можно экспортировать.
 */
export const appConfigKeys = AppConfig.keys;
