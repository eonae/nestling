# @common/misc

Internal package: shared helpers used across Nestling packages
(schema types, misc utilities). Not intended for standalone use.

## Schema types

The package owns the core's schema vocabulary, built on
[Standard Schema v1](https://standardschema.dev):

- `Schema` — alias for `StandardSchemaV1`; any conforming validator
  (zod ≥ 3.24, valibot ≥ 1.0, arktype, TypeBox, Effect Schema …) fits.
  The core never introspects a schema: the spec provides validation and
  inference only.
- `Infer<T>` — the schema's **output** type via
  `StandardSchemaV1.InferOutput`, or `undefined` when no schema is given.
- `StandardSchemaV1` — re-exported, so a consumer declaring its own
  signature over `Schema` does not have to install `@standard-schema/spec`.

`@standard-schema/spec` is the package's only dependency and is types-only:
zero runtime bytes.
