# 21. Do not break the neighbours when an operation changes

> Guide to the current API; verified against `4a206018`.
> Target description: [design/operations.md](../design/operations.md) §1.6 and
> §1.7. Why: entry [ideas.md](../../decisions/ideas.md)
> `[2026-07-31] Версионирование контрактов: снапшот, вердикт по слоту, третий вердикт unknown`.

Features are spread across teams and processes. The schema of
`notifications.check-address` changes in one repository, and the process that calls it
deploys separately. An incompatible change to an operation needs to be
caught in CI, before the deployment, with a clear answer for what to do
about it.

An operation has no separate version field. An incompatible version
gets a new name: `notifications.check-address.v2`. The operation's name serves as the
address on the bus, so the old and the new versions can work side by
side while the consumers move to the new one. The framework neither
requires nor parses the `.vN` suffix, and a name with no version is
allowed.

## The snapshot of the build's operations

```typescript
// src/operations.compat.spec.ts
const checked = makeApp({
  features: app.spec.features,
  plugins: app.spec.plugins,
  switches: app.spec.switches,
  policies: app.spec.policies,
  transports: app.spec.transports,
});

/** The deployment variants: the snapshot unions what each one publishes */
const TOPOLOGIES = [
  'all',
  { features: 'users', includeDeps: true },
  'ops',
] as const;

const BASELINE_PATH = new URL('../operations.snapshot.json', import.meta.url);

/** The baseline is an ordinary file in the repository */
const readBaseline = (): OperationSnapshot =>
  JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as OperationSnapshot;

/** The current composition of operations: the topology matrix reduced to a snapshot */
const currentSnapshot = async (): Promise<OperationSnapshot> =>
  snapshotOperations(
    await checkTopologies(checked, [...TOPOLOGIES], {
      converters: [zodConverter()],
      // Secrets from an object: `check()` builds the graph and reads
      // the configuration section, and it accepts no overrides
      config: [
        bind(vars({ API_TOKEN: 'test-token', WEBHOOK_SECRET: 'test-hook' }), {
          keys: appConfigKeys,
        }),
      ],
    }),
  );
```

`checked` is the same application declaration as in chapter
[19](./19-select.md): the secrets are bound by the `config` option of
`checkTopologies()`, because `check()` builds the graph and reads the
configuration section, and it accepts no overrides. The source of the
descriptions is the `check()` report of every topology from the same
chapter: it contains the `operations` field with descriptors of the
published operations. A descriptor describes the name, the kind, the
`input` and `output` shapes, and the list of failures with their codes
and categories. A vendor converter translates the leaf schemas into
JSON Schema — the same `zodConverter` the document generator from
chapter [13](./13-openapi-and-client.md) substitutes by default. Here
there is no default: `checkTopologies` takes the list explicitly,
because the structural check lives in the kernel and the converter lives
outside it. With no converter a leaf is marked opaque, and a comparison
against it gives the `unknown` verdict.

`snapshotOperations(reports)` reduces the matrix into one snapshot by
union. The snapshot is built from discovery, that is, from the
implementations that a topology publishes: an operation that is
declared but implemented in no topology does not land in the snapshot.
Every published operation remembers which topologies published it:

```json
// operations.snapshot.json (fragment)
{
  "snapshotVersion": 1,
  "operations": [
    {
      "name": "notifications.check-address",
      "kind": "request",
      "input": {
        "kind": "value",
        "leaf": {
          "leaf": "schema",
          "vendor": "zod",
          "jsonSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "additionalProperties": false,
            "properties": {
              "email": {
                "type": "string"
              }
            },
            "required": [
              "email"
            ],
            "type": "object"
          }
        }
      },
```

The union matters for the matrix: an operation that is not in the
`ops` topology belongs to an unselected feature, it was not removed.
The `topologies` field of `notifications.check-address` contains `all` and `users`,
and that of `subscriptions.opened` only `all` and `ops`.

The snapshot lies in the repository as an ordinary file.
`serializeSnapshot` gives a deterministic output: the operations by
name, the failures by code, the JSON Schema keys sorted. The same
graph gives byte for byte the same file, so a mismatch between the
file and the build means a change to the operations, not to the
serialization order.

