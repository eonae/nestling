import { from, makeConfig, secret } from '@nestling/config';
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
 * который читает не только это приложение: второй его читатель —
 * секция `health` (см. `../health/health.config`).
 *
 * `secret()` снаружи, `from()` внутри — порядок единственный: секретность
 * есть свойство **поля**, `from()` лишь называет его **ключ**. Для
 * потребителя не меняется ничего (`config.databaseUrl` — та же строка);
 * меняется то, что печатает фреймворк: `console.log(cfg)` и
 * `JSON.stringify(cfg)` отдают `'***'`, а сообщение
 * `ConfigValidationError` — `<redacted>` вместо текста валидатора.
 * Секретность ключа при этом действует и на **чужую** секцию, читающую
 * тот же `DATABASE_URL`, — она считается объединением по всем читателям.
 *
 * Уберите `.default(...)` у `DATABASE_URL` и запустите без переменной
 * окружения — приложение не поднимется: невалидный конфиг на старте
 * это fail-fast, а не «undefined где-то в рантайме».
 */
export const AppConfig = makeConfig('app', {
  databaseUrl: secret(
    from('DATABASE_URL', z.url().default('postgresql://localhost:5432/myapp')),
  ),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/**
 * Наружу из этой папки экспортируется только право привязки — `.keys`
 * (см. `./index.ts`). Через `.keys` нельзя инжектировать секцию, поэтому
 * его экспорт безопасен; сам токен секции наружу не отдаётся.
 */
export const appConfigKeys = AppConfig.keys;
