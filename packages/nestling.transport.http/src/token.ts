import { makeToken } from '@nestling/container';
import { transportNameOf } from '@nestling/pipeline';
import type { TransportToken } from '@nestling/transport';

/**
 * Токен HTTP-транспорта.
 *
 * Им ссылается на транспорт каждая `httpEndpoint`-декларация, и по нему же
 * `App` берёт инстанс из графа: «ручка требует транспорт, которого нет» —
 * тот же fail-fast, что у любой незарегистрированной зависимости, а не
 * отдельная механика capability negotiation.
 */
export const HttpTransport$: TransportToken = makeToken('transport:http');

/** Короткое имя транспорта (`'http'`) — то же, что читают слои пайплайна */
export const HTTP_TRANSPORT_NAME = transportNameOf(HttpTransport$);
