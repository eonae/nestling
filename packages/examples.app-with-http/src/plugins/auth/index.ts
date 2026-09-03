/**
 * Плагин аутентификации: класс-юнит `Authenticate` и слой `authed`.
 *
 * Слой нужен endpoint'ам двух фич, поэтому юнит регистрирует плагин, а
 * не фича: провайдер, достижимый из двух фич, живёт в плагине.
 */

import { observability } from '../logging';

import { Authenticate } from './authenticate';

import { makePlugin } from '@nestling/app';
import { compose, makePipeline } from '@nestling/pipeline';

export { type Caller } from './authenticate';

export const appAuth = makePlugin({
  name: 'app-auth',
  providers: [Authenticate],
});

/**
 * Слой для endpoint'ов, которые меняют данные: наблюдаемость плюс
 * проверка токена. Хендлер получает `meta.caller`.
 */
export const authed = compose(observability, makePipeline().pre(Authenticate));
