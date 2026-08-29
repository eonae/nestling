import { makeToken } from '@nestling/container';
import { transportNameOf } from '@nestling/pipeline';
import type { TransportToken } from '@nestling/transport';

/**
 * Токен HTTP-транспорта.
 *
 * На него ссылается каждая `httpEndpoint`-декларация, и по нему `App`
 * берёт транспорт из графа. Endpoint без зарегистрированного транспорта
 * роняет сборку так же, как любая незарегистрированная зависимость.
 */
export const HttpTransport$: TransportToken = makeToken('transport:http');

/** Короткое имя транспорта (`'http'`); его же видят слои пайплайна */
export const HTTP_TRANSPORT_NAME = transportNameOf(HttpTransport$);
