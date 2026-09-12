# The container: DI, class roles, modules, DI token families

> **Target state of V1.** Decision logic: entries
> [ideas.md](../../decisions/ideas.md):
> `[2026-07-06] Token families + модули без рантайм-инкапсуляции`,
> `[2026-07-10] Multi-injection через token families: Family.all`,
> `[2026-07-08] Kernel/user space; конфиг как token-families`,
> `[2026-07-10] Асинхронный контекст`, `[2026-07-13] Endpoint-декларации`,
> `[2026-07-10] Пакет тестирования (@nestlingjs/testing)` — substitution
> and pruning, `[2026-09-01] Модуль без exports`.
> `[2026-08-29] Стиль документации: правила, глоссарий, перенос обоснований из design/`,
> `[2026-09-04] @Injectable сверяет длину списка зависимостей с конструктором`,
> `[2026-09-06] Фаза 0 BOOTSTRAP: источники до сборки, синхронный build(), фабрики без I/O`,
> `[2026-09-06] Ресурсы и роли классов: @Component, @Resource, @Handler; экземпляры на INIT`,
> `[2026-09-06] Переключатели состава: makeSwitch, pick и when, аргумент сборки`,
> `[2026-09-06] Логгер ядра: RootLogger$, семейство Logger$ с .auto и child`,
> `[2026-09-12] Разбор обзоров d/10 и d/13`, point 2,
> `[2026-09-06] Термины и гайд: DI-токен, суффикс $ одним правилом`.
> Implementation status: [roadmap](../../decisions/roadmap.md).

## DI tokens and providers

Dependencies are declared as an explicit array of DI tokens. There is no
`reflect-metadata` and no inject-by-type.

```typescript
@Component([UserRepository$, Logger$('users')])
export class UserService {
  constructor(
    private repo: UserRepository,
    private logger: Logger,
  ) {}
}
```

- A class serves as its own DI token, including a class with a private
  constructor: an instance of a resource is created by `static acquire`,
  while the DI token stays the same class. Interfaces and values are
  registered through explicit DI tokens (`makeToken<T>(id)`) and the
  primitives `classProvider(token, Class)`,
  `factoryProvider(token, fn, deps)`, `resourceProvider(token, spec)`,
  `valueProvider(token, value)`. These are low-level container
  primitives for the DI tokens of interfaces, configuration and tests,
  not a separate style of declaration.
- **A DI token is an object; its identity is by reference.** The string
  `id` serves display: error texts, reports and the `toJSON()` of the
  graph. A matching `id` does not cause a substitution — the DI tokens
  remain different — but it makes the reports ambiguous, and the
  assembly warns about it. Every call to `makeToken` gives a new DI
  token, so a DI token is declared once and imported by value. The
  second argument, `makeToken(id, { hint })`, is a fix text for the case
  when the graph has no provider for the DI token; it does not affect
  identity. A class is recognized by reference too: two same-named
  classes from different packages are two different graph nodes, not a
  silent substitution.
- The dependency list is duplicated in the decorator and in the
  constructor. This is the price of not letting the compiler infer the
  list on its own. The compiler checks the list against the
  constructor by type, order and length: an argument of another type,
  a mixed-up order, a missing or
  an extra DI token are all compilation errors. The `dependency-list`
  rule from `@nestlingjs/eslint-plugin` derives the expected list from
  the types of the parameters and shows it in the editor, and an
  autofix fills in an empty list. The guarantee remains the compiler's
  ([ideas.md](../../decisions/ideas.md)
  `[2026-09-12] Правило линтера: список зависимостей из параметров конструктора, с автофиксом`).

## Class roles

A class in the graph plays one of three roles. The role is set by a
decorator, and every role has its own shape of class and its own
positions where the class is allowed:

