import { authed } from './auth';
import { observability } from './observability';
import { UsersFeature } from './users.feature';

import { openapi } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';
import { everyEndpoint } from '@nestling/pipeline';
import { http, HttpTransport$ } from '@nestling/transport.http';

/**
 * Словарь сборки: одно значение для `main.ts` и для тестов.
 *
 * Политики проверяются на собранном графе до `@OnInit` и до открытия
 * сокета. Слой сравнивается по ссылке.
 */
export const appSpec = {
  features: [UsersFeature],
  plugins: [
    // Документ строится на фазе ASSEMBLE из тех же деклараций, которые
    // обслуживают запросы. Схема без конвертера роняет старт
    openapi({
      info: { title: 'Users API', version: '1.0.0' },
      converters: [zodConverter()],
      pipeline: observability,
    }),
  ],
  // Порт и хост приходят из секции транспорта: `HTTP_PORT`, `HTTP_HOST`
  transports: [http()],
  policies: [
    // У каждого HTTP-endpoint'а есть слой наблюдаемости
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
      observability,
      'observability',
    ),
    // Каждый endpoint, который меняет данные, проверяет токен
    everyEndpoint({ pattern: /^(POST|PATCH|DELETE) / }).hasLayer(
      authed,
      'authed',
    ),
  ],
};
