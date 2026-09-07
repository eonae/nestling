import { UserCreated } from './users/users.events.js';
import { authed } from './auth.js';
import { observability } from './observability.js';
import { ops } from './ops.plugin.js';
import { OutboxStore$, persistence, Tx } from './persistence.js';
import { UsersFeature } from './users.feature.js';

import { everyEndpoint, makeApp, RequestId } from '@nestling/app';
import { openapi } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';
import { outbox } from '@nestling/outbox';
import { http, HttpTransport$ } from '@nestling/transport.http';

/**
 * Транзакционный emit: событие уходит в шину после коммита.
 *
 * Плагин создаётся один раз: рецепт семейства регистрируется однажды.
 * Раздел — идентификатор пользователя: события одного пользователя
 * доставляются в порядке создания.
 */
export const appOutbox = outbox({
  transaction: Tx,
  store: OutboxStore$,
  operations: [UserCreated],
  partitionKey: (payload) => (payload as { id: string }).id,
});

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
    persistence,
    appOutbox,
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
    // Каждый endpoint, который меняет данные, проверяет Bearer-токен
    everyEndpoint({ pattern: /^(POST|PATCH|DELETE) / }).hasLayer(
      authed,
      'authed',
    ),
    // Тот же endpoint обязан быть в транзакции: без неё транзакционный
    // emit падал бы на первом запросе, а не на сборке
    appOutbox.requiresTransaction({ pattern: /^(POST|PATCH|DELETE) / }),
    // Хранилище читает `requestId` из контекста запроса. Политика требует,
    // чтобы пайплайн эту переменную объявлял: иначе чтение вернуло бы
    // `undefined` на том маршруте, где слой забыли подключить
    everyEndpoint({ transport: HttpTransport$('default') }).hasVar(
      RequestId,
      'requestId',
    ),
  ],
});
