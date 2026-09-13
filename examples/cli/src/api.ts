/**
 * Клиент сервиса: строится из тех же операций, которые сервис
 * обслуживает.
 *
 * Копии деклараций здесь нет — `@examples/microservice/operations`
 * импортируется как обычный пакет. Изменилась схема входа в сервисе —
 * команда перестаёт компилироваться, а не ломается на первом вызове.
 */

import {
  CreateUser,
  GetUser,
  ListUsers,
} from '@examples/microservice/operations';
import { makeClient } from '@nestlingjs/client';

/** Адрес сервиса и Bearer-токен: обе строки приходят из окружения */
export const baseUrl = process.env.API_URL ?? 'http://localhost:3000';

/** Имена методов задаёт потребитель: ключи объекта */
export const api = makeClient(
  { createUser: CreateUser, getUser: GetUser, listUsers: ListUsers },
  {
    baseUrl,
    // Функция, а не объект: заголовки вычисляются на каждый запрос
    headers: () => ({ authorization: `Bearer ${process.env.API_TOKEN ?? ''}` }),
  },
);
