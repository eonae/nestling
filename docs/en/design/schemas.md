# Schemas: Standard Schema and generated documentation

> **Target state of V1.** Decision logic: entries
> [ideas.md](../../decisions/ideas.md):
> `[2026-07-13] Схемы: Standard Schema вместо привязки к zod; OpenAPI через явные конвертеры`,
> `[2026-08-29] Стиль документации: правила, глоссарий, перенос обоснований из design/`,
> `[2026-08-29] Проверка входа по input: обязанность рантайма, точка после .pre-юнитов`,
> `[2026-09-06] Документ OpenAPI без запуска: buildOpenApiDocument(app, args)`,
> `[2026-09-06] Конфиг: derived, env({ prefix }), описания полей через конвертеры`,
> `[2026-09-13] Схемы: Standard Schema на границе, zod внутри; один пакет schema.zod`.
> Implementation status: [roadmap](../../decisions/roadmap.md).

## 1. The kernel accepts Standard Schema

At every boundary that needs a schema, the kernel accepts
`StandardSchemaV1` ([standardschema.dev](https://standardschema.dev)).
This is the shared interface of zod, valibot, arktype, Effect Schema
and TypeBox: one `~standard` property with a `validate(value)` function
that returns `{ value }` or `{ issues }`, plus phantom types for type
inference.

Validation runs through `~standard.validate`, types are inferred
through `InferOutput`. The user chooses and installs the validator:
zod, `zod/mini`, valibot, arktype. The public types of the kernel name
no validator.

Inside the framework, there is one validator: zod. The schemas the
framework itself writes (the configuration sections of packages, the
records of facts, the field helpers) are written in it, and the packages
that need JSON Schema take the zod converter by default (§2). For an
application this is an implementation choice, not a requirement: an
application on another validator assembles and works, and passes its own
converter wherever a document is needed.

**The boundary runs along the public API.** No exported type, parameter
or return value of the framework packages names a validator; the one
exception is named by the name of the package —
`@nestlingjs/schema.zod`. The dependency of a package on zod is visible
to the application only as a line in `node_modules`, whereas a vendor in
a **type** would take away its choice of its own validator. So a schema
the framework writes and that goes into a public type (the record of a
fact) is declared with the neutral type
`StandardSchemaV1<unknown, T>`: the value stays a zod schema and is
translated by the usual converter, while the type names no vendor. The
check is mechanical: `yarn verify` lists the barrel exports of every
published package and looks for the name of a validator in their types.

**One point of validation.** Every validation in the kernel goes
through one function, `validateSync(schema, value, message)`:
`parsePayload`, `parseMetadata`, the input check of an endpoint by the
pipeline runtime, the per-item check of stream items and the check of
configuration section fields. There are no direct calls to
`schema.parse(...)` and no duck typing of the `{ parse(data): T }`
shape in the kernel, so the shape of a failure is the same on every
path. Transports have no validation branch of their own: the transport
assembles the value, the runtime checks it.

`SchemaValidationError` carries `issues` in the standard format
`{ message, path? }[]`. The format is guaranteed by the specification,
not by a vendor; the error types of a validator do not reach the
public API. The path is normalized when the error is created: an
object segment `{ key }` becomes `key`, a symbol becomes a string, a
numeric index stays a number. `issues` go into the body of the
response, and their JSON shape does not depend on the vendor.

If `validate` returns a Promise (asynchronous refinements), the
synchronous pipeline gives an error rather than letting the value
through.

**The client validates the response with the same schema.**
`makeClient` checks the body of a successful response against the
`output` shape of the operation through `~standard.validate`. The
check is on by default and is turned off explicitly:
`validateOutput: false`. Synchrony is mandatory here too. The outcome
differs from the server: a validation failure is not thrown, it
becomes an `InternalError` with `issues` in `cause`, because the
client throws no exceptions on operation failures
([operations.md](./operations.md)). Here too the consumer brings the
validator: `@nestlingjs/operations` knows only the `~standard` of the
schema.

**A configuration error and an input error are different classes.** An
asynchronous schema gives `AsyncSchemaNotSupportedError`; an object
that does not implement the specification (usually a validator older
than zod 3.24 or valibot 1.0) gives `NotAStandardSchemaError`. Neither
class inherits from `SchemaValidationError`: these are errors of the
application's author, not of the requester, and the transport answers
them with 500, not 400.

**There is no introspection.** The specification covers only
validation and type inference; at runtime the schema is opaque. So
everything that needs to know the structure of a schema is declared
explicitly, with no peeking inside a vendor's objects: the placement
of a field is a mark next to the schema (`bind: { expand: query() }`,
[endpoints.md](./endpoints.md)), a configuration section is a record
of fields ([config.md](./config.md)), JSON Schema comes through the
vendor converters (§2).

Opacity is a property of the runtime; at the type level the keys of a
schema are known (`InferInput<I>`). This is used everywhere it can be:
the keys of `bind` are typed by the fields of the schema, and the
compiler catches a typo, even though the runtime does not know the
same keys. The kernel has no check that needs the list of keys at
runtime.

## 2. Schema converters

Validation and describing a schema to the outside are separate. The
kernel runtime knows only `~standard.validate`; JSON Schema is needed
by whoever publishes the description of the API.

A converter is the public interface of the schema layer:
`SchemaDocConverter { vendor; toJsonSchema(schema, options?) }`.
Dispatch runs on the `~standard.vendor` of the schema. The kernel does
not branch on the vendor and does not introspect a schema. A consumer
of JSON Schema holds the zod converter by default and accepts a
`converters` list that adds converters for other vendors or replaces
the zod converter. There is no global registry. Two converters with
the same `vendor` in the list is an error at the point they are
passed.

`options` carries one hint: `io: 'input' | 'output'`. A schema with a
transform describes two shapes: what arrives over the network and what
the handler gets. The request body is described by the first shape,
the response body by the second. The hint is optional on both sides: a
converter may ignore it, and a consumer that does not care about the
direction (a snapshot compares a shape with itself) may not pass it.

**The `jsonSchema(schema, json)` annotation.** This is a way to set the
JSON Schema of one leaf by hand. The annotation returns a value that
inherits the `~standard` of the source schema: it validates exactly
the same way and fits into any schema position — `input`, `output`,
the leaf of a streaming shape, the `fields` of a `multipart` shape,
the `details` of a failure definition. The dispatcher reads the
annotation before a converter, so an annotated leaf converts
regardless of the list of converters. The schemas of the kernel itself
are declared through the same mechanism: the `details` of the kernel
failures are written by hand, and no converter knows the `nestling`
vendor. The passed schema is not mutated; there is no global registry
of annotations.

The dispatcher lives in `@nestlingjs/operations`, next to the
`jsonSchema` annotation, which it reads as the first source. The
request package does not fit it: the configuration snapshot is built
before a request exists, and the configuration layer does not look
into the pipeline layer. `@nestlingjs/app` re-exports its names, so
the consumer imports them from the same place as before.

**Three consumers.** The dispatcher returns "no converter" as a
separate outcome, and it is the consumer that decides what to do with
it:

| Consumer | No converter for the vendor |
|---|---|
| documentation generation (§2.1) | an error at start: there are no undocumentable endpoints |
| the snapshot of operations ([operations.md](./operations.md) §1) | the leaf is opaque, verdict `unknown` |
| `describeConfig({ converters })` ([config.md §8](./config.md)) | the `unconvertible` outcome in the description of the key: there is no JSON Schema, and this differs from "the field has no description" |

A converter is the only place that knows the internals of a particular
validator. It is written in ten lines on top of the validator's own
converter (`z.toJSONSchema()` and its counterparts).

Everything the framework does with zod lives in one package,
`@nestlingjs/schema.zod`: the `zodConverter()` converter, the converter
list resolution `withZodDefault()`, the section field helpers `int()` and
`flag()` — open builders the caller extends with bounds and a default
(`int().min(1).default(500)`) — and the `makeModel`, `fromScratch` and
`fromType` models, which check a schema against an existing TypeScript
type.

The default is substituted by the consumer itself —
`withZodDefault(converters)` at the point where it reads the caller's
list. The function appends `zodConverter()` to the list and skips that
step if a converter for the `zod` vendor is already there. Hence both
halves of the promise: the list **adds** a converter for another vendor
without losing zod, and **replaces** the zod converter with its own. An
empty list and no list at all give the same result.

### 2.1. OpenAPI: an opt-in module

```typescript
openapi({ info: { title: 'My API', version: '1.0.0' }, pipeline: observability })
```

The document is needed in two modes — served by an endpoint, and
sitting as a file among the build artifacts. One value serves both, so
the package has two surfaces. The third row of the table belongs to
`@nestlingjs/app`: it is the entry point through which the build mode
gets the composition of the application.

| Surface | What it does |
|---|---|
| `openapi(options)` | the publisher plugin: it builds the document on phase 1 ASSEMBLE and serves it through an endpoint (`GET /openapi.json`). Its own `document(discovery)` method builds the document from the result of `app.discover(args)` — with no container, no transports and no running application |
| `OpenApiDocument$` | the DI token of the ready document; the endpoint is a way to serve it, not the place where it comes into being |
| `app.discover(args?)` | the input of the generator: phase 0 of the declaration gives out the composition by value, with no graph and no sources. The document for the artifacts is built with the same assembly argument that starts the process ([composition.md](./composition.md)) |

- `@nestlingjs/openapi` accepts the same `SchemaDocConverter` as the
  snapshot of operations, and introduces no type of its own. It takes
  the zod converter from `@nestlingjs/schema.zod` by default; its
  public types do not mention zod.
- A converter for another validator is a separate package, built on
  the pattern of `schema.zod`; the major versions of a converter
  follow the major versions of the validator.
- The document is built by a provider factory on phase ASSEMBLE. Any
  diagnostic fails the assembly before INIT and before the socket
  opens. There is no lazy build. The check is exhaustive: the
  violations of every endpoint are gathered into one message.
- `openapi(...)` returns an ordinary plugin value with parameters; the
  plugin role brings in no new primitives. The `path`, `pipeline` and
  `detached` options let you apply the same root policies to the
  document endpoint as to the other HTTP endpoints.
- The method and the provider factory call one internal function: the
  document from the build artifacts and the document served by
  `GET /openapi.json` coincide by construction. The method works even
  when the plugin never made it into the composition: the value lives in
  the declaration, and the switch branch (`Docs.when(…)`) decides only
  the fate of the endpoint. The document for a contour with the
  documentation turned off is built by the same call.
- The module reads the composition of the application from
  `Discovery$` ([composition.md](./composition.md)): this way it sees
  the selected topology with no duplication of `select`. The CI script
  takes the same composition from `app.discover(args)`, and the
  document options come from the plugin itself: `info` is written once.
- Besides JSON Schema, the document is assembled from the
  declarations: the `doc:` slot (§2.2); `errors:` become `responses`,
  with `InternalError` as the default response
  ([errors.md](./errors.md)); io shapes decide the media types
  ([endpoints.md](./endpoints.md)); the bind map splits `parameter`
  from `requestBody`; the status is translated into an HTTP code by
  the same table as the transport.
- A parameter is described by the parsed shape of the field, when it
  is scalar. The `input` schema is converted twice: the `io: 'input'`
  pass gives the body and the required parameters, the `io: 'output'`
  pass gives the parameter schemas. The property is taken from the
  second shape when the first one carries `type: 'string'` and the
  second carries `boolean`, `number` or `integer`; it is carried over
  whole, together with `description`, `default` and the constraints.
  So `dryRun: z.stringbool()` in the query lands in the document as a
  boolean parameter, while staying a string in the body schema. The
  second pass runs only for endpoints that move at least one field
  into the path or the query. A failure of the second pass gives no
  diagnostic: a schema with a `transform` cannot be represented in the
  `output` direction, and the parameters of such an endpoint are
  described by the input shape.
- Two diagnostics live in the generator: a path parameter with no
  matching property in the schema, and a `bind` mark on a field that
  does not exist. Both need the structure of the schema, which only a
  converter gives.

AsyncAPI for `command`, `event` and streaming shapes is built by the
same mechanism and reads the same `doc` slot.

### 2.2. The `doc:` slot — what the schemas do not carry

```typescript
interface DeclarationDoc {
  summary?: string;
  description?: string;
  tags?: readonly string[];
  deprecated?: boolean;
  status?: SuccessStatus;   // successful response; default ok, no_content with no output
  hidden?: string;          // do not document — only with a reason
}
```

The slot lives at the level of the kernel, in `EndpointOptions` and
`OperationSpec`, and does not depend on the transport. The kernel
carries it and does not interpret it, the same as `binding`. The slot
also does not depend on the format of the document: the AsyncAPI
generator reads the same slot, so it has no `operationId`,
`externalDocs` or `servers` fields.

- `operationId` is derived: the name of the operation, if the
  declaration serves an operation, otherwise a deterministic slug from
  the method and the path (`get_api_users_id`). It cannot be declared
  by hand: an unknown field of the section is rejected when the
  declaration is created.
- `tags` are not derived from the name of a module. No `doc.tags`
  means no tags.
- `hidden` accepts only a string with a reason, like `detached`. A
  hidden endpoint drops out of both the document and the schema check.
  The module prints the list of hidden endpoints at start; it does not
  go into the document.
- In an operation implementation, `doc` belongs to the operation on a
  par with `input`, `output` and `errors`: two implementations of the
  same operation describe it the same way.

The section is checked when the value is created. A non-string, `tags`
not shaped as an array of strings, a status outside the list of
successful ones, `hidden: true` and an unknown field all give an error
at declaration, not at the assembly of the application.
