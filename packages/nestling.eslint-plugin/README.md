# @nestling/eslint-plugin

Editor feedback for Nestling endpoint declarations. One rule so far:
`endpoint-has-layer` — "this handle does not seem to compose the layer your
application requires".

> 🚧 Active development, API may change. **This plugin is a hint, not a
> guarantee.** The guarantee is the policy check on the assembled graph:
> `assemble({ policies: [everyEndpoint({ … }).hasLayer(authedBase)] })`.
> A handle the rule stays silent about is still checked there — see
> [`docs/design/pipeline.md`](../../docs/design/pipeline.md) §7.

The package has **no runtime `@nestling/*` dependency**: the rule is purely
syntactic.

## Install and configure

```javascript
// eslint.config.js
import nestling from '@nestling/eslint-plugin';

export default [
  {
    files: ['src/**/*.ts'],
    plugins: { '@nestling': nestling },
    rules: {
      '@nestling/endpoint-has-layer': [
        'warn',
        {
          layer: 'authedBase',            // name of the imported layer binding
          constructorName: 'httpEndpoint', // which declaration constructor to look at
          pattern: '^/admin',              // optional filter over the literal `path`
        },
      ],
    },
  },
];
```

`warn` is the recommended severity, deliberately. The rule is incomplete by
design, and a red CI would suggest a guarantee it cannot give.

> The option is called `constructorName`, not `constructor`: a property with
> that name in a rule's JSON schema breaks config validation in ESLint 9
> (`Object.prototype.constructor` gets shadowed and every configuration of the
> rule is rejected).

## What the rule sees — and where it stays silent

The rule reads **literal** declarations only. It reports when the requirement
is plainly unmet, and says nothing whenever the value of `pipeline:` is
syntactically opaque — a false positive on legal code is worse than a miss,
because a missed case is caught by the graph policy anyway.

| Code | Verdict |
|---|---|
| `pipeline: authedBase` | silent — layer present |
| `pipeline: compose(observability, authedBase)` | silent |
| `pipeline: compose(base, authedBase.pre(withTenant()))` | silent — derivation keeps its predecessor |
| `const p = compose(base, authedBase); … pipeline: p` | silent — local binding is resolved |
| `pipeline: compose(observability, logging)` | **reported** |
| declaration without `pipeline:` | **reported** |
| `(pipeline) => httpEndpoint({ …, pipeline })` | silent — factory parameter is opaque |
| `pipeline: pipelineFor('users')` | silent — unknown call |
| `import { base } from './pipelines.js'; … pipeline: base` | silent — no local declaration |
| `httpEndpoint({ …, ...common })` | silent — spread hides the dictionary |
| `httpEndpoint({ …, detached: 'liveness probe' })` | silent — deliberate opt-out |

Type-aware analysis is a non-goal: types do not undo factories and
parameters, so it would cost CI time without buying a guarantee.

## Exports

- default export — the plugin object (`meta`, `rules`)
- `endpointHasLayer` — the rule module, if you wire rules by hand