## Comparison against the baseline and verdicts

```typescript
// src/operations.compat.spec.ts
  it('текущая сборка совпадает с опубликованным снапшотом', async () => {
    const current = await currentSnapshot();

    if (process.env.UPDATE_SNAPSHOT) {
      writeFileSync(BASELINE_PATH, serializeSnapshot(current));
    }

    const report = diffOperations(readBaseline(), current);
    console.log(formatCompatibility(report));

    // This is the test's own check, not the framework's: a deliberate
    // breaking change is made by renaming the operation and rewriting
    // the snapshot
    expect(report.breaking).toEqual([]);
    expect(report.additive).toEqual([]);
    expect(report.unknown).toEqual([]);

    // The snapshot is deterministic: the file equals the build
    // byte for byte
    expect(serializeSnapshot(current)).toBe(
      readFileSync(BASELINE_PATH, 'utf8'),
    );
  });
```

`diffOperations(baseline, current)` compares two snapshots and gives
every difference exactly one verdict. The report contains the
`breaking`, `additive` and `unknown` lists with the operation's name,
the JSON path and a description, plus a summary by operation.
`formatCompatibility(report)` prints the report for a person:

```
Operation compatibility: 0 breaking, 0 additive, 0 unknown
```

`diffOperations` takes no part in the build and throws no exception
because of the comparison's result, except for one case: a baseline
with an unknown `snapshotVersion` is an error of the check's author.
What counts as a test failure is the test's own decision: here any
difference fails it, including `additive`, so that every change to an
operation lands in the snapshot deliberately.

The verdict depends on the slot. The `input` schema describes what
arrives at the implementation, so narrowing what it accepts breaks the
callers: a new required property, a removed property, a narrower type.
The `output` schema describes what the implementation promises, so
weakening the promise breaks the callers: a removed property, a move
from `required` to `optional`. Everything the rules do not cover gets
`unknown`: unfamiliar JSON Schema keywords, `oneOf` and `$ref`, a
change of vendor, an opaque leaf. `unknown` does not mean "compatible"
and is not passed over as compatible.

The file's third test edits the baseline, not the code: it adds the
required field `reservedUntil` to the `output` of the `notifications.check-address`
operation. This is what the snapshot would look like before the change
that removed this field:

```typescript
// src/operations.compat.spec.ts (fragment)
    const report = diffOperations(baseline, current);

    expect(report.breaking).toMatchObject([
      {
        operation: 'notifications.check-address',
        path: 'output.reservedUntil',
        description: 'property removed',
        verdict: 'breaking',
      },
    ]);
    // The hint does not rename anything: the operation is still
    // addressed by its old name
    expect(report.operations).toContainEqual({
      operation: 'notifications.check-address',
      breaking: 1,
      additive: 0,
      unknown: 0,
      suggestedName: 'notifications.check-address.v2',
    });
```

The comparison gives one difference with the `breaking` verdict and
the `output.reservedUntil` path. An operation with at least one
`breaking` gets `suggestedName` in the summary. This is the only place
where the `.vN` suffix is recognized, and no renaming happens because
of it.

## Update the baseline deliberately

A compatible change, for example a new optional field in `output`,
gives the `additive` verdict. The test fails on it too, and that is an
expected step: rewrite the snapshot and commit it together with the
change to the operation.

```bash
UPDATE_SNAPSHOT=1 yarn test src/operations.compat.spec.ts
```

An incompatible change is made through a new name. Declare
`notifications.check-address.v2` next to `notifications.check-address`, implement both operations in
the `notifications` feature, move the callers to the new one, and remove the
old one once no caller is left. The snapshot updates at every step:
first the operation appears, then the old one disappears. This
example's test also treats removing an operation from the snapshot as
an error, because `diffOperations` classes it as `breaking`.

```bash
yarn test src/operations.compat.spec.ts
```

The path is complete. Tasks that come up outside its order lie in
[recipes](../recipes/README.md), for example [a webhook with a
signature check](../recipes/webhook.md).
