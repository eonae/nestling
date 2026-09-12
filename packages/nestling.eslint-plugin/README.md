# @nestlingjs/eslint-plugin

Three ESLint rules for Nestling code: a module boundary by the barrel
file, a hint about the layer in an endpoint declaration, and a class
dependency list checked against the constructor parameters. The rules
parse the syntax and the file structure, so the `@nestlingjs/*` runtime
is not among the dependencies.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/pipeline.md`](../../docs/en/design/pipeline.md),
> [`docs/en/design/container.md`](../../docs/en/design/container.md).
> Guide: [chapter 6. Where the handler gets the repository from](../../docs/en/guide/06-repository.md),
> [chapter 10. Who calls and what they are allowed to do](../../docs/en/guide/10-auth.md).

## Install

```bash
npm install --save-dev @nestlingjs/eslint-plugin
```

`@typescript-eslint/parser` parses the `*.ts` files: the
`endpoint-has-layer` and `dependency-list` rules read its tree. The
`typescript-eslint` package is installed alongside.

## Minimal example

```javascript
// eslint.config.js
import nestling from '@nestlingjs/eslint-plugin';
import tseslint from 'typescript-eslint';

export default [
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    plugins: { '@nestlingjs': nestling },
    rules: {
      '@nestlingjs/import-through-barrel': 'error',
      '@nestlingjs/endpoint-has-layer': [
        'warn',
        { layer: 'observability', constructorName: 'httpEndpoint' },
      ],
      '@nestlingjs/dependency-list': 'warn',
    },
  },
];
```

The `constructorName` option names the head of the call. The rule
parses two forms: the identifier itself (`cliEndpoint(…)`) and a
reference to its property (`httpEndpoint.get(…)`,
`httpEndpoint.implement(…)`). It takes the dictionary from the last
argument, so both `httpEndpoint.get('/users', { … })` and
`httpEndpoint.implement(CreateUser, { … })` fall under the rule. A
declaration with `detached: '<reason>'` is not flagged.

The optional `pattern` is checked against the first argument of the
call, when that argument is a string literal. The first argument of
`httpEndpoint.implement` is an operation, so the rule stays silent on
it with a filter: an address that is opaque syntactically cannot be
matched against a filter.

## Exports

| Name | What it does |
|---|---|
| `importThroughBarrel` | the `import-through-barrel` rule: an import into a foreign module past its barrel. A folder without `index.ts` does not count as a boundary, and the rule stays silent about it. The check is complete, level `error` |
| `endpointHasLayer` | the `endpoint-has-layer` rule: an endpoint declaration does not connect the required layer. The check is incomplete by design, level `warn` |
| `dependencyList` | the `dependency-list` rule: the list of `@Component([…])`, `@Handler([…])` or `@Resource([…])` diverges from the constructor parameters (for a resource, from `static acquire` without the signal). The expected DI token is derived from the parameter type: a class `X` gives `X`, `Config<typeof X>` gives `X`, `Port<typeof Op>` gives `Op.caller`, `Emitter<typeof Op>` gives `Op.emitter`, a type `X` with `X$` visible in the file gives `X$` (for `Logger` this is `Logger$.auto`), an array `X[]` with `X$` visible gives `X$.all`. Other types are accepted as written, and the rule does not write names absent from the file. An autofix repairs a length mismatch, a suggestion offers an element replacement. The check is incomplete by design, level `warn` |

The plugin also exports a default object with all the rules — it is
the one connected in `plugins`.

## Package boundaries

The rules read the source and do not run the application.
`app.assemble()` checks the invariants visible only at container
assembly. `dependency-list` tells a class from an interface by the
form of the import: an interface imported as a value instead of
`import type` is treated as a class. It does not distinguish a family
member from a DI token and accepts any member with the same head.
