/**
 * Декларация endpoint'а на выдуманном транспорте.
 *
 * Собрана тем же примитивом ядра, что HTTP-endpoint. Нужна там, где
 * проверяется, что порты видят только свои декларации: зависеть ради
 * этого от транспортного пакета было бы дороже, чем объявить endpoint на
 * выдуманном токене.
 */

import type { AnyEndpointDefinition } from '../../pipeline/index.js';
import { makeEndpoint, Ok } from '../../pipeline/index.js';

import { makeToken } from '@nestling/container';

const ForeignTransport$ = makeToken('transport:foreign');

export const httpLikeDeclaration: AnyEndpointDefinition = makeEndpoint({
  transport: ForeignTransport$,
  pattern: 'GET /users',
  handler: async () => new Ok({ users: [] }),
});
