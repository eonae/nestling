# @nestling/transport

Transport abstraction for Nestling: the `ITransport` contract
(`capabilities`, `serve(dispatch, signal)`, `close?()`) plus the `Dispatch`
value that connects `@nestling/app` with concrete transports
(`@nestling/transport.http`, `@nestling/transport.cli`).

## `Dispatch` — the only way a transport gets handles

```ts
interface Dispatch {
  /** Route projections: pattern, io forms, bind map, declared failures */
  readonly routes: readonly RouteDeclaration[];

  /** Runs the endpoint: picks the "with pipeline / without" branch */
  call(pattern, ctx, options?): Promise<ResponseContext>;
}

const dispatch = makeDispatch([Ping]);          // built in phase WIRE
await transport.serve(dispatch, controller.signal);
```

The split is by **content, not by timing**: the wire (`routes`) goes to the
transport, execution (`call`) stays in the kernel. `RouteDeclaration` is a
projection without `handle`, `pipeline`, `deps` or `resolve` — so a
transport that opened its socket early has nothing to route. That is why
there is no nullary `listen()` and no per-endpoint registration method in
the contract.

Boundary options (`exposeErrorDetails`, `onUnknownFail`) travel as an
argument of `call`: they are a property of a particular wire, not of the
routing table.

`makeDispatch` accepts only **runnable** declarations
(`EndpointDefinition<I, O, P, never>`) — symmetrically to a pipeline being
runnable only at `TNeeds = never`. A declaration with `deps`, a class
handler or class units in its pipeline is resolved first
(`endpoint.resolve(resolver)`; `assemble` does it in phase WIRE), so a
transport never needs to know about the DI container.

A transport is referenced by a **token**: `TransportToken =
TokenString<ITransport>`. The short name a pipeline layer reads
(`meta.transport === 'http'`) is derived from the token id by
`transportNameOf`.

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
rejected **before any request is served** — by `App` in phase ASSEMBLE
(where both declarations and transport instances are known) and by the
transport itself inside `serve`, before the socket opens. Both call the same
kernel function, so the message is one:

```
Endpoint 'watch' declared in module 'module:ops': transport 'cli' does not
support form 'events' in 'output' (supported: value, stream).
```

Richness is declared in the contract and reconciled by this check — see
[`docs/design/transports.md`](../../docs/design/transports.md) for the
capability table of the V1 transports.

> 🚧 Active development. Architecture doc:
> [`docs/design/transports.md`](../../docs/design/transports.md).
