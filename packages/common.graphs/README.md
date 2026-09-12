# @nestlingjs/common.graphs

A directed acyclic graph: adding nodes, traversal in topological and
reverse topological order, cycle detection. It is used by
`@nestlingjs/container` for the dependency graph and the lifecycle order.

> Internal Nestling package: arrives as a dependency of `@nestlingjs/container`, no need to install it separately.

## Install

The package is internal and arrives as a dependency of
`@nestlingjs/container`. There is no need to install it separately.

## Minimal example

```typescript
import { DAG } from '@nestlingjs/common.graphs';

interface Service {
  id: string;
  dependencies: readonly Service[];
}

const db: Service = { id: 'db', dependencies: [] };
const repo: Service = { id: 'repo', dependencies: [db] };

const graph = new DAG<Service>();
graph.addNode(db);
graph.addNode(repo);

// First `db`, then `repo`: the dependency comes before the dependent.
await graph.traverse((node) => console.log(node.id), {
  direction: 'topological',
});
```

## Exports

| Name | What it does |
|---|---|
| `DAG` | a graph of nodes: adding, lookup by `id`, traversal, cycle detection |
| `INode` | the node interface: `id` and the list of dependencies |
| `VisitOptions` | traversal parameters: a node filter and a direction |
| `VisitCallback` | the traversal callback; may return a promise |

## Package boundaries

The graph holds the nodes and the order between them. Instance creation,
dependency resolution and lifecycle hooks live in
`@nestlingjs/container`.
