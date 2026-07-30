# @nestling/transport

Transport abstraction for Nestling: the `ITransport` contract
(`endpoint()`, `listen()`, `close?()`) that connects `@nestling/app`
with concrete transports (`@nestling/transport.http`,
`@nestling/transport.cli`).

`endpoint()` accepts only a **runnable** declaration
(`EndpointDefinition<I, O, P, never>`) — symmetrically to a pipeline being
runnable only at `TNeeds = never`. A declaration with `deps`, a class
handler or class units in its pipeline is resolved first
(`endpoint.resolve(resolver)`; `App` does it on startup), so a transport
never needs to know about the DI container.

> 🚧 Active development. Architecture doc:
> [`docs/design/transports.md`](../../docs/design/transports.md).
