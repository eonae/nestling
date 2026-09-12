/**
 * `@nestlingjs/transport.http`: HTTP как inbound-транспорт приложения.
 *
 * Барель перечисляет имена поимённо, а не через `export *`. Имя, которого
 * здесь нет, остаётся внутренним: его можно менять, не ломая тех, кто
 * установил пакет. Пометки bind-карты (`query`, `body`, `HttpBinding`)
 * объявлены в `@nestlingjs/operations` и приходят автору декларации
 * оттуда — вместе с самой операцией, без серверного кода.
 *
 * Байтовые части — разбор тела, кадрирование ответа, таблица статусов,
 * значение способностей — публичны намеренно: на них собирается своя
 * реализация `ITransport` поверх стороннего HTTP-сервера. Это проверяет
 * `satellite.integration.spec.ts`.
 *
 * Полный перечень — в README пакета.
 */

// ./transport.js — 3
export { http, HTTP_CAPABILITIES, HttpTransport } from './transport.js';

// ./server.js — 3
export { HttpServer, HttpServer$, httpServer } from './server.js';

// ./token.js — 2
export { HTTP_TRANSPORT_NAME, HttpTransport$ } from './token.js';

// ./router.js — 1
export { HttpRouter } from './router.js';

// ./parser.js — 4
export {
  parseJson,
  parseMultipartForm,
  parseNdjson,
  parseRaw,
} from './parser.js';

// ./adapter.js — 2
export { httpCodeOf, sendResponse } from './adapter.js';

// ./helpers.js — 2
export { httpEndpoint } from './helpers.js';
export type { HttpStartContext } from './helpers.js';

// ./request.js — 3
export type { HttpHandler, HttpHandlerMeta, HttpRequest } from './request.js';

// ./response.js — 4
export { HttpResponse } from './response.js';
export type { Cookie, HttpOutput, HttpOutputSync } from './response.js';

// ./units.js — 3
export { httpAccessLog, withClientIp, withHeader } from './units.js';

// ./binding.js — 4
export {
  assemblePayload,
  bindingNeedsBody,
  httpBindingOf,
  readQuery,
} from './binding.js';

// ./probes.js — 1
export { httpProbes } from './probes.js';

/**
 * Из конфиг-секции наружу уходит только дескриптор ключей: право
 * привязать источник. DI-токен секции остаётся приватным, и у каждого
 * сервера он свой.
 */
export { httpServerKeys } from './config.js';
