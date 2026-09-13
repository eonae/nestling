# @nestlingjs/logging

The Nestling logger interface and its standard implementation: four
levels, three call shapes for each, a child logger with bindings, and
output to `stderr` as text or JSON. The package has no dependencies — it
sits at the base of the tree, so a logging satellite takes the interface
from here without dragging in the kernel.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/container.md`](../../docs/en/design/container.md),
> the "The kernel logger" section.
> Guide: [chapter 9. See every request in the log](../../docs/en/guide/09-logging.md).

## Install

```bash
npm install @nestlingjs/logging
```

## Minimal example

```typescript
import { makeConsoleLogger } from '@nestlingjs/logging';

const logger = makeConsoleLogger({ level: 'info', format: 'json' });

logger.info('document written', { file, paths: 12 });
logger.child({ scope: 'openapi' }).warn(new Error('schema skipped'));
```

An application does not install this package: `@nestlingjs/app` depends on
it and re-exports both the types and the factory. It is installed by those
who need the interface without the kernel — an adapter of a third-party
logger and a script outside the application.

## Exports

| Name | What it is |
| --- | --- |
| `Logger` | the logger interface: `debug`, `info`, `warn`, `error`, `child` |
| `LogMethod` | a level method: three call shapes |
| `Fields` | record fields; the `err` key is reserved for the error |
| `LogLevel` | a record level: `debug`, `info`, `warn`, `error` |
| `LogThreshold` | a record threshold: a level or `silent` |
| `LogFormat` | a line format: `text` or `json` |
| `ConsoleLoggerOptions` | factory options: `level` and `format` |
| `makeConsoleLogger` | the standard logger; defaults `info` and `text` |
| `LogEntry` | a record ready to print: time, level, message, fields |
| `formatLine` | the line of a record in the chosen format |
| `serializeError` | an error as `name`, `message`, `stack`, `cause` fields |

The implementation class does not go out: the factory creates the logger.
The format, on the contrary, is public: both the standard logger and the
`@nestlingjs/logging.pino` satellite print with it, so the format has one
implementation.

## Package boundaries

The package describes what one writes with, and writes itself. The
`RootLogger$` and `Logger$` DI tokens, the `nestlingLog` config section
and the correlation field decorator live in `@nestlingjs/app`: they need
the container, the config and the request cell.
