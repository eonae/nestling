import { authed } from './auth.js';
import { observability } from './observability.js';
import { ops } from './ops.plugin.js';
import { UsersFeature } from './users.feature.js';

import { everyEndpoint, makeApp, RequestId } from '@nestling/app';
import { openapi } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';
import { http, HttpTransport$ } from '@nestling/transport.http';

/**
 * Декларация приложения: одно значение для `main.ts` и для тестов.
 *
 * Политики проверяются на собранном графе до фазы INIT и до открытия
 * сокета. Слой сравнивается по ссылке.
 */
export const app = makeApp({
  features: [UsersFeature],
  plugins: [
    ops,
    // Документ строится на фазе ASSEMBLE из тех же деклараций, которые
    // обслуживают запросы. Схема без конвертера роняет старт
    openapi({
      info: { title: 'Users API', version: '1.0.0' },
      converters: [zodConverter()],
      pipeline: observability,
    }),
  ],
  // Сокетом владеет сервер: `http()` объявляет его сам, а порт и хост
  // сервер читает из своей секции — `HTTP_PORT`, `HTTP_HOST`
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
    // Хранилище читает `requestId` из контекста запроса. Политика требует,
    // чтобы пайплайн эту переменную объявлял: иначе чтение вернуло бы
    // `undefined` на том маршруте, где слой забыли подключить
    everyEndpoint({ transport: HttpTransport$('default') }).hasVar(
      RequestId,
      'requestId',
    ),
  ],
});
