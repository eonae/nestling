# @nestlingjs/eslint-plugin

Five ESLint rules for Nestling code: a module boundary by the barrel
file, the form of a conditional spread into an object literal, a ban on
the process globals, a hint about the layer in an endpoint declaration,
and a class dependency list checked against the constructor parameters.
The rules parse the syntax and the file structure, so the
`@nestlingjs/*` runtime is not among the dependencies.

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
      '@nestlingjs/conditional-spread': 'error',
      '@nestlingjs/no-process-globals': 'error',
      '@nestlingjs/endpoint-has-layer': [
        'warn',
        { layer: 'traced', constructorName: 'httpEndpoint' },
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
| `conditionalSpread` | the `conditional-spread` rule: a conditional spread into an object literal is written with `&&` and an explicit comparison. An autofix rewrites the ternary with an empty literal (`...(test ? obj : {})`) — but only when the resulting test is boolean by shape; otherwise the choice of comparison stays with the author. A spread `...(x && obj)` with `x` non-boolean by shape reports the trap of zero and the empty string and offers `x !== undefined` as a suggestion. The check is complete for the shape it parses, level `error` |
| `noProcessGlobals` | the `no-process-globals` rule: a read of `process.env` and `process.argv` in the source. The environment reaches the application through an `env()` source, the command line through the `argv()` marker, and one form is allowed — `process.argv` as an immediate argument of the marker. A named import of `env` or `argv` from `node:process` is the same error. The check is complete for the direct form, level `error` |
| `endpointHasLayer` | the `endpoint-has-layer` rule: an endpoint declaration does not connect the required layer. The check is incomplete by design, level `warn` |
| `dependencyList` | the `dependency-list` rule: the list of `@Component([…])`, `@Handler([…])` or `@Resource([…])` diverges from the constructor parameters (for a resource, from `static acquire` without the signal). The expected DI token is derived from the parameter type: a class `X` gives `X`, `Config<typeof X>` gives `X`, `Port<typeof Op>` gives `Op.caller`, `Emitter<typeof Op>` gives `Op.emitter`, a type `X` with `X$` visible in the file gives `X$` (for `Logger` this is `Logger$.auto`), an array `X[]` with `X$` visible gives `X$.all`. Other types are accepted as written, and the rule does not write names absent from the file. An autofix repairs a length mismatch, a suggestion offers an element replacement. The check is incomplete by design, level `warn` |

The plugin also exports a default object with all the rules — it is
the one connected in `plugins`.

## Package boundaries

The rules read the source and do not run the application.
`app.build()` checks the invariants visible only at container
build. `conditional-spread` looks only at a spread inside an object
literal: in an array the same replacement breaks the code, because an
array spread requires an iterable. It decides that a test is boolean by
the shape of the expression, not by its type, so the identifier `ready`
is not boolean even when its type is `boolean`. `no-process-globals`
does not catch a read through an intermediate variable
(`const p = process; p.env`): it closes the accidental form, not every
possible one. A legitimate read is silenced by an `eslint-disable` that
states the reason in the file itself. `dependency-list` tells a class from an interface by the
form of the import: an interface imported as a value instead of
`import type` is treated as a class. It does not tell a family from a
DI token and accepts any DI token with the same head.