| Role | Decorator | Shape | Where allowed |
|---|---|---|---|
| component | `@Component([deps])` | a synchronous constructor with no input-output | `providers:` |
| resource | `@Resource([deps])` | `static acquire(...deps, signal)` and a `release()` method | `providers:` |
| handler | `@Handler([deps])` | a constructor with dependencies and a `handle` method | the `handler:` slot of a declaration ([endpoints.md §3](./endpoints.md)), `providers:` for a pipeline unit |

Two mechanisms hold the position. **The compiler checks the shape of
the class:** `@Handler` applies only to a class with a `handle` method,
`@Resource` only to a class with `static acquire` and `release`, and
`@Component` rejects a class with `handle` or with `static acquire` and
names the decorator that fits. The rejection looks at the type of the
instance and does not fire when `any` sits in this position: a class
that fails the constraint of the decorator's parameter is printed by
the compiler as the constraint itself, and without this check an error
for any other reason would carry text about a foreign role. The
`handler:` slot, for its part, requires a `handle` method with a
signature from the schemas, so a component does not fit there by type.
**The role is checked on the ASSEMBLE phase:** the assembly names the
class, the position and the decorator it expects. This catches what the
shape does not distinguish: a resource in the `handler:` slot and a
class with no role decorator in `providers:`.

There is no typed brand for a position on the class itself: it is
unreachable in standard ES decorators — a class decorator that returns
`T & Brand` does not change the type of the declaration.

A class with no dependencies has a shorter shape: `@Component()`.

A **component** promises that its creation touches nothing external: the
constructor gets its dependencies and opens nothing. A component is
created through `new` on the INIT phase.

A **resource** holds something external: a database pool, a connection
to a broker, a timer. The acquisition is asynchronous and can fail, and
a resource has a release.

```typescript
@Resource([AppConfig, Logger$.auto])
export class Database {
  static async acquire(
    cfg: Config<typeof AppConfig>,
    logger: Logger,
    signal: AbortSignal,               // SIGTERM during start cancels the acquisition
  ): Promise<Database> {
    const pool = new Pool({ connectionString: cfg.databaseUrl });
    await pool.query('select 1');
    logger.info('database connected');
    return new Database(pool);
  }

  private constructor(private readonly pool: Pool) {}

  release(): Promise<void> {
    return this.pool.end();
  }

  health(signal: AbortSignal): Promise<HealthStatus> {   // an optional contribution to the probes
    return this.pool.query('select 1', { signal }).then(() => 'ok');
  }

  get users(): UsersTable {            // no undefined, no check
    return this.pool.table('users');
  }
}
```

- `@Resource([deps])` checks the dependency list against the parameters
  of `static acquire` the same way `@Component` checks it against the
  constructor. The return type of `acquire` must be an instance of the
  class.
- The consumer of a resource is created after a successful acquisition
  and gets a ready value in its constructor. There is no "not yet
  initialized" state for a resource, from the consumer's side.
- The functional shape, for the DI tokens of interfaces and foreign
  objects:
  `resourceProvider(Database$, { deps: [AppConfig], acquire: (cfg, signal) => connect(cfg.databaseUrl, { signal }), release: (pool) => pool.end(), health? })`.
- The `health(signal)` method on a class, or the `health` field on a
  `resourceProvider`, registers a `HealthCheck$(<node id>)` contribution
  with no separate provider ([composition.md §6](./composition.md)).

A **handler** is a class with a `handle` method. It has two positions:
the `handler:` slot of an endpoint declaration and `providers:` for a
pipeline unit ([pipeline.md](./pipeline.md)). The handler shapes, the
`Handler<Op>` and `HttpHandler<Op>` interfaces, are described in
[endpoints.md §3](./endpoints.md). An endpoint registers its own
handler class itself; the same class in `providers:` is an assembly
error naming the class, the pattern of the endpoint and the module. A
pipeline unit, on the other hand, is declared in `providers:`: it is
resolved by `pipeline.bind`.

The `@OnStart(signal)` hook exists on a component and on a resource:
starting background work is not an acquisition. The signal is armed on
SHUTDOWN. Classes have no other hooks: acquisition and release are the
`acquire` and `release` of a resource.

