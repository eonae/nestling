# @nestlingjs/mcp

MCP as an inbound transport of the application. A tool of an agent is an
endpoint of that transport: the name, the schemas, the failures and the
description are taken from the declaration, so a second description for
the agent is not needed.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/transports.md`](../../docs/en/design/transports.md) §8.
> Recipe: [expose the operations to an agent over MCP](../../docs/en/recipes/mcp.md).

## Install

```bash
npm install @nestlingjs/mcp
```

The converter for the vendor the framework writes its own schemas in
comes as a dependency of the package. An application on another
validator needs that validator's converter — it is passed in the
`converters` list.

## Minimal example

```typescript
import { mcp, mcpTool } from '@nestlingjs/mcp';
import { http, server } from '@nestlingjs/transport.http';

export const GetUserTool = mcpTool.implement(GetUser, {
  annotations: { readOnlyHint: true },
  handler: GetUserHandler,
});

const api = server();

makeApp({
  features: [UsersFeature], // GetUserTool goes into `endpoints:` of the feature
  transports: [
    http({ server: api }),
    mcp({
      server: api,
      info: { name: 'users-api', version: '1.0.0' },
    }),
  ],
});
// POST /mcp on the same socket as the HTTP API
```

## Exports

- **Transport** ([design](../../docs/en/design/transports.md)) — `mcp`,
  `MCP_CAPABILITIES`, `McpRuntimeOptions`, `McpTransport`,
  `McpTransport$`, `MCP_TRANSPORT_NAME`, `McpTransportOptions`,
  `DEFAULT_PATH`, `DEFAULT_SESSION_IDLE_MS`, `DEFAULT_SESSION_LIMIT`.
- **Tool declaration**
  ([design](../../docs/en/design/endpoints.md)) — `AnyRequestOperation`,
  `deriveToolName`, `McpBinding`, `mcpBindingOf`, `McpImplementDictionary`,
  `mcpTool`, `McpToolDictionary`.

  `mcpTool` is a value, not a function. A call declares a tool together
  with the schemas, and `mcpTool.implement(Operation, { … })` serves a
  declared operation: the schemas, the failures and the `doc` section
  come from it.
- **Definitions for the agent**
  ([design](../../docs/en/design/schemas.md)) — `BoundTool`,
  `buildToolDefinitions`, `BuildOptions`, `McpCallToolResult`,
  `McpContent`, `McpObjectSchema`, `McpServerInfo`, `McpToolAnnotations`,
  `McpToolDefinition`, `McpViolation`.
- **Protocol** — `LATEST_PROTOCOL_VERSION`, `McpSessionLimitReached`,
  `McpSessionNotFound`, `ProtocolVersion`, `SUPPORTED_PROTOCOL_VERSIONS`.

Re-export of [`@nestlingjs/app`](../nestling.app/): `SchemaDocConverter` —
the schema converter interface.

## Package boundaries

The package serves only `tools`: it exposes neither the resources nor the
prompts of the protocol. The messages a server initiates on its own are
out of scope too — sampling, notifications about a changed tool list and
logging over the protocol. That is why `GET` on the transport path is not
served: the handler does not take it, and the client gets a `404` instead
of the `405` the specification would prefer. The client from
`@modelcontextprotocol/sdk` reports that to its `onerror` and keeps
working, because the event stream is optional.

The package does no authentication. The request headers reach the
pipeline of the declaration the usual way, and who the caller is stays a
task of the application layer.

The transport has no default pipeline: every declaration names its own
layer, and the requirement «every tool carries the layer» is written as a
policy of the root. HTTP works the same way, and a second place that
assigns a layer is not introduced.

The package has no separate process with stdio: the transport lives in
the application that serves the same operations. It does not open a
socket of its own either — `mcp({ server })` takes the declaration of an
HTTP server.

The protocol is implemented in the package, `@modelcontextprotocol/sdk`
stays in `devDependencies` and works as the proof: a type check and an
integration run with the real client. The package has no runtime
dependency on a validator or on an HTTP framework.
