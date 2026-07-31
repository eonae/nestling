# @nestling/transport

Transport abstraction for Nestling: the `ITransport` contract
(`capabilities`, `endpoint()`, `listen()`, `close?()`) that connects
`@nestling/app` with concrete transports (`@nestling/transport.http`,
`@nestling/transport.cli`).

`endpoint()` accepts only a **runnable** declaration
(`EndpointDefinition<I, O, P, never>`) — symmetrically to a pipeline being
runnable only at `TNeeds = never`. A declaration with `deps`, a class
handler or class units in its pipeline is resolved first
(`endpoint.resolve(resolver)`; `App` does it on startup), so a transport
never needs to know about the DI container.

## `capabilities`

```ts
interface TransportCapabilities {
  readonly input: ReadonlySet<FormKind>;   // 'value' | 'stream' | 'events' | 'multipart'
  readonly output: ReadonlySet<FormKind>;
}
```

The field is **required**: which io forms a transport can carry is data,
not a convention and not a runtime check on the first request. The type is
declared by `@nestling/pipeline` (the set of forms is a kernel concept) and
re-exported here so a transport author needs a single import.

A declaration whose form is outside its transport's capabilities is
rejected **at registration, before any request is served** — by `App` when
it wires the module tree, and by the transport itself on the standalone
path. Both call the same kernel function, so the message is one:

```
Endpoint 'watch' declared in module 'module:ops': transport 'cli' does not
support form 'events' in 'output' (supported: value, stream).
```

Richness is declared in the contract and reconciled by this check — see
[`docs/design/transports.md`](../../docs/design/transports.md) for the
capability table of the V1 transports.

> 🚧 Active development. Architecture doc:
> [`docs/design/transports.md`](../../docs/design/transports.md).
