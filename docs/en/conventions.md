# Naming conventions

> Rules for the code of an application on Nestling: the names of declarations,
> schemas, failures, DI tokens, handlers and files. The guide and the examples
> (`examples/*`) follow these rules; the linter rules are written by this
> document. The terms come from the [glossary](./glossary.md).

## Endpoints and operations

- The name of an endpoint and an operation is a verb with an object in
  PascalCase: `GetUser`, `CreateUser`, `CheckHealth`. A noun without a
  verb (`Health`, `Users`) is not a valid name.
- An endpoint and the operation it serves are named the same. The file
  tells them apart: the operation lives in `api/operations.ts`, the
  endpoint in `<name>.endpoint.ts`. In the endpoint file, the operation
  is imported with a suffix: `import { GetUser as GetUserOperation }`.
- The `name` field of an operation is built from the feature name and
  the verb through a dot, in lower case: `users.get`, `users.create`.

## Schemas

- The input schema is named after the operation with the `Input`
  suffix: `CreateUserInput`, `ListUsersInput`. The type is derived from
  the schema under the same name:
  `type CreateUserInput = z.infer<typeof CreateUserInput>`.
- The output schema is named after the entity it describes: `User`.
  Only a shape that exists for the sake of a single endpoint gets the
  `Output` suffix: `ExportUsersOutput`.

## Failures

- A failure definition is named after the event, without the `Error`,
  `Fail` or `Exception` suffixes: `UserNotFound`, `EmailTaken`. Kernel
  definitions are named after the category: `BadRequest`, `Timeout`,
  `InternalError`.
- A failure code consists of segments joined by a colon. Every segment
  matches `[a-z_]+`. The first segment is the category from a closed
  list (`not_found`, `conflict`, `unauthorized`, …), the rest refine it:
  `not_found:user`, `conflict:email_taken`. A code with one category is
  allowed: `unauthorized`.

## DI tokens and providers

- A class is its own DI token and is named like the class: `Database`.
- The DI token of an interface is named like the interface with the `$`
  suffix: `UsersRepository$` for `UsersRepository`. Kernel DI tokens and
  families are named the same way: `HttpTransport$`, `RootLogger$`,
  `Logger$`, `HealthCheck$`. There are no other rules for the suffix. By
  the suffix, the linter derives the dependency list from the types of
  the constructor parameters: the type `X` with `X$` visible in the file
  gives the DI token `X$` (the `dependency-list` rule in
  `@nestlingjs/eslint-plugin`).
- The decorator sets the role of the class: `@Component([deps])` for a
  service, `@Resource([deps])` for a pool or a connection,
  `@Handler([deps])` for a handler. The implementation of an interface
  is registered in `providers:` through
  `classProvider(UsersRepository$, DbUsersRepository)`.
- A class that implements an interface gets a prefix naming the way it
  is implemented: `DbUsersRepository`. A fake for tests is named by the
  same scheme in lowerCamelCase, if it is a function:
  `inMemoryUsersRepo`.
- A configuration section is named `<Name>Config`, the section prefix
  is written in lower case: `AppConfig = makeConfig('app', …)`. The name
  of the environment variable is built from the prefix and the field
  name: `APP_PAGE_SIZE`.

## Handlers

- A handler class is named after the operation with the `Handler`
  suffix: `GetUserHandler`. The method is named `handle`. The class is
  marked with `@Handler([deps])` and may declare
  `implements Handler<typeof GetUser>`; an HTTP handler declares
  `implements HttpHandler<typeof Login>`.
- A handler function is named after the operation in lowerCamelCase
  with the `Handler` suffix: `getUserHandler`.
- The implementation of an operation (`implement`) is a value with the
  `Impl` suffix: `CheckAddressImpl`. Its handler class is named after the
  operation: `CheckAddressHandler`.
- An event subscriber is a value `<Event>In<Feature>`:
  `UserRegisteredInNotifications`. Its handler class adds the same
  suffix: `UserRegisteredInNotificationsHandler`. The feature name in the
  value matches
  the `subscriber:` string.

## Switches

- A multi-valued switch is named after what it chooses, in PascalCase:
  `Storage = makeSwitch('storage', ['s3', 'local'])`. Its lower-case
  string name matches the flag of the build argument:
  `--storage s3`.
- A two-position switch is named as a predicate:
  `AuditEnabled = makeSwitch('audit')`, `DocsEnabled.when(openapi)`.
  Its string name stays a noun: `'audit'`.
- There is no `Switch` suffix: the `when` or `pick` method at the point
  of use names the kind of value.

## Plugins

- A plugin instance is named with a noun in lowerCamelCase, without a
  prefix and without a suffix: `openapi`, `inbox`, `outbox`,
  `subscriptions`, `db`, `ops`. The `plugins:` field already names the
  kind of value, so the name does not repeat it.
- A factory that returns a plugin is named `make<Name>`: `makeOpenapi`,
  `makeInbox`, `makeOutbox`, `makeSubscriptions`, `makeDrizzlePg`,
  `makeHttpProbes`. The noun stays free for the instance:
  `const openapi = makeOpenapi({ info })`.
- A factory of a transport or a server stays a noun: `http()`, `nats()`,
  `mcp()`, `cli()`, `server()`. A transport is declared right inside
  `transports:` and takes no variable for the instance.
- An inline call in `plugins:` takes no variable either:
  `makeHttpProbes()`.
- The string name of a plugin (`name: 'app-auth'`) does not depend on
  the name of the value.

## Pipeline

- A layer is named with a participle in lowerCamelCase: `traced`,
  `authed`, `transactional`, `signed`, `tracked`, `outboxed`. The
  participle says what the layer has already done to the request by the
  time the handler runs.
- There is no `Layer` suffix: the `pipeline:` field and the argument of
  `compose` name the kind of value.
- A step class is named after the action: `Authenticate`,
  `AuditOutcome`.

## Files

- One endpoint per file: `<name-with-hyphens>.endpoint.ts`, for example
  `get-user.endpoint.ts`. The implementation of an operation is also an
  endpoint, so the file is named the same way:
  `check-address.endpoint.ts`,
  `user-registered-in-notifications.endpoint.ts`.
- Implementations declared right in the feature file are moved to their
  own files as soon as there is more than one: the feature file lists
  the composition and does not hold the execution.
- Feature: `<name>.feature.ts`. Plugin: `<name>.plugin.ts`. Repository:
  `<name>.repository.ts`. Feature failures: `<name>.errors.ts`.
  Configuration section: `<name>.config.ts`. Application switches:
  `switches.ts`.
- Operations that the client imports live in `api/operations.ts`. The
  file imports only `@nestlingjs/operations`, schemas and failure
  definitions.
- `app.ts` declares and exports `app`: the result of `makeApp`.
  `main.ts` imports `app` and runs it. `main.ts` has no other exports.
