# @nestlingjs/common.static-server

A static file server on `node:http` with no external dependencies:
serves a directory over HTTP, sets the MIME type by extension and closes
on a signal. It is used by `@nestlingjs/viz` to serve the visualization
frontend, and by the documentation build to serve the page tree.

> Internal Nestling package: arrives as a dependency of `@nestlingjs/viz`, no need to install it separately.

## Install

The package is internal and arrives as a dependency of
`@nestlingjs/viz`. There is no need to install it separately.

## Minimal example

```typescript
import { StaticServer } from '@nestlingjs/common.static-server';

const server = new StaticServer({
  port: 3333,
  staticDir: new URL('./public', import.meta.url).pathname,
  disableCache: true,
});

await server.start();
```

## Exports

| Name | What it does |
|---|---|
| `StaticServer` | serves the files of a directory over HTTP; `start()` and `stop()` |

The constructor options — the port, the directory, the headers, the
default file and the shutdown timeout — are inferred from the object at
the call site; they have no separate name.

## Package boundaries

The server serves files from disk. It has no routing, templates,
compression or HTTPS: an application on Nestling is served by
`@nestlingjs/transport.http`.
