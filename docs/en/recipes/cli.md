# A CLI tool on the same primitives

> Guide to the current API; verified against `simple-cli` (2026-09-12).
> Target description: [design/transports.md](../design/transports.md) §5,
> [design/endpoints.md](../design/endpoints.md). Rationale: the entry
> [ideas.md](../../decisions/ideas.md)
> `Endpoint-декларации: per-transport конструкторы, deps-инжект, формы хендлера`.

A service needs a console tool alongside it: a one-off command with
arguments and the processing of data from stdin. Input validation,
failures with a status and a code, and the `stream` form work the same
way as in HTTP, with no second rulebook for the command line.

## A command with arguments

```typescript
// examples/simple-cli/src/commands/greet.command.ts
const GreetInput = z.object({
  args: z.array(z.string()).min(1, 'name is required'),
  shout: z.boolean().optional(),
});

const GreetOutput = z.object({
  greeting: z.string(),
});

export const Greet = cliEndpoint('greet', {
  input: GreetInput,
  output: GreetOutput,
  handler: async ({ args, shout }) => {
    const text = `Hello, ${args[0]}!`;

    return { greeting: shout ? text.toUpperCase() : text };
  },
});
```

`cliEndpoint` declares a command the same way `httpEndpoint` declares
a route: the same `input`, `output`, `errors`, `pipeline` and
`handler`. Instead of a method and a path, the command has one field,
`command`, which also serves as the endpoint's pattern. The command
name is checked at the moment the declaration is created: an empty
string in `command` is an error on importing the file, not on parsing
the first command.

The command's input is assembled from the process arguments.
Positional arguments land in the `args` array. An option `--key value`
becomes the `key` field, a flag `--flag` with no value gives `true`.
The assembled object is checked by the `input` schema before the
handler is called: `z.array(...).min(1)` sets the requirement for the
name, and the `greet` command with no name answers with the
`bad_request` failure on the `args` path, without calling the handler.

```bash
yarn workspace @examples/simple-cli start:dev greet Alice --shout
```

```json
{
  "greeting": "HELLO, ALICE!"
}
```

The transport prints the command's result to stdout as JSON. The
handler does not write to the console itself.

## A command without input

```typescript
// examples/simple-cli/src/commands/help.command.ts (fragment)
export const Help = cliEndpoint('help', {
  output: HelpOutput,
  handler: async () => {
    console.log('Available commands:');
    // …
    return { message: 'Help displayed' };
  },
});
```

A command with no `input` receives an empty payload. The handler
prints the help text itself, because that is its output for a human,
and returns a confirmation matching the `output` schema as its result.

## A missing input

```typescript
// examples/simple-cli/src/commands/deploy.command.ts
const DeployInput = z.object({
  env: z.enum(['dev', 'prod']).describe('Target environment'),
  force: z.boolean().describe('Skip the safety checks'),
  host: z.string().describe('Deployment host').meta({ default: 'localhost' }),
});

export const Deploy = cliEndpoint('deploy', {
  input: DeployInput,
  output: DeployOutput,
  missing: 'prompt',
  handler: async ({ env, force, host }) => ({ env, host, forced: force }),
});
```

The `missing` field decides what a command does without a required
flag. The default `'error'` leaves the `bad_request` failure with the
field's path. `'prompt'` asks for the missing value in the terminal
and runs the command with the completed input.

The questions are derived from the schema, not declared next to it. An
`enum` gives a numbered list, a `boolean` gives a `[y/n]`
confirmation, a string and a number give a text input. `description`
is printed as a hint, a node's `default` is shown in parentheses and
substituted on an empty answer.

The default is declared with the `meta` annotation, not `default`. A
field with `.default('localhost')` is optional: the schema substitutes
the value itself, and it is never missing. `meta({ default:
'localhost' })` leaves the field required and says something else:
"here is the value I would take; ask, but suggest it."

The answer is placed in the same form a flag would give it: a string
for a scalar, `true` or `false` for a confirmation, a list item for a
choice. A schema written for command-line arguments
(`z.coerce.number()` where a number is needed) works with the
questions without a single edit.

```bash
yarn workspace @examples/simple-cli start:dev deploy
```

```
Target environment
  1) dev
  2) prod
env: 2
Skip the safety checks
force [y/n]: y
Deployment host
host (localhost):
{
  "env": "prod",
  "host": "localhost",
  "forced": true
}
```

A command with a policy needs a schema converter: the question is
derived from the JSON Schema of the `input` form, and Standard Schema
gives no introspection. The list is passed as a transport option,
`cli({ converters: [zodConverter()] })` from `@nestlingjs/schema.zod`.
With no converter, `serve` fails with the command's name and its
schema's vendor, instead of silently asking questions by field names
alone.

Questions are asked only while the input is a terminal and the `CI`
variable is not set. In a pipeline, the command reaches validation and
answers with a failure, like a command with no policy: the process
does not hang on a question nobody would see. The `cli({ interactive
})` option decides this explicitly.

Only required fields of a plain form are asked. An array and a nested
object give no question: such a field stays empty and gives a
validation failure. A stream on the input together with a policy
brings `serve` down: the questions and the stream read the same input.

## A stream from stdin

