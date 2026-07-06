# @nestling/viz

Interactive 3D visualization of your DI dependency graph. Export the graph
with `container.toJSON()`, then explore modules and providers as a
force-directed graph in the browser:

```bash
nestling-viz di-metadata.json
```

See a working setup in
[`examples.simple-app`](../examples.simple-app/) (`export-metadata`
and `visualize` scripts).
