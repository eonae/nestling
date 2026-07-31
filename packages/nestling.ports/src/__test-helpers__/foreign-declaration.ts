/**
 * Декларация чужого транспорта — тем же kernel-примитивом, что HTTP-ручка.
 *
 * Нужна там, где проверяется, что порты видят только **свои** декларации:
 * зависеть ради этого от транспортного пакета было бы дороже, чем объявить
 * ручку на выдуманном токене.
 */

import { makeToken } from '@nestling/container';
import type { AnyEndpointDefinition } from '@nestling/pipeline';
import { makeEndpoint, Ok } from '@nestling/pipeline';

const ForeignTransport$ = makeToken('transport:foreign');

export const httpLikeDeclaration: AnyEndpointDefinition = makeEndpoint({
  transport: ForeignTransport$,
  pattern: 'GET /users',
  handle: async () => new Ok({ users: [] }),
});
