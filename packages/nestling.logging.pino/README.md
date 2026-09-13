# @nestlingjs/logging.pino

pino under the `Logger` interface: the redaction, serializers and sampling
of the library with the line format shared with the standard Nestling
logger. Records go to `stderr`, one line each.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/composition.md`](../../docs/en/design/composition.md),
> the "The logger" section.
> Guide: [chapter 9. See every request in the log](../../docs/en/guide/09-logging.md).

## Install

```bash
npm install @nestlingjs/logging.pino pino
```

`pino` is a peer dependency: the application picks the version of the
library, and there must be no second copy of pino in the tree. The range
is a single major — `^10.0.0`: the redaction, the serializers and the
plugins of the ecosystem live around it.

## Minimal example

```typescript
import { makeApp } from '@nestlingjs/app';
import { pinoLogger } from '@nestlingjs/logging.pino';

export const app = makeApp({
  features: [UsersFeature],
  transports: [http()],
  logging: {
    logger: pinoLogger({
      format: 'json',
      pino: { redact: ['password'] },
    }),
  },
});
```

The correlation fields are set by the kernel: `requestId` and `traceId`
come into the records on their own, the adapter does not need to know
about them. The same call is taken by a script outside the application — a
migration, a document generator, a standalone dispatch.

## Exports

| Name | What it is |
| --- | --- |
| `pinoLogger` | the logger over pino; defaults `info` and `text` |
| `PinoLoggerOptions` | the options: `level`, `format` and `pino` |

The `level` threshold takes the four levels of the interface, `silent` and
two levels of pino: `trace` maps to `debug`, `fatal` to `error`. The
`format` is `text` or `json`. The `pino` field passes the rest to the
library.

The `level`, `timestamp`, `formatters`, `base`, `messageKey`, `errorKey`
and `transport` keys and the nested `serializers.err` belong to the
adapter: they are what the record format rests on. An owned key in the
`pino` field is a refusal naming the key and its replacement.

## Package boundaries

The package has one dependency — `@nestlingjs/logging`: the adapter needs
the interface, not the composition root. The `text` format is printed by
`formatLine` from there, so the line matches the standard logger byte for
byte. The `json` format is written by pino itself: the same set of keys,
its own order.

`pino-pretty`, `pino.transport`, multistream, files and rotation are not
part of the package. Records go to `stderr` through a single synchronous
writer: a worker thread does not bundle into one file and loses lines on a
crash. Collecting the output of the process is the job of whoever runs it.
