# @nestlingjs/viz

An interactive visualization of the container's dependency graph in the
browser. The command brings up a local server and draws the modules and
the providers as a force-directed graph.

> 🚧 Active development, the API may change. Not yet published to the
> registry: install it from the repository.
> Design: [`docs/en/design/container.md`](../../docs/en/design/container.md).
> Guide: [recipe "Without `makeApp`"](../../docs/en/recipes/standalone.md).

## Install

```bash
npm install --save-dev @nestlingjs/viz
```

## Minimal example

The graph is exported from the assembled container:
`await container.toJSON()` is written to a file. Then the file is opened
with the command:

```bash
nestling-viz di-metadata.json --port 4000
```

## Exports

The package is installed for the `nestling-viz` command; it has no
barrel to import.

| Command option | What it does |
|---|---|
| `-p, --port <number>` | the server port; `3333` by default |
| `--no-open` | do not open the browser |
| `-s, --silent` | do not print messages to the console |

A working example: the `graph` and `visualize` scripts in
[`examples/modular-app`](../../examples/modular-app/).

## Package boundaries

The tool only shows the graph: it does not check it and does not change
it. The container assembly does the checking of the graph.
