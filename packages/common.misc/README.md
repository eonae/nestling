# @common/misc

Internal package: shared helpers used across Nestling packages
(the schema kernel, misc utilities). Not intended for standalone use.

## Schema types

The package owns the core's schema vocabulary, built on
[Standard Schema v1](https://standardschema.dev):

- `Schema` — alias for `StandardSchemaV1`; any conforming validator
  (zod ≥ 3.24, valibot ≥ 1.0, arktype, TypeBox, Effect Schema …) fits.
  The core never introspects a schema: the spec provides validation and
  inference only.
- `Infer<T>` — the schema's **output** type via
  `StandardSchemaV1.InferOutput`, or `undefined` when no schema is given.
- `DomainType<S>` — the same output type for a schema that is always given.
- `StandardSchemaV1` — re-exported, so a consumer declaring its own
  signature over `Schema` does not have to install `@standard-schema/spec`.

`@standard-schema/spec` is the package's only dependency and is types-only:
zero runtime bytes.

## The single point of validation

`validateSync(schema, value, message)` is the one place the core validates
anything: `parsePayload`/`parseMetadata`, the pipeline's `validate()` unit,
per-item validation of stream elements, transport fallbacks without a
pipeline, and config section fields all go through it, so the shape of a
failure is identical on every path.

- `assertStandardSchema(value)` — asserts the value implements the spec.
- `SchemaValidationError` — the value failed the schema; carries `issues`
  normalized at construction (`{ key }` segments unwrapped, symbols
  stringified, array indices kept numeric) so they are JSON-serializable.
- `AsyncSchemaNotSupportedError` — `~standard.validate` returned a Promise;
  deliberately **not** a subclass of `SchemaValidationError`, since an async
  refinement is a configuration error rather than bad input.
- `NotAStandardSchemaError` — the object passed as a schema has no
  `~standard` with `version: 1`.
- `normalizeIssues(issues)` — the normalization used by the error above,
  exposed for code that produces issues of its own.

**Why here and not in `@nestling/pipeline`.** Configuration is read and
validated before a request exists, so `@nestling/config` needs the validator
without needing the request pipeline; an arrow from config to pipeline would
invert the order of lifecycle phases. `@nestling/pipeline` re-exports all of
the above from its `./schema`, so the public API of that package is unchanged.
