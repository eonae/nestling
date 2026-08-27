/**
 * Тестовая поверхность пакета: двойник брокера.
 *
 * Живёт за conditional export `./testing` — тем же приёмом, что тестовый
 * корень `@nestling/app/testing`: прод-импорт падает на резолве, потому
 * что условие `testing` включено только в тестовом окружении.
 */

export {
  DEFAULT_MAX_DELIVER,
  HeadersDouble,
  NATS_CONNECTION_CLOSED,
  NATS_NO_RESPONDERS,
  NATS_TIMEOUT,
  NatsDouble,
  natsDouble,
  NatsDoubleError,
  subjectMatches,
} from './double.js';
