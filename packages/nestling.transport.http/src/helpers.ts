import type { Optional, Schema } from '@common/misc';
import type {
  AnyInput,
  AnyOutput,
  EndpointDefinition,
  EndpointMetadata,
} from '@nestling/pipeline';
import { Endpoint, makeEndpoint } from '@nestling/pipeline';
import type Router from 'find-my-way';

export function makeHttpEndpoint<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends Optional<Schema> = Optional<Schema>,
>(
  method: Router.HTTPMethod,
  path: string,
  meta: Omit<EndpointDefinition<I, O, M>, 'transport' | 'pattern'>,
): EndpointDefinition<I, O, M> {
  return makeEndpoint({
    transport: 'http',
    pattern: `${method} ${path}`,
    ...meta,
  });
}

export function HttpEndpoint<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends Optional<Schema> = Optional<Schema>,
>(
  method: Router.HTTPMethod,
  path: string,
  meta: Omit<EndpointMetadata<I, O, M>, 'transport' | 'pattern'>,
) {
  return Endpoint({
    transport: 'http',
    pattern: `${method} ${path}`,
    ...meta,
  });
}