## Assembly and instance creation

`build()` is synchronous and performs no input-output. It unfolds the
provider factories of the modules, resolves the switch branches, creates
the family nodes, checks the cycles, the missing DI tokens and the class
roles in their positions, and computes the topological order. Any of
these errors stops the start of the application; at runtime they do not
occur. There is no notion of `forwardRef`. There are no instances after
`build()` yet: the graph is checked as a whole, and it can be shown,
walked and attributed to modules.

`init()` creates the instances in topological order: a component is
constructed, a resource is acquired with `await acquire`. A failed
acquisition releases what was already acquired, in reverse order, and
drops the start. `start(signal)` calls `@OnStart(signal)` in
topological order. `destroy()` calls `release` in reverse topological
order; the signal is armed by whoever owns it, the application, as the
first step of SHUTDOWN. The semantics of the phases are described in
[composition.md](./composition.md).

Missing dependencies are listed as one error. The check runs before the
instances are created: the assembly walks the `deps` of every provider,
collects the DI tokens with no provider together with their consumers,
and gives one list. Under the list, hints of declarations are printed:
of the missing DI token and of every consumer that has one, one line
per DI token. The fix depends on the pair "what was missing" and "for
whom": the DI token knows how to supply itself, the consumer knows how
to do without it. The hint for the `MessageBus$` bus comes from the
kernel: it names the transport from `transports:`.

A `factoryProvider` factory is synchronous. A factory that returned a
Promise drops the assembly, naming the provider, with the hint "an
acquisition of a resource is a `resourceProvider`".

## Reading methods of the builder

`ContainerBuilder` gives out the composition before `build()` through
two reading methods. `healthResources()` lists the resource providers
that declared `health`; `familyMembers(family)` lists the registered
members of a family. Neither one registers anything or changes the
assembly order, and both see the unfolded `when` branches and the
expanded factories of module providers.

The kernel uses them: the nodes of the probe contributions are
registered by the kernel, not by the container. The container knows
nothing about the probes; it answers the question "which resources have
`health`", and `Health$` gives the outcomes their meaning
([composition.md §6](./composition.md)).

## Substitution and pruning in a test assembly

