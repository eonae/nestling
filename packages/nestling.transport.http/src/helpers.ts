import type { Optional, Schema } from '@common/misc';
import type { HandlerConfig, Input, Output } from '@nestling/pipeline';
import { Endpoint, makeEndpoint } from '@nestling/pipeline';
import type Router from 'find-my-way';

export function makeHttpHandler<
  I extends Input = Schema,
  O extends Output = Schema,
  M extends Optional<Schema> = Optional<Schema>,
>(
  method: Router.HTTPMethod,
  path: string,
  config: Omit<HandlerConfig<I, O, M>, 'transport' | 'pattern'>,
): HandlerConfig<I, O, M> {
  return makeEndpoint({
    transport: 'http',
    pattern: `${method} ${path}`,
    ...config,
  });
}

export function HttpEndpoint<
  I extends Input = Schema,
  O extends Output = Schema,
  M extends Optional<Schema> = Optional<Schema>,
>(
  method: Router.HTTPMethod,
  path: string,
  config: Omit<HandlerConfig<I, O, M>, 'transport' | 'pattern'>,
) {
  return Endpoint({
    transport: 'http',
    pattern: `${method} ${path}`,
    ...config,
  });
}
