import { from, makeConfig, secret } from '@nestling/app';
import { z } from 'zod';

/**
 * Секция конфига приложения.
 *
 * Объявление — значение: регистрировать его не нужно. Секция попадает в
 * граф, когда кто-то её инжектит. Ключи выводятся из префикса
 * (`metricsPrefix` читается из `APP_METRICS_PREFIX`); `from('DATABASE_URL', …)`
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
  metricsPrefix: z.string().min(1).default('app'),
  databaseUrl: secret(
    from('DATABASE_URL', z.url().default('postgresql://localhost:5432/myapp')),
  ),
});

/**
 * Право привязать источник к ключам секции. Через `.keys` инжектировать
 * секцию нельзя, поэтому его можно экспортировать.
 */
export const appConfigKeys = AppConfig.keys;
