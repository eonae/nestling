# What is checked before the first request

Nestling moves checks as early as possible: some application errors
cannot be written, and the rest stop the start instead of the request.
The table names the check, the moment it fires and the chapter of the
[guide](./guide/README.md) that introduces it.

| What is checked | When | Chapter |
|---|---|---|
| The dependency list matches the constructor parameters by types, order and length | at compile time | [6](./guide/06-repository.md) |
| The requirements of a layer to the external context are met at the `compose` point | at compile time | [9](./guide/09-logging.md) |
| The handler returns what the `output` schema describes | at compile time | [1](./guide/01-first-service.md) |
| The handler returns only the failures declared in `errors:` | at compile time | [4](./guide/04-errors.md) |
| A failure of a pre-step is declared on the layer | at compile time | [10](./guide/10-auth.md) |
| Layer failures are included in the `errors:` of the operation | at compile time | [14](./guide/14-features.md) |
| The path of an endpoint is non-empty, without repeated path parameters | when the declaration is created | [3](./guide/03-input.md) |
| A declaration with an early-success layer has no `output` | when the declaration is created | [10](./guide/10-auth.md) |
| Command-line flags are known to the declaration, values to its dictionaries | before phase 0, while parsing the argument | [19](./guide/19-select.md) |
| The configuration keys are set and pass their schemas | phase BOOTSTRAP, before the container | [7](./guide/07-config.md) |
| All dependencies are registered, the graph has no cycles | phase BUILD | [6](./guide/06-repository.md) |
| Every endpoint has connected the required layer | phase BUILD | [10](./guide/10-auth.md) |
| A mutating endpoint is composed from the transaction layer | phase BUILD | [11](./guide/11-database.md) |
| A bus subscriber is composed from the inbox layer | phase BUILD | [16](./guide/16-durable-events.md) |
| The pipeline has declared a variable that is read from deep in the graph | phase BUILD | [10](./guide/10-auth.md) |
| The io shapes of the declarations are supported by the transport | phase BUILD | [12](./guide/12-files-and-streams.md) |
| Every schema has a converter to OpenAPI | phase BUILD | [13](./guide/13-openapi-and-client.md) |
| There is no direct graph edge between two features | phase BUILD | [14](./guide/14-features.md) |
| Every called operation has an owner or a bus | phase BUILD | [20](./guide/20-split.md) |
| A failure outside `errors:` does not reach the client | on the request, replaced with `internal_error` | [4](./guide/04-errors.md) |
| The input matches the `input` schema | on the request, response `400` | [3](./guide/03-input.md) |

The checks of the BUILD phase run before the instances are created
and before the socket is opened: a violation stops the process earlier
than it acquires resources. The same checks are run by `app.check(args)`
over the matrix of topologies in CI ([chapter 19](./guide/19-select.md))
and by the test build `buildTest`
([chapter 8](./guide/08-testing.md)).

The build argument alone determines the composition of a process: an
object or the `argv(process.argv)` marker. The environment does not
affect it — neither the feature selection nor the switch values are read
from it. Config bindings passed to `run()`, `check()` or `buildTest()`
do not affect it either: `discover()` builds the OpenAPI document and
the topology matrix without reading a single source
([chapter 7](./guide/07-config.md)). An unknown flag, an unknown feature
and a switch value outside its dictionary stop the process before phase
0 — earlier than any I/O.
