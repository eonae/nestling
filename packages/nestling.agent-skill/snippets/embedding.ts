import { UsersFeature } from './users.feature.js';

import { makeApp } from '@nestlingjs/app';
import {
  adapter,
  http,
  server,
  toFetchHandler,
} from '@nestlingjs/transport.http';

/**
 * A server is a declaration of its own, and `transports:` takes transports
 * only. Two transports that name the same server share one socket, and a
 * server nobody names is never created.
 */
// #region server
export const api = server();

export const served = makeApp({
  features: [UsersFeature],
  transports: [http({ server: api })],
});
// #endregion

/**
 * Inside a foreign process the application opens no socket: `adapter()`
 * replaces `http()`, the `httpEndpoint` declarations move over unchanged,
 * and the handler is taken off the running application.
 */
// #region embedded
const embedded = makeApp({
  features: [UsersFeature],
  transports: [adapter()],
}).build();

await embedded.run({ signals: false });

const handler = toFetchHandler(embedded);

export const GET = handler;
export const POST = handler;
// #endregion
