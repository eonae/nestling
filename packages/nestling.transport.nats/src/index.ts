/**
 * `@nestling/transport.nats` — NATS как inbound и outbound транспорт шины.
 *
 * Наружу уезжают фабрика транспорта, класс шины, шов коннектора и ключи
 * конфиг-секции. Токен транспорта пакет не объявляет: шина регистрируется
 * под `BusTransport$` из `@nestling/ports` — тем же, которым пользуется
 * in-proc шина, потому что шина в приложении ровно одна.
 */

export * from './connector.js';
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
 * привязать источник. Токен секции остаётся приватным — инжектить её может
 * лишь сам пакет (keys-capability).
 */
export { natsConfigKeys } from './config.js';