`ContainerBuilder` accepts two options for a test assembly: `overrides`
(pairs of "DI token and value") and `familyOverrides` (a replacement of
a family's recipe). The public `makeApp` does not accept these options:
substituting graph nodes is a property of a test run
([testing.md](./testing.md)).

`build()` runs its steps in this order:

1. unfolds the provider factories of modules and the switch branches;
2. replaces the family recipes (`familyOverrides`), before the members
   are created, so members are created by the test recipe already;
3. creates the family members (to a fixed point);
4. substitutes `overrides`: the provider of a DI token is replaced with
   `{ provide, useValue }`, the module attribution is kept, so the
   visualization and the diagnostics still show the owner;
5. removes the orphaned subtrees (pruning);
6. creates the `Family.all` aggregates, after pruning, from the members
   that remain;
7. lists the missing dependencies, builds the graph, checks the cycles
   and the roles.

The substitution fails the assembly in two cases. The first is an
override for a DI token with no provider: for example, a provider was
renamed, and the test would replace nothing; for a family member, a
separate error explains that a member becomes a graph node only after
someone injects it. The second is two overrides for one DI token.

**The pruning algorithm.** Let `deps` be the dependency relation before
the substitution, `deps′` the one after it (for a replaced DI token,
the original `deps` are remembered). An edge to `Family.all`, when
walked, unfolds into edges to every current member of the family, so
the consumer of the aggregate does not lose them.

- `R` is the DI tokens with a zero in-degree in the union `deps ∪
  deps′`, plus the DI tokens unreachable from them by the union. This
  way, the participants of a cycle stay in the graph and reach the
  cycle check, instead of disappearing.
- `Keep` is the DI tokens reachable from `R` by `deps′`.
- `All \ Keep` is removed: its instances are not created, there is no
  node in the graph, `acquire`, `@OnStart` and `release` are not called.
  A replaced node is never removed.

The union `deps ∪ deps′`, when picking `R`, is needed for cases like "a
repository is replaced with an in-memory one, and a database pool
depended only on it". Before the substitution, the repository
referenced the pool; after it, no one does, so the pool drops out of
the graph as orphaned, rather than staying in it as a root.

Invariant: with no `overrides`, `deps = deps′`, every node is reachable
from the nodes with a zero in-degree, so `Keep = All`, and pruning
changes nothing. A production assembly matches a test assembly with no
substitutions, down to the last node. The list of the identifiers of
removed nodes is available as `app.pruned`: the question "why is my
resource not acquired" is answered by data, not by reading the source.

## Modules

A module is a value: a label of provider ownership and a packaging
unit. It is not a boundary, so it has no `exports` field; it has no
endpoints either, they are declared by the application-layer unit
([composition.md](./composition.md)). A module is described by `name`,
`providers` and `dependsOn`. Visibility rests on ES modules and package
boundaries: a DI token not exported from a package cannot be requested
from outside it.

```typescript
export const OrdersModule = makeModule({
  name: 'module:orders',
  providers: [OrdersService, OrdersRepository],
  dependsOn: [StorageModule],        // what this module cannot work without
});
```

- `dependsOn` means ownership, not access: the providers are visible to
  anyone who can import the DI token. The modules from `dependsOn` are
  registered together with this module.
- The identity of a module is its value. The same value, met again
  (through `dependsOn`, in two features, in a feature and in a plugin)
  is registered once. The module name is the attribution key of its
  providers, so two different values under one name are an assembly
  error. The error names the module and the ways to fix it: split one
  value with an import, give the configurations different names, check
  for duplicate packages in the dependencies. The comparison of values
  is by reference: there is no structural comparison of options and no
  memoization by arguments.
- A parametrized module is a function that returns a module. The
  notions of `DynamicModule`, `forRoot` and `forRootAsync` do not
  exist. The result of such a function is created once and shared by
  import: calling the factory again, even with the same options, gives
  a different value under the same name and drops the assembly.
- The `providers` of a module can be a synchronous factory; it is
  called in `build()`. A composition branch by a value known before
  assembly is not a factory, it is a switch:
  `Storage.pick({ … })` and `Audit.when(…)` in `providers` and
  `dependsOn` ([composition.md §3](./composition.md)).
- The container is used standalone too, with no `App`: grouping
  providers under a label is useful on its own there.

## DI token families

A DI token family is one recipe and many instances, distinguished by a
parameter. Families cover parametrized providers, an instance's
dependency on its consumer, and multi-injection. All of this is
resolved at assembly.

```typescript
export const Logger$ = makeTokenFamily<Logger, [scope: string]>('Logger');

// an infrastructure module registers ONE recipe for the family:
familyProvider(Logger$, (scope) =>
  factoryProvider(Logger$(scope), (root) => root.child({ scope }), [RootLogger$]));

// business code requests a member as an ordinary dependency:
@Handler([UserService, Logger$('users')])
class CreateUserHandler { /* ... */ }
```

- `Logger$('users')` is a memoized member DI token with the identifier
  `Logger:users`. Memoization is part of the promise of a family:
  without it, every access would start a new node under the same name.
  The family and the parameter are stored by the member in **fields**,
  so the question "whose DI token is this" does not depend on how its
  `id` looks: a DI token assembled by hand through
  `makeToken('Logger:users')` is not a member of the family. The
  assembly finds every member mentioned in `deps` and creates a graph
  node for each one, by the recipe. These are ordinary nodes, and they
  are created on INIT together with the rest.
- `.auto` is a member whose parameter equals the name of the consumer.
  `Logger$.auto` in the `deps` of the `CreateUserHandler` class becomes
  `Logger$('CreateUserHandler')` at registration time, because the
  consumer is known statically. This is how the `transient + INQUIRER`
  case from Nest is solved, with no transient scope.
- `.all` is multi-injection: an aggregating DI token of type
  `Token<readonly T[]>`. This is a dedicated value, not a member with a
  reserved parameter: `HealthCheck$('all')` is an ordinary member and
  does not collide with the aggregate. Contributions are ordinary
  providers with member DI tokens
  (`classProvider(HealthCheck$('db'), DbHealthCheck)`); different
  modules register them independently. At `build()`, the assembly
  creates a synthetic aggregate node with the list of instances. The
  list is frozen; the order is the order of registration: the explicit
  ones first, then the ones created by the recipe. An empty family
  gives `[]`. The aggregate node belongs to no module; a contribution
  needs no declaration beyond the member's provider. When a feature is
  not selected, its contributions are absent from the list, by the same
  mechanism that removes its providers from the graph. Every
  contribution is also addressable on its own: `HealthCheck$('db')` is
  an ordinary DI token.
- The configuration ([config.md](./config.md)), the kernel logger
  (below) and infrastructure clients created on demand
  (`GrpcClient$(server)` plus unbound keys) are families too.

## The kernel logger

`Logger` is the logger interface both the kernel and the application
work with.

```typescript
type Fields = Record<string, unknown> & { err?: unknown };

interface Logger {
  debug(message: string, fields?: Fields): void;
  debug(error: Error, fields?: Fields): void;
  debug(fields: Fields): void;
  // info, warn, error — the same three shapes
  child(bindings: Fields): Logger;
}
```

- The shape with `Error` as the first argument takes `message` from the
  error and puts the error itself into `err`. The key `err` is reserved
  for the error; the implementation serializes the stack and `cause`.
  `Fail` extends `Error` and goes through the same shape.
- `child(bindings)` returns a logger that adds `bindings` to every
  record: a series of records about one object is written through
  `logger.child({ orderId })`.
- `RootLogger$` is the DI token of the root logger. The root itself
  lives **outside the graph**: the assembly creates it on phase 0 — it
  is the value of the root's `logger` option, or a `ConsoleLogger` built
  from the snapshot of the `nestlingLog` section — and registers
  `valueProvider(RootLogger$, root)`. So the kernel writes into the same
  logger on every phase, including 0 and 1, when there are no graph
  nodes yet. An application provider under `RootLogger$` is a duplicate
  error: there is no second way to declare the root.
  `Logger$(scope)` and `Logger$.auto` are family members with the
  recipe `root.child({ scope })`, so replacing the root changes every
  member.
- The request and trace identifiers are not part of the interface: the
  implementation reads them itself. The kernel's `ConsoleLogger` reads
  `requestId` and `traceId` from the ambient context directly, not
  through the `Ctx(RequestId)` and `Ctx(Trace)` nodes: the root exists
  before the graph and cannot depend on its nodes. The fields are added
  to a record when the context has the values and the call did not set
  them. Outside a request there are no such fields. `traceId` is what
  ties together records from different processes: the bus envelope
  carries the trace, and on receipt `withTracing()` returns it into the
  context ([pipeline.md §3](./pipeline.md)).
- The container does not depend on the logger: it has no logger. It
  gives the assembly warnings (matching DI token `id`s) as the value
  `BuiltContainer.warnings`, and the application assembly writes them to
  the root logger after `build()`. A consumer of the container with no
  `App` reads the list itself, the same technique as `pruned`.

## The kernel metrics

`Metrics` is the metrics interface both the kernel and the application
work with.

```typescript
type MetricAttributes = Record<string, string | number | boolean>;

interface Metrics {
  counter(name: string, value?: number, attributes?: MetricAttributes): void;
  histogram(name: string, value: number, attributes?: MetricAttributes): void;
}
```

The shape repeats the shape of the logger, so the application recognizes
it by an already familiar form.

- Both methods write a value and return `void`. There is no instrument
  object: the kernel names a metric, and caching the instruments stays
  the implementation's job. `counter` with no value increments the
  counter by one. There is no `gauge` method in V1.
- `RootMetrics$` is the DI token of the root. Its value is set by the
  `makeApp({ metrics })` option; without it, an empty implementation
  whose methods do nothing stands under the DI token. The node is always
  in the graph, so a feature that writes a metric assembles without an
  installed satellite. An application provider under `RootMetrics$` is a
  duplicate error, the same as for the logger.
- `Metrics$(scope)` and `Metrics$.auto` are family members. A member adds
  the `scope` attribute to every record; the interface has no `child`
  method, the family recipe makes the wrapper.
- The kernel counts four metrics: `nestling.requests` and
  `nestling.request.duration` for handling a request
  ([pipeline.md §2](./pipeline.md)), `nestling.port.calls` and
  `nestling.port.duration` for calling a port
  ([operations.md](./operations.md)). Duration is measured in
  milliseconds, the same as `timeoutMs` and `deadline`.
- Attributes come from declarations, not from the request: `pattern` is
  the route pattern of the endpoint, `operation` is the name of the
  operation. The number of rows at the exporter is therefore finite and
  does not grow with traffic.
- Kernel instrumentation is enabled together with a real implementation.
  Without the `metrics` option, the runtime does not measure time and
  does not call the recording methods; there is no enabling flag in the
  interface.
- The kernel does not know the export format. The application or a
  satellite writes the `/metrics` endpoint and the export to a collector
  on top of this interface.

## The kernel and user code

The boundary is drawn the way an operating system draws it. The kernel
covers the configuration sources, the transports and the servers, the
bus and the port clients, the graph and lifecycle mechanism, the probes
and the root logger; their DI tokens are exported, the implementations
stay private. User code covers the services, the endpoints, the
operations and the configuration as data. The boundary can be crossed
only through public points: injecting `Config<X>`, `Port` and
`Emitter`, `Logger$`, `Health$`, returning a value from a handler. The
boundary rests on the visibility of ES modules, not on a runtime
permission check. User code knows neither the configuration source nor
the transport: the same business code works in one process and in a
split deployment, with the configuration from env or from Vault.

## Asynchronous context

Services deep in the graph (a logger in a repository, three layers below
the handler) need values from the request context, for example
`requestId`. For them there is a read-only projection of the pipeline
context, through `AsyncLocalStorage`. The rule: the value comes from the
environment, but the dependency on it is declared explicitly; only
`.pre` units can write values.

A context variable is a typed key of the accumulated `input` of the
pipeline, not a cell of a separate store. There is no separate state
that could drift from `input`. The declaration is a double call:
`contextVar<T>()` fixes the type, the second call sets the key as a
literal.

```typescript
export const RequestId = contextVar<string>()('requestId');
// the key 'requestId' is the same field a unit sees at ctx.input.requestId
```

- The variable itself does the writing: `Var.provide(compute)` returns
  an ordinary `PreUnitFn<TReq, { key: T }>`. Declaring a variable and
  writing its value are one action. The second shape,
  `Var.provide(deps, compute)`, gives the writer values from the
  container: the list of DI tokens is resolved at `bind()` by the same
  resolver as the class units, and it lands in the `TNeeds` of the
  pipeline ([pipeline.md §5](./pipeline.md)); such a writer declares its
  requirements on the context with an annotation on the `ctx` parameter.
  `Family.auto` in the list is rejected: a writer has no consumer class
  to pick a member by name from. A unit that puts the same field into
  `input` by hand works for readers, but is not counted as the declarer
  of the variable, and the `hasVar` policy does not count it either.
- Reading is a member of a DI token family: `Ctx(RequestId)` in `deps`
  gives a `CtxReader<string>`. `Ctx` is typed by the value of the
  variable: `Ctx('requestId')` with a string does not compile. A
  dependency on the request context is an ordinary graph edge, and the
  full list of context reads is known at `build()`. In tests, a reader
  is replaced through `valueProvider` (the shorthand is `contextValue`,
  see [testing.md](./testing.md)); `AsyncLocalStorage` is not needed for
  this. The kernel module the composition root always registers gives
  the family recipe; there is no field for it in `makeApp`, the same as
  for the configuration.
- `get(): T` throws an error naming the current phase, when there is no
  value. `peek(): T | undefined` is meant for the response phase of the
  pipeline, `@OnStart` and background tasks. This pair repeats the
  asymmetry of the context in the pipeline ([pipeline.md](./pipeline.md)).
- The accumulated `input`, `signal` and the current phase are available
  in the projection. `raw`, `endpoint` and `summary` do not reach the
  projection: the transport must not leak into the domain. The signal
  lives outside `input`, so it is read-only: `Ctx(Signal)` is read, the
  key `'signal'` is reserved, and this variable has no `provide` method,
  neither in the type nor at runtime. Only the pipeline runtime updates
  the projection; there is no public setter.
- The presence of a variable is checked at assembly, opt-in:
  `everyEndpoint(…).hasVar(Var)` ([pipeline.md §7](./pipeline.md)).
  Types close off reading from a unit, the policy closes off reading
  from deep in the graph, where there are no input types.
- The kernel declares three variables and reserves their keys. `Signal`
  is the cancellation signal of the request, read-only. `RequestId` is
  the request identifier, written by `withRequestId()`. `Trace` is the
  trace, written by `withTracing()` ([pipeline.md §3](./pipeline.md)).
  Declaring a user variable under the key `'signal'` or `'trace'` throws
  an error naming the reserved variable. `Trace` is declared with
  `{ propagate: true }`, so the caller of a port puts it into the bus
  envelope.
- Propagating a variable through a port is opt-in, at declaration:
  `contextVar<T>()('tenantId', { propagate: true })`. The flag sits on
  the declaration, not at the connection point: it is exactly the
  variable that is propagated, and the decision is visible right where
  it is declared. The context of the caller does not reach the
  implementation of a port through any binding path: calling a port
  opens its own request context. `propagate` is a named exception from
  this rule.
  - Collecting the values happens on the caller's side, from the
    context of the current request. The values are sent in a field of
    the bus envelope, not mixed into the payload. Outside a request
    (`@OnStart`, a background task), there is nothing to send, and this
    is allowed.
  - Receipt goes through two channels, like the call profile
    ([operations.md §4](./operations.md)): unconditionally into
    `ctx.raw.attributes`, and into the context projection through
    `Var.propagated()`. This writer carries the same runtime mark as
    `Var.provide`, so `everyEndpoint(…).hasVar(Var)` counts it too, and
    the presence of the propagated context is checked at assembly.
  - The value is not validated: a context variable has no schema.
    Propagation crosses a trust boundary; what to propagate and what to
    decide based on it stays the responsibility of the application.
  - Read-only variables (`Signal`) cannot be propagated: their value is
    supplied by the request runtime on the receiver's side.
  - Propagation works only through the bus. Over HTTP and CLI, the
    context is not propagated.
- There is no separate `@nestlingjs/context` package: the writer is
  typed by the `ExtendableContext` of the pipeline, its runtime updates
  the projection, and the `hasVar` predicate lives in its set of
  policies.

## What does not enter the container

- Request state. The typed request context is the accumulated `input`
  of the pipeline; for services deep in the graph, it is the
  asynchronous context (the section above). There are no
  request-scoped providers.
- Switch values. A switch has no DI token: the chosen composition is
  visible in the graph as the picked branch, not as a value
  ([composition.md §3](./composition.md)).
- Lazy initialization and runtime subgraphs (child containers) are not
  part of V1 (see the journal entries).