```typescript
// examples/simple-cli/src/commands/process-stdin.command.ts (fragment)
export const ProcessStdin = cliEndpoint('process-stdin', {
  input: stream('binary'),
  output: ProcessStdinOutput,
  errors: [EmptyStdin],
  handler: async (
    payload: AsyncIterableIterator<Buffer>,
  ): Output<ProcessStdinOutput, typeof EmptyStdin> => {
    let linesProcessed = 0;
    let totalBytes = 0;

    for await (const chunk of payload) {
      totalBytes += chunk.length;
      // …
    }

    if (totalBytes === 0) {
      return EmptyStdin();
    }

    return { linesProcessed, totalBytes };
  },
});
```

The `stream('binary')` input form gives the handler the stdin chunks
as they are. The `stream(T)` form with a schema would read stdin as
NDJSON and check every line against the schema, as in chapter
[12](../guide/12-files-and-streams.md), and a streaming `output` would
write the same NDJSON to the transport's stdout.

```typescript
// examples/simple-cli/src/errors.ts
export const EmptyStdin = makeFail('bad_request:empty_stdin', {
  message: 'No data received on stdin',
});
```

The failure is declared with the same `makeFail` as in HTTP: a code of
the form `category:specific_reason`, from which the response category
is read, and optional `message` and `details`. The category does not
depend on the transport: CLI prints the code as it is, HTTP would
translate `bad_request` to 400.

```bash
printf "a\nb\n" | yarn workspace @examples/simple-cli start:dev process-stdin
```

```
Processing: a
Processing: b
{
  "linesProcessed": 2,
  "totalBytes": 4
}
```

## The transport and the run modes

```typescript
// examples/simple-cli/src/main.ts
const argv = process.argv.slice(2);

const cli = new CliTransport({
  mode: argv.length > 0 ? 'argv' : 'repl',
  argv,
  converters: [zodConverter()],
});

const dispatch = makeDispatch([Help, Greet, Deploy, ProcessStdin]);

const shutdown = new AbortController();

async function main() {
  if (argv.length === 0) {
    console.log('REPL mode: type a command or "exit"');
  }

  await cli.serve(dispatch, shutdown.signal);
  await cli.close();
}
```

The transport receives commands through `serve(dispatch, signal)`, the
same as HTTP. What "accepting requests" means for the command line is
set by the mode. In `'argv'` mode, one command runs from the process
arguments, after which `serve` returns. In `'repl'` mode, commands are
read from stdin until `exit`, `quit` or the end of input. The example
picks the mode by whether arguments are present.

The input, output and error streams are options too: `input`,
`output` and `errorOutput`. The defaults are the process channels, and
substitution is needed by tests: questions and the printed result are
checked without a terminal.

The transport rejects the `events` and `multipart` forms at
registration. The error names the command and the form: a command has
no connection whose drop would be a normal end, and files arrive as
paths in the arguments.

The example assembles `dispatch` directly, because the commands have
no dependencies. A command with a class handler needs a container:
declare it in a feature and declare the application through `makeApp`
with the `cli()` transport in `transports:`. The minimal example is in
the [package README](../../../packages/nestling.transport.cli/README.md).

## Checking

Commands run through `execute`: `parseArgv` parses the arguments, the
response arrives as a value, stdout takes no part in this path.

```typescript
// examples/simple-cli/src/commands.spec.ts (fragment)
describe('команды через execute', () => {
  let cli: CliTransport;

  beforeEach(async () => {
    // An empty `argv`: `serve` registers the commands and runs nothing
    cli = new CliTransport({
      mode: 'argv',
      argv: [],
      converters: [zodConverter()],
    });
    await cli.serve(
      makeDispatch([Help, Greet, Deploy, ProcessStdin]),
      new AbortController().signal,
    );
  });

  it('собирает вход из позиционного аргумента и флага', async () => {
    const response = await cli.execute(
      parseArgv(['greet', 'Alice', '--shout']),
    );

    expect(response.isSuccess).toBe(true);
    expect(response.value).toEqual({ greeting: 'HELLO, ALICE!' });
  });

  it('отказывает по схеме, когда имени нет', async () => {
    const response = await cli.execute(parseArgv(['greet']));

    expect(response).toMatchObject({
      isSuccess: false,
      value: { code: 'bad_request' },
    });
  });

  it('не знает команду, которой нет в dispatch', async () => {
    await expect(cli.execute(parseArgv(['release']))).rejects.toThrow(
      'Command "release" not found',
    );
  });
  // …
});
```

`parseArgv` assembles the input from an array of strings by the same
rules as a run from the terminal. A command missing from `dispatch` is
not a failure value but an exception carrying its name: `execute` does
not build a request context in this case.

Questions are checked with the same `execute`, with substituted
streams. Answers are passed as ready strings, and `interactive: true`
turns the questions on explicitly: a substituted stream is not a
terminal.

```typescript
// examples/simple-cli/src/commands.spec.ts (fragment)
const cli = new CliTransport({
  mode: 'argv',
  argv: [],
  input: answers('2\n', 'y\n', '\n'),
  output: collecting(printed),
  interactive: true,
  converters: [zodConverter()],
});

await cli.serve(makeDispatch([Deploy]), new AbortController().signal);

const response = await cli.execute(parseArgv(['deploy']));

expect(response.value).toEqual({
  env: 'prod',
  host: 'localhost',
  forced: true,
});
```

```bash
yarn workspace @examples/simple-cli start:dev            # REPL
yarn workspace @examples/simple-cli test
```

The recipe [Dependencies by name and contributions collected from
modules](./token-families.md) shows DI token families: one recipe for
many dependencies.
