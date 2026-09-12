# @nestlingjs/transport.cli

The Nestling CLI transport: the same endpoints and pipelines as HTTP,
but commands replace routes, and the input stream serves as the
streamed input. The process runs one command and exits, or stays in a
REPL. A command that declares `missing: 'prompt'` asks in the terminal
for a missing required input.

> 🚧 Active development, the API may change. There is no validator
> among the dependencies: commands are validated through
> `@nestlingjs/app` by any [Standard Schema](https://standardschema.dev).
> Design: [`docs/en/design/transports.md`](../../docs/en/design/transports.md).
> Guide: [recipe "A CLI tool on the same primitives"](../../docs/en/recipes/cli.md).

## Install

```bash
npm install @nestlingjs/transport.cli
```

## Minimal example

```typescript
import { makeApp, Ok } from '@nestlingjs/app';
import { zodConverter } from '@nestlingjs/schema.zod';
import { cli, cliEndpoint } from '@nestlingjs/transport.cli';
import { z } from 'zod';

export const Deploy = cliEndpoint('deploy', {
  input: z.object({
    env: z.enum(['dev', 'prod']).describe('Target environment'),
    force: z.boolean(),
  }),
  output: z.object({ done: z.boolean() }),
  // a missing flag is asked in the terminal; without it, validation fails
  missing: 'prompt',
  handler: async ({ env, force }) => new Ok({ done: await deploy(env, force) }),
});

// node dist/main.js deploy --env prod --force
await makeApp({
  features: [ToolsFeature],
  transports: [cli({ converters: [zodConverter()] })],
})
  .assemble()
  .run();
```

A command with the `missing: 'prompt'` policy needs a schema converter
in `cli({ converters })`: the question is derived from the JSON Schema
of the `input` form, and Standard Schema gives no introspection.
Without a converter, `serve` fails, naming the command and the vendor
of its schema. An input stream together with the policy also fails
`serve`: the questions and the stream read the same input.

## Exports

| Name | What it does |
|---|---|
| `cli` | the transport provider for `transports:`; takes options |
| `cliEndpoint` | an endpoint declaration: the command name as the first argument instead of a route |
| `cliBindingOf` | reads the `missing` policy from the declaration or the route projection |
| `CliTransport` | the `ITransport` implementation: argv parsing, run, REPL, questions |
| `CliTransport$` | the DI token of the transport |
| `CLI_TRANSPORT_NAME` | the short name of the transport (`'cli'`) |
| `CliTransportOptions` | the mode, the arguments, the streams, the converters, the questions |
| `CliEndpointDictionary` | the dictionary of the CLI declaration for `cliEndpoint` |
| `CliBinding` | the binding policy in the `binding` field of the declaration |
| `CliMissingPolicy` | `'error'` or `'prompt'` |
| `CliInput` | the parsed input of the command: positional arguments and flags |
| `CliInputStream` | the input stream of the transport |
| `CLI_CAPABILITIES` | what the transport supports: a streamed input and NDJSON on output |
| `parseArgv` | parses argv into `CliInput` without running the application |
| `buildPromptPlan` | builds the question plan of a command from its schema |
| `PromptPlan` | the question plan of a command |
| `PromptQuestion` | a question about one input field |
| `PromptKind` | the shape of a question: a list, a confirmation, a string |

`CliTransportOptions` takes `mode` and `argv` (the run mode), `input`,
`output` and `errorOutput` (the defaults are the process channels),
`converters` and `interactive`. The streams are substituted by value, so
a test checks the questions and the result output without a terminal.

## Package boundaries

The transport does not parse subcommands, does not print help and does
not draw progress. The output format is JSON and NDJSON. The questions
collect only the top-level scalar fields: an array and a nested object
stay with the flags. There is no hidden input: a password is printed in
the terminal as is.
