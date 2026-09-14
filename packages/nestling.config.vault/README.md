# @nestlingjs/config.vault

A config source on top of HashiCorp Vault: a KV v2 secret is read with a
single request in phase 0, and the coordinates of the storage come from
another source — from `.env`, for example.

> 🚧 Active development, the API may change.
> Design: [`docs/en/design/config.md`](../../docs/en/design/config.md).
> Recipe: [config sources](../../docs/en/recipes/config-sources.md).

## Install

```bash
npm install @nestlingjs/config.vault
```

The package takes no Vault client: the request goes through the standard
`fetch`, so the dependencies are the core and `zod`.

## Minimal example

```typescript
import { bind, defaultSources, makeApp } from '@nestlingjs/app';
import { vault, VaultConfig } from '@nestlingjs/config.vault';

export const app = makeApp({
  features: [OrdersFeature],
  transports: [http()],
});

await app.build().run({
  config: [
    bind(vault(VaultConfig, { retries: 2 }), { timeout: 3000 }),
    ...defaultSources,
  ],
});
```

The order of the list is the priority of key resolution: the value from
Vault beats the value from the environment. The order of raising is
another one and follows on its own: `VAULT_ADDR` and `VAULT_TOKEN` are
named by the `VaultConfig` section, so Vault is raised after `env()` and
`dotenv('.env')`, which cover those keys.

## Exports

| Name | What it is |
| --- | --- |
| `vault` | the source: the section of coordinates first, options second |
| `VaultConfig` | the ready section of coordinates with the `vault` prefix |
| `VaultCoordinates` | the shape of values `vault(section)` requires |
| `VaultOptions` | the options of the source: `retries` |

The `VaultConfig` section declares `VAULT_ADDR`, `VAULT_TOKEN`
(`secret()`), `VAULT_MOUNT` (defaults to `secret`) and `VAULT_PATH`. An
application with two storages declares its own section of any shape that
fits `VaultCoordinates` and passes it as the same argument: the keys take
its prefix.

`retries` is the number of extra attempts on a network failure and on a
`5xx` answer; the pause starts at 250 ms and doubles. Answers `401`, `403`
and `404` cause no retry. The time limit of raising is set by the binding
with the `timeout` option.

## Package boundaries

There is one way to authenticate — the `X-Vault-Token` header. AppRole,
Kubernetes and AWS are not in the package: the minimal source goes with a
token it already has, and the way to get it stays with the environment.

There is no watching of the secret: the value is read once in phase 0 and
lives in the snapshot, like the value of any source. Dynamic secrets and
lease renewal are not supported — a rotated secret reaches the process on
a restart.

One engine is read — KV v2 at the `{mount}/data/{path}` path. A KV v1
answer fails the raise: it carries no `data.data` record.
