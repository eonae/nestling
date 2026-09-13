# Expose the operations to an agent over MCP

> Guide to the current API; verified against `da754bb4`.
> Target description: [design/transports.md](../design/transports.md) §8,
> [design/operations.md](../design/operations.md) §1.8. Rationale: the entry
> [ideas.md](../../decisions/ideas.md)
> `Разбор обзоров d/10 и d/13`, item 7.

The service already has an HTTP API, and the same operations have to be
exposed to an agent over the Model Context Protocol. A second description
is not needed: the name, the schemas, the failures and the text for the
agent are taken from the declaration that serves the requests.

## The transport on the same socket

MCP is an inbound protocol, so it is declared as a transport next to
`http()`. The server is declared separately and passed to both through the
`server` option; it is not listed among the transports, and the socket
stays one.

```typescript
// src/app.ts
export const api = server();

export const app = makeApp({
  features: [UsersFeature, NotificationsFeature, OpsFeature],
  transports: [
    http({ server: api }),
    mcp({
      server: api,
      info: { name: 'users-service', version: '1.0.0' },
      converters: openapiOptions.converters,
    }),
  ],
});
```

`info` reaches the agent in the answer to `initialize`: by the name and
the version it shows the user whose permission it asks for a call.
`converters` translate the schemas into JSON Schema — the same list the
OpenAPI document takes. The path is set by `path`, and by default it is
`POST /mcp`.

## A tool from a declared operation

`mcpTool.implement` reads the operation: the schemas, the failures and the
`doc` section. The name of the tool is derived from the name of the
operation by replacing the dots with underscores, and the description
comes from `doc.description`, then `doc.summary`. The handler is the same
class that serves the HTTP declaration.

```typescript
// src/features/users/tools/get-user.tool.ts
export const GetUserTool = mcpTool.implement(GetUserOperation, {
  annotations: { readOnlyHint: true },
  pipeline: observability,
  handler: GetUserHandler,
});
```

`annotations` are the hints for the agent about the nature of the tool.
They are not derived from the declaration: the HTTP method would tell a
lie about the effect, because `POST /users/search` changes the data no
more than `GET` does.

The tool goes into `endpoints:` of the feature next to the HTTP
declarations. The transport has no separate list of the composition.

```typescript
// src/features/users/users.feature.ts
export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  endpoints: [ListUsers, GetUser, CreateUser, GetUserTool, SearchUsersTool],
});
```

## A tool that the API does not have

An agent sometimes needs what a client of the API does not: a search by
substring instead of a paged list. Such a tool is declared by the
anonymous shape together with the schemas.

```typescript
// src/features/users/tools/search-users.tool.ts
export const SearchUsersTool = mcpTool('search_users', {
  description:
    'Найти пользователей по подстроке в адресе почты. Возвращает число ' +
    'найденных и их карточки.',
  annotations: { readOnlyHint: true },
  input: SearchUsersInput,
  output: SearchUsersOutput,
  pipeline: observability,
  handler: SearchUsersHandler,
});
```

The description is mandatory: the agent picks a tool by it, and a tool
with no description it cannot pick. A tool with no description fails the
start of the application — together with the other violations, as one
list.

## A layer on a tool

The transport has no default pipeline: every declaration names its own
layer. The headers of the agent request reach the pipeline the usual way,
so `authed` works on a tool the same way it works on an HTTP declaration.

```typescript
// src/features/users/tools/create-user.tool.ts
export const CreateUserTool = mcpTool.implement(CreateUserOperation, {
  annotations: { idempotentHint: false },
  pipeline: authed,
  handler: CreateUserHandler,
});
```

The requirement «every tool carries the layer» is written as a policy of
the root — the same one that writes it for HTTP.

```typescript
// src/app.ts
everyEndpoint({ transport: McpTransport$('default') }).hasLayer(
  observability,
  'observability',
),
```

## What the agent gets

`tools/list` returns the definitions built at the start. `tools/call` runs
the declaration through `dispatch.call`: the tool goes through its own
pipeline, its own layers and its own policies.

Success reaches the agent as JSON text in `content` and, when the output
form translates into an object schema, in `structuredContent` as well. A
failure of the operation reaches it as the same result with
`isError: true` and a text that names the code, the message and the
details. A failure does not become a protocol error: a declared failure is
part of the contract of the operation, and the agent has to read it and
act on it.

The tools do not reach the OpenAPI document: they have no HTTP address.
