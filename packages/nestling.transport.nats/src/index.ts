/**
 * `@nestlingjs/transport.nats` — NATS как inbound и outbound транспорт шины.
 *
 * Пакет экспортирует фабрику транспорта, класс шины, шов коннектора и
 * ключи конфиг-секции. DI-токен транспорта пакет не объявляет: шина
 * регистрируется под `BusTransport$` из `@nestlingjs/app` — тем же,
 * которым пользуется in-proc шина, потому что шина в приложении ровно
 * одна.
 *
 * Барель перечисляет имена поимённо, а не через `export *`. Имя, которого
 * здесь нет, остаётся внутренним: его можно менять, не ломая тех, кто
 * установил пакет.
 */

// ./connector.js — 3
export type {
  NatsConnectOptions,
  NatsConnector,
  NatsLike,
} from './connector.js';
export { consumerNameOf, groupOf, streamNameOf } from './subject.js';
export { nats, NatsBus } from './transport.js';
export type {
  NatsConnectionInfo,
  NatsDeliveryFailure,
  NatsTransportOptions,
} from './transport.js';
export {
  CONTEXT_HEADER,
  IDEMPOTENCY_HEADER,
  jsonCodec,
  SUBJECT_HEADER,
  TIMEOUT_HEADER,
} from './wire.js';
export type { NatsCodec } from './wire.js';

/**
 * Из конфиг-секции транспорта наружу уходит только `keys`-хэндл: право
 * привязать источник. DI-токен секции остаётся приватным — инжектить её может
 * лишь сам пакет (keys-capability).
 */
export { natsConfigKeys } from './config.js';
