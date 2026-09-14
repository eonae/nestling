import { Handler } from '@nestlingjs/container';
import type { HttpHandlerMeta } from '@nestlingjs/transport.http';

interface Credentials {
  email: string;
}

/**
 * What the request brought is the second parameter of the handler. There is
 * no decorator for a header and no API for reading cookies: the transport
 * hands the whole of its side over in one typed value.
 */
@Handler([])
export class SignIn {
  // #region meta
  async handle(input: Credentials, meta: HttpHandlerMeta) {
    const forwarded = meta.http.headers['x-forwarded-proto'];

    return { email: input.email, secure: forwarded === 'https' };
  }
  // #endregion
}
