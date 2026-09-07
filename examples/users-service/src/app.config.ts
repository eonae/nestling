import { from, makeConfig, secret } from '@nestling/app';
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
 * Третий аргумент объявляет вычисляемые поля. `databaseHost` собран из
 * адреса базы, ключа у него нет, и в `.keys` он не входит. Адрес помечен
 * `secret()`, поэтому хост унаследовал секретность: печать секции покажет
 * вместо него маску, а чтение поля отдаёт настоящее значение.
 */
export const AppConfig = makeConfig(
  'app',
  {
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .default(20)
      .describe('Размер страницы списка пользователей'),
    databaseUrl: secret(
      from(
        'DATABASE_URL',
        z
          .url()
          .default('postgresql://localhost:5432/users')
          .describe('Адрес базы данных'),
      ),
    ),
    apiToken: secret(
      from(
        'API_TOKEN',
        z.string().min(1).describe('Bearer-токен для запросов, меняющих данные'),
      ),
    ),
  },
  (derived) => ({
    databaseHost: derived(['databaseUrl'], (url) => new URL(url).host),
  }),
);
