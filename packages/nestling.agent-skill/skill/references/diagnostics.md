# Reading a diagnostic

The compiler and the ASSEMBLE phase say what is wrong in the text of the
error. This file maps the line on the screen to the rule behind it. Every
quoted text is pinned by a snapshot or a test in the repository.

A declaration slot rejects a wrong value by intersecting it with an error
literal. Read such a diagnostic from its `__error` line, not from the
first one: `No overload matches this call` only names the call that
failed. The lines under `__error` carry the data — which codes, which
fields, which lengths.

## The declaration does not compile

| What it printed | What it means | What to fix |
|---|---|---|
| `__error: "Handler returns a failure that is not declared in 'errors:'"`, then `returned` and `declared` | The handler returns a failure outside the declared set. `returned` lists the codes over the set, `declared` lists the set itself | Add the definitions to `errors:` of the declaration, or to `errors:` of the operation when the declaration implements one. The other way out is to stop returning them |
| `__error: "Layer may fail with errors the operation does not declare"`, then `undeclared` | A layer of `pipeline:` declares a failure that the operation does not. The caller imports the operation and never sees the pipeline of the implementation | Add the definitions to `errors:` of the operation |
| `__error: "Pipeline requires context that the start context does not provide"`, then `missing` | A unit of the layer reads a field that the declaration does not put into the start context | Declare `rawBody: true` on the declaration, or take the fields from an outer layer. Under `implement` the start context is empty: a unit that reads transport fields belongs to a transport declaration |
| `__error: "Output item chain must preserve the wire type"` | `.batch` or a type-changing `.through` is declared in `output:` | Keep the chain in `input:`; on the way out the item type is what the client reads |
| `Object literal may only specify known properties, and 'operation' does not exist in type 'HttpEndpointDictionary<…>'` | The declaration implements an operation, and that is a second constructor | Write `httpEndpoint.implement(Operation, { … })` |
| `Object literal may only specify known properties, and 'input' does not exist in type 'HttpImplementDictionary<…>'` | The implementation redeclares what the operation owns: `method`, `path`, `input`, `output`, `errors`, `bind`, `rawBody`, `sse`, `doc` | Drop the field. It is declared once, on the operation |
| `Object literal may only specify known properties, and 'deps' does not exist in type '…'` | `handler: { deps, handle }` is not a form of the handler | Write a class marked `@Handler([…])` with a `handle` method, or a plain function |

The failure check of the handler is deliberately narrow. When the type of
the result is unknown to the compiler — the handler came in as a variable
typed `HandlerFn`, for instance — the check prints nothing, and an
undeclared failure compiles. The boundary of the pipeline still replaces
it with `internal_error` at run time, so this is a lost early error and
not a hole in the guarantee.

## The class does not fit the decorator

| What it printed | What it means | What to fix |
|---|---|---|
| `Type 'typeof UserService' is missing the following properties from type 'DependencyLengthError<1, 2>': __error, expected, actual` | The dependency list is not as long as the constructor parameter list. `expected` is the number of parameters, `actual` the length of the list | Make the list name every parameter, in the order of the parameters |
| `RoleShapeError<"A class with a handle method is a handler, not a component", "@Handler">` | The class is of another role than the decorator names. The `use` field names the decorator to take | Take the decorator from `use`: `@Handler([…])` for a class with `handle`, `@Resource([…])` for a class with `static acquire` |
| `Types of parameters 'db' and 'args_0' are incompatible` under a decorator | The dependency list is as long as the parameter list, but the order differs | Reorder the list to match the constructor |

## ASSEMBLE stops the process

| What it printed | What it means | What to fix |
|---|---|---|
| `Feature 'orders' depends on feature 'billing' by DI token: 'X' injects 'Y'` | A DI token crosses a feature boundary. It does not survive a process boundary either, so the edge breaks as soon as the two features are deployed apart | Declare the call as an operation (`makeRequest` / `makeCommand`), inject its `.caller` and implement it in the other feature |
| `Plugin 'metrics' depends on feature 'orders': 'X' injects 'Y'` | Infrastructure knows about business logic. It can be neither reused nor shipped separately, and it stops assembling as soon as the feature is out of the selection | Take the value as a parameter of the plugin, or inject a token the plugin declares itself |
| `Module 'audit' is reachable from two features, 'orders' and 'billing', so it has no single owner` | The same module is reachable from two features, and an edge into it cannot be classified | A unit shared by two features is infrastructure: declare it with `makePlugin` and list it in `plugins:` of `makeApp({ … })` |
| `Unknown feature 'orderz' in the selection` | The selection names a feature that is not declared | Check the name against `features:` of `makeApp({ … })` |

## The declaration throws when it is created

These are for JavaScript consumers: the types make the same mistakes
impossible, and the value is still checked when it is built.

| What it printed | What it means | What to fix |
|---|---|---|
| `httpEndpoint.implement(CreateUser, { … }): the operation has no 'http:' section` | The operation carries no HTTP address | Declare `http: '<METHOD> <path>'` on the operation, or implement it on the bus with `implement(CreateUser, { … })` |
| `httpEndpoint.implement(operation, { … }): the first argument must be an operation value` | The first argument was not created by `makeRequest` / `makeCommand` / `makeEvent` | Pass the operation value itself, not its name or its schema |
| `'doc' belongs to the operation and cannot be redeclared by its implementation` | The documentation of an operation is a part of its interface | Move `doc:` to the operation. Two implementations of one operation cannot describe it differently |

## Where to look next

| The thing | The file |
|---|---|
| declared failures, the boundary, statuses | `references/errors.md` |
| layers, the context, policies | `references/pipeline.md` |
| DI tokens, class roles, lifecycle | `references/container.md` |
| features, operations, callers | `references/features.md` |
