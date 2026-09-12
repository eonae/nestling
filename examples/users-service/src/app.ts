import { UserCreated } from './users/users.events.js';
import { authed } from './auth.js';
import { observability } from './observability.js';
import { ops } from './ops.plugin.js';
import { appInbox, db, inboxStore, outboxStore } from './persistence.js';
import { UsersFeature } from './users.feature.js';

import {
  BusTransport$,
  everyEndpoint,
  makeApp,
  RequestId,
} from '@nestlingjs/app';
import { openapi } from '@nestlingjs/openapi';
import { zodConverter } from '@nestlingjs/openapi.zod';
import { outbox } from '@nestlingjs/outbox';
import { http, HttpTransport$ } from '@nestlingjs/transport.http';

/**
 * Транзакционный emit: событие уходит в шину после коммита.
 *
 * Плагин создаётся один раз: рецепт семейства регистрируется однажды.
 * Раздел записи плагин не назначает — его называет место вызова `emit`.
 */
export const appOutbox = outbox({
  transaction: db.tx,
  store: outboxStore.token,
  operations: [UserCreated],
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
    db,
    outboxStore,
    appOutbox,
    inboxStore,
    appInbox,
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
    // Тот же endpoint обязан быть в транзакции: без неё и запись
    // пользователя, и транзакционный emit падали бы на первом запросе, а
    // не на сборке. Ту же политику под тем же именем переменной отдаёт
    // плагин outbox'а — здесь она объявлена соединением, которому
    // транзакция принадлежит
    db.requiresTransaction({ pattern: /^(POST|PATCH|DELETE) / }),
    // Хранилище читает `requestId` из контекста запроса. Политика требует,
    // чтобы пайплайн эту переменную объявлял: иначе чтение вернуло бы
    // `undefined` на том маршруте, где слой забыли подключить
    everyEndpoint({ transport: HttpTransport$('default') }).hasVar(
      RequestId,
      'requestId',
    ),
    // Каждый подписчик шины дедуплицирует доставку. Без слоя повтор
    // относился бы к обязанностям подписчика соглашением, а здесь это
    // проверка сборки: нарушение видно до открытия сокета
    appInbox.requiresInbox({ transport: BusTransport$ }, 'inbox'),
  ],
});
