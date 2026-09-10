/**
 * Плагин аутентификации: класс-юнит `Authenticate` и слой `authed`.
 *
 * Слой нужен endpoint'ам двух фич, поэтому юнит регистрирует плагин, а
 * не фича: провайдер, достижимый из двух фич, живёт в плагине.
 */

import { Unauthorized } from '../../errors.js';
import { observability } from '../observability/index.js';

import { Authenticate } from './authenticate.js';

import { compose, makePipeline, makePlugin } from '@nestlingjs/app';

export { type Caller } from './authenticate.js';

export const appAuth = makePlugin({
  name: 'app-auth',
  providers: [Authenticate],
});

/**
 * Слой для endpoint'ов, которые меняют данные: наблюдаемость плюс
 * проверка Bearer-токена. Хендлер получает `meta.caller`.
 *
 * `Unauthorized` объявлен здесь, при подключении юнита: endpoint'ы со
 * слоем получают этот отказ в своё множество и в документ OpenAPI, не
 * перечисляя его у себя.
 */
export const authed = compose(
  observability,
  makePipeline().pre(Authenticate, { errors: [Unauthorized] }),
);
