/**
 * `@nestling/client` — типизированный HTTP-клиент из операций.
 *
 * Зависит только от `@nestling/contracts`: ни серверного кода, ни
 * Node-специфики в замыкании импортов нет, и это проверяется тем же тестом
 * границы, что у пакета операций, — обещание «собирается для браузера»
 * должно быть инвариантом, а не строчкой в README.
 */

export { makeClient } from './client.js';
export type {
  Client,
  ClientArgs,
  ClientFail,
  ClientMethod,
  ClientResult,
} from './client.js';
export type { ClientConfig, ClientHeaders, ClientMeta } from './config.js';
