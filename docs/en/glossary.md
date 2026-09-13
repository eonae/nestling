# Glossary

Nestling terms and how to write them. Every term in the documentation is
called by one word from this list. A term that is missing here is defined
by the document at first use and then added here.

This file is also the translation dictionary: next to every English term
stands its Russian original from `docs/glossary.md`. Chapters, recipes and
design documents are translated by these names, so that `Fail` and
«feature» are called the same in every file.

Text style rules live in the `docs-style` skill
(`.claude/skills/docs-style/SKILL.md`); the table of words we avoid is
there too.

## How we write terms

<!-- docs-style: off -->
| We write | Russian original | We don't write |
|---|---|---|
| endpoint | `endpoint` | route, handle, path handler |
| handler | `хендлер` | endpoint function, controller method |
| pipeline | `пайплайн` | middleware chain, conveyor |
| unit | `юнит` | step, middleware |
| layer (of a pipeline) | `слой (пайплайна)` | tier, level |
| feature | `фича` | module (of an application), slice |
| plugin | `плагин` | extension, addon |
| operation | `операция` | contract, message type |
| intercom | `интерком` | internal bus, remote bus |
| transport | `транспорт` | adapter, driver |
| container | `контейнер` | IoC container, injector |
| provider | `провайдер` | binding, registration |
| DI token | `DI-токен` | token, injection token |
| Bearer token (about authentication) | `Bearer-токен` | token, access token |
| component | `компонент` | service, bean |
| resource | `ресурс` | connection holder, managed object |
| switch | `переключатель` | flag, toggle |
| DI token family | `семейство DI-токенов` | parametrised token, token factory |
| module | `модуль` | package (of an application), namespace |
| caller, emitter | `вызыватель, эмиттер` | port, client, publisher |
| implementation (of an operation) | `реализация (операции)` | handler of an operation, consumer |
| bus | `шина` | message bus (in prose), transport |
| broker | `брокер` | only an external system (NATS); not a synonym for the bus |
| section (of the configuration) | `секция (конфига)` | config object, settings group |
| source (of the configuration) | `источник (конфига)` | loader, reader |
| failure, `Fail` | `отказ, Fail` | domain error, business error |
| discovery | `discovery` | scanning, tree walk |
| composition root | `composition root` | bootstrap, wiring point |
| fail-fast | `fail-fast` | early crash, strict mode |
| kernel | `ядро` | core (in prose; identifiers keep `kernel`) |
| user code | `пользовательский код` | user space, application layer |
| Standard Schema | `Standard Schema` | standard schema, validation standard |
| io shape | `форма io` | io form, input-output kind |
| trace | `трасса` | distributed trace, tracing |
| span | `участок трассы` | trace segment, hop |
| W3C trace-context | `w3c trace-context` | trace context, traceparent format |
| metric | `метрика` | measurement, telemetry value |
| metric attributes | `атрибуты метрики` | metric tags, metric labels |
<!-- docs-style: on -->

## Container (`@nestlingjs/container`)

- **DI token** (`DI-токен`) — the key by which a dependency is requested
  from the container: a class or an object created by
  `makeToken<T>('Name')`. Identity is by reference: the string `id` serves
  reports and error texts, not comparison. It is always written with the
  prefix: there is no bare form in the texts, and about authentication we
  write «Bearer token».
- **Provider** (`провайдер`) — a description of how to obtain the value
  for a DI token: `valueProvider`, `classProvider`, `factoryProvider`,
  `resourceProvider` or a class with a role decorator.
- **Class role** (`роль класса`) — what the class does in the graph: a
  component (`@Component`), a resource (`@Resource`) or a handler
  (`@Handler`). The role limits positions: a component does not go into
  the `handler:` slot, and the handler class of an endpoint is not written
  in `providers:` — the endpoint registers it itself. The shape of the
  class is checked by the compiler, the role in a position by the assembly.
- **Component** (`компонент`) — a class with a synchronous constructor and
  no input-output; created on INIT through `new`.
- **Resource** (`ресурс`) — a class or a provider with asynchronous
  `acquire` and `release`: a pool, a connection. The consumer of a
  resource is created after the acquisition.
- **DI token family** (`семейство DI-токенов`, `makeTokenFamily`) — one
  recipe for many DI tokens that differ by a parameter: `Logger$('users')`,
  `Logger$('orders')`. A member of the family is requested as an ordinary
  dependency; the container creates a node for every requested parameter
  at assembly.
- **Module** (`модуль`) — a plain object (`makeModule`) that groups
  providers under a name. Not a class; a module has neither lifecycle
  hooks nor endpoints. `dependsOn` lists the modules without which it does
  not work.
- **Dependency graph** (`граф зависимостей`) — all providers and the links
  between them. Built and checked as a whole in `build()`.
- **Eager assembly** (`жадная сборка`) — the graph is checked as a whole in
  `build()`, and the instances are created as a whole on INIT, not at
  first use. A cycle and a missing dependency are assembly errors.
- **Topological order** (`топологический порядок`) — the order in which a
  dependency comes before the one that depends on it. Instances are
  created and `@OnStart` is called in this order, `release` in the
  reverse one.
- **Visibility through ES modules** (`видимость через ES-модули`) —
  encapsulation rests on module exports: only a DI token that could be
  imported can be injected. The container module is not a boundary.

## Composition (`@nestlingjs/app`)

- **Composition root** (`composition root`) — the single place where the
  application is put together from parts: the `makeApp({ … })` declaration
  in `app.ts` and the `app.assemble(args)` call in `main.ts`.
- **Application declaration** (`декларация приложения`, `makeApp`) — a
  value with the composition of the application: the endpoints of the root
  or the features, plugins, switches, transports, policies, the logger.
  The methods are `assemble(args?)`, `check(args?, options?)` and
  `discover(args?)`.
- **Assembly argument** (`аргумент сборки`, `AssembleArgs`) — what to
  assemble in this process: the feature selection and the values of the
  switches. The shapes are the object
  `{ features?, includeDeps?, …switch values }` or the
  `argv(process.argv)` marker, which the assembly parses by the schema
  of the declaration.
- **Root composition shape** (`форма состава корня`) — one of the three
  records of `makeApp`: `{ endpoints, providers? }`,
  `{ endpoints, modules? }` or `{ features }`. The first two are the
  composition of a single feature without a name; their endpoints are
  attributed to the unit named `app`.
- **Composition switch** (`переключатель состава`, `makeSwitch`) — a value
  that chooses one of the declared composition branches by a value known
  before assembly. It is declared in `switches:` of the root; it has no DI
  token, so the choice is not injected.
- **Composition branch** (`ветка состава`, `Switch.pick`, `Switch.when`) —
  the elements that go into the list at one of the values of a switch:
  `Storage.pick({ s3: […], local: […] })`, `Audit.when(…)`. A value, not
  a function: both branches are read without running code. It is expanded
  on the ASSEMBLE phase, before discovery.
- **Assembled application** (`собранное приложение`, `AssembledApp`) — the
  result of `assemble`: the methods `run(options?)` and `close()`.
  `options.config` carries the bindings of the configuration sources.
- **Phase** (`фаза`) — a stage of the application lifecycle: `0 BOOTSTRAP`,
  `1 ASSEMBLE`, `2 INIT`, `3 WIRE`, `4 START`, `5 RUN`, `6 SHUTDOWN`.
- **Feature** (`фича`, `makeFeature`) — a unit of the application that may
  end up in another process: a name, a composition (`providers` or
  `modules`) and its endpoints. A feature is addressed only by operations.
  It has no `dependsOn` field: the link with the neighbours follows from
  the declared operations.
- **Plugin** (`плагин`, `makePlugin`) — cross-cutting infrastructure: it is
  present in every process, so it is addressed by DI tokens. It is listed
  in `plugins:` of the root and does not take part in the feature
  selection. The name matches the name of the npm package.
- **Feature boundary** (`граница фичи`) — the rule «features are linked
  only by operations». An edge of the graph between two features and an
  edge from a plugin into a feature are assembly errors.
- **Feature selection** (`выбор фич`) — which features to include in this
  assembly: the `features` field of the assembly argument, `'all'`, a
  list of names, or `--features` from the command line. It is read
  before the container is assembled. `includeDeps` closes the selection
  over the called operations.
- **Discovery** (`discovery`) — a flat pass over the selected features and
  the connected plugins that collects their endpoints, transports and
  operation implementations. In the graph the result lies under the DI
  token `Discovery$`, and from the outside it is returned by
  `app.discover(args?)` — the single entry into discovery, because the
  assembly argument belongs to the declaration only.
- **Transport** (`транспорт`) — a node of the graph that accepts requests
  from the outside (HTTP, CLI, NATS) and passes them into `dispatch`. The
  root declares **instances**: `http()`, `http({ name: 'admin' })`. A
  declaration chooses its own through `on:`. The transport knows nothing
  about the pipeline and the handlers.
- **Server** (`сервер`, `server`) — a resource that holds the socket
  and opens it last on START. The HTTP transport attaches to the server;
  several transports on one socket get one server.
- **Intercom** (`интерком`, `intercom:`) — the role of the carrier of
  operations between processes, assigned by a reference to an already
  declared transport. Not a second list of transports and not a second
  declaration.
- **`dispatch`** — the «pattern → handler» table of one transport together
  with the calling function. It is created on the WIRE phase and passed to
  the transport in `serve(dispatch, signal)` on the START phase.
- **Policy** (`политика`, `policies`) — an invariant over the assembled
  graph, for example «every HTTP endpoint has the `authed` layer». It is
  checked on the ASSEMBLE phase. `detached: '<reason>'` takes an endpoint
  out of every policy.
- **Kernel** (`ядро`) — the modules that the assembly always registers:
  configuration, asynchronous context, ports, probes, logger. The DI
  tokens of the kernel are exported, the implementations are not.
  **User code** (`пользовательский код`) is everything else.
- **Probes** (`пробы`) — the liveness and the readiness of the
  application: the node `Health$` and the family of contributions
  `HealthCheck$`. Liveness always answers `ok`, readiness answers `ready`
  only in the RUN phase and only when the critical checks succeed. A
  transport adapts them: `httpProbes()` returns the report with the codes
  200 and 503.
- **Probe contribution** (`вклад в пробы`) — a provider of a member of
  `HealthCheck$(name)` with `critical` and `check(signal)`. A resource
  declares it in a shorter way, with the `health(signal)` method.
- **Kernel logger** (`логгер ядра`) — the `Logger` interface, the root
  `RootLogger$` and the family `Logger$(scope)`; the kernel writes only
  through it.

## Endpoints and declarations

- **Declaration** (`декларация`) — a value that describes an endpoint:
  `httpEndpoint.<method>(path, { … })`, `cliEndpoint(command, { … })`,
  `implement(Operation, { … })`, `httpEndpoint.implement(Operation, { … })`.
  Not a class and not a decorator.
- **Endpoint** (`endpoint`) — what the application serves at an address:
  an HTTP route, a CLI command, an implementation of an operation.
- **Handler** (`хендлер`) — the `handler` field of an endpoint: a function
  without dependencies or a class with `@Handler` and the `handle` method.
  It receives the input checked by the schema and returns `Ok` or `Fail`.
  It may declare `implements Handler<typeof Op>`.
- **HTTP handler** (`HTTP-хендлер`) — a handler whose `meta` contains
  `http` (headers, method, url, client address), and whose result is an
  `HttpOutput` with `HttpResponse` for a redirect, headers and cookies. It
  is allowed only in the constructors by HTTP method.
- **Transport start context** (`стартовый контекст транспорта`) — the type
  of the context that the transport gives to the pipeline before the first
  unit: for HTTP it is `HttpStartContext`. A unit typed by it is allowed
  only in the declarations of that transport.
- **Schema** (`схема`) — any value that implements
  [Standard Schema v1](https://standardschema.dev): zod, valibot, arktype.
  Validation, the types of the handler, the clients and the documentation
  are derived from the `input`, `output` and `errors` schemas.
- **io shape** (`форма io`) — the kind of input or output of an endpoint:
  `value` (an ordinary value), `stream(T)` (a stream of values),
  `events(T)` (SSE events), `multipart()` and `upload()` (files).
- **Pattern** (`паттерн`) — the string address of an endpoint inside a
  transport: `GET /users/:id`, `users:list`, `users.create`.
- **Bind map** (`bind-карта`, `bind`) — an instruction on which part of
  the HTTP request a field of the input is taken from (`query()`,
  `body()`), when the default rule does not fit.

## Pipeline (`@nestlingjs/app`)

- **Pipeline** (`пайплайн`) — the sequence of units around the handler:
  `.pre` before it, `.ok` and `.catch` after it, `.finally` at the very
  end. It is declared by `makePipeline()`.
- **Unit** (`юнит`) — one function or class in the pipeline.
- **Layer** (`слой`) — one `makePipeline()` call with a chain of methods.
  `compose(outer, inner)` puts layers together.
- **Context** (`контекст`, `ctx`) — the typed object of the request.
  `.pre` units extend it, the handler and the other units read it.
- **Response** (`ответ`) — the result of an endpoint: `Ok<T>` or `Fail`.
- **Early success** (`досрочный успех`) — the third outcome of a pre-unit:
  the value returned by `done()` finishes the endpoint with a success and
  no value, calling neither the following pre-units nor the handler. It is
  declared when the unit is connected (`.pre(unit, { done: true })`); a
  declaration with such a layer must have no `output`.
- **Outcome** (`исход`, `outcome`) — how the request finished; `.finally`
  sees it: `completed`, `disconnected`, `aborted`, `failed`.
- **Item chain** (`item-цепочка`) — the processing of the elements of a
  stream (`tap`, `filter`, `limit`, `batch`, …), as opposed to the
  pipeline, which processes the request as a whole.

## Observability (`@nestlingjs/app`)

- **Trace** (`трасса`, `Trace`, `traceId`) — the chain of processing of
  one request across every process it touched. The `withTracing()` unit
  puts it into the context; the trace identifier reaches every log
  record inside the request as the `traceId` field.
- **Span** (`участок трассы`, `spanId`) — the processing of the request by
  one process. A span is created for every request, and the span of the
  caller goes into the `parentSpanId` field. The trace assembles into a
  tree from them.
- **W3C trace-context** — the format for carrying the trace over HTTP: the
  `traceparent` header of the shape `00-<traceId>-<spanId>-<flags>`. Over
  the bus the trace travels as an envelope field, not a string.
- **Metric** (`метрика`) — a number that the application or the kernel
  writes by name with attributes. There are two kinds: a counter
  (`counter`) and a histogram (`histogram`). The implementation is set by
  the `makeApp({ metrics })` option; without it, the record goes nowhere.
- **Metric attributes** (`атрибуты метрики`) — «name: scalar» pairs at the
  moment of the record. The kernel takes them only from declarations
  (`pattern`, `operation`, `transport`, `outcome`), so the row count at
  the exporter does not grow with traffic.

## Failures (`@nestlingjs/operations`)

- **`Ok` / `Fail`** — the two kinds of response. `Fail` is an expected
  error (a failure) that the handler returns or throws. Any other
  exception is the internal error `internal_error`, whose details do not
  reach the client.
- **Failure** (`отказ`) — the same as `Fail`: an error foreseen by the
  operation.
- **`makeFail`** — the declaration of a failure type: `code`, the
  `details` schema and `message`.
- **`code`** — the stable machine identifier of a failure
  (`not_found:order`): segments separated by a colon, the first one is the
  category. The client recognises the failure by it too.
- **Category** (`категория`, `category`) — the first segment of the failure
  code, independent of the transport: `not_found`, `conflict`, `timeout`
  and others; the list is closed. The transport translates it into an HTTP
  status or a bus code.
- **`errors`** — the list of failures that an endpoint or an operation may
  return. A failure outside the list is replaced by `InternalError` on the
  way out of the pipeline.
- **Effective failure set** (`эффективное множество отказов`) — what the
  endpoint answers to the client: the `errors:` of its declaration plus
  the failures declared by the layers of its pipeline. The failure type of
  the handler is derived from it, the response is checked against it at
  the boundary, and the responses in OpenAPI are built from it.
- **Layer failure** (`отказ слоя`) — a failure declared when a pre-unit is
  connected (`.pre(unit, { errors })`). The unit may return it as a value;
  a failure outside this list is a compilation error.

## Operations and callers (`@nestlingjs/operations`, `@nestlingjs/app`)

- **Operation** (`операция`) — the unit of communication between features:
  a name, the `input` and `output` schemas, the list of `errors`. A value
  without server dependencies; it can be imported into a frontend. It is
  declared by one of the three constructors.
- **Operation kind** (`вид операции`) — `request` (`makeRequest`:
  request-response, exactly one owner), `command` (`makeCommand`: no
  response, exactly one owner), `event` (`makeEvent`: a fact, any number
  of subscribers). The kind follows from the constructor; there is no
  `kind` field in the declaration.
- **Implementation** (`реализация`, `implement(Operation, { … })`) — the
  endpoint that serves the operation. An operation with an `http:` section
  is implemented by `httpEndpoint.implement(Operation, { … })`: the same
  execution vocabulary, but the endpoint answers over HTTP.
- **Caller** (`вызыватель`, `Operation.caller`) — the object for calling
  an operation of the `request` kind: `call(input, meta?)`.
- **Emitter** (`эмиттер`, `Operation.emitter`) — the object for sending a
  `command` or an `event`: `emit(payload, meta?)`.
- **Subscriber** (`подписчик`, `subscriber`) — the name of the
  implementation of an event; it is required for an event and
  inexpressible for a request and a command. At a broker it becomes the
  name of the queue group.
- **Bus** (`шина`) — the transport that delivers operation calls. Inside
  one process it is `InProcessBus`, between processes it is the transport
  assigned as the intercom. An application has exactly one bus.
- **Subject** (`subject`) — the address of a message in the bus. It
  matches the name of the operation.
- **Dispatch policy** (`политика диспатча`) — how to call an
  implementation that lives in the same process: `local-first` (through
  the bus of the process) or `always-remote` (through the broker, as if
  the implementation were in another process). It is set by the
  `NESTLING_PORTS_DISPATCH` configuration.
- **Split deployment** (`split-развёртывание`) — the features of one
  application are started in different processes and talk through a
  broker. The code of the features does not change.
- **`durable`** — a command or an event whose delivery survives a restart
  of the receiver. It requires a broker with persistence. For a request it
  is inexpressible: the caller waits for the response.
- **Idempotency key** (`ключ идемпотентности`, `idempotencyKey`) — the
  identifier of a message in the envelope. For a command it is set by the
  caller, for an event by the publisher. The receiver recognises a repeated
  delivery by it.
- **Inbox mark** (`отметка приёма`) — the record «this consumer has
  processed this message» in the database of the receiver. It is stored by
  the pair «the pattern of the endpoint and the idempotency key» and is
  committed by the same transaction as the business change. It is put by
  the layer of the `@nestlingjs/inbox` package; a repeat finishes with an
  early success without reaching the handler.

## Configuration (`@nestlingjs/app`)

- **Section** (`секция`, `makeConfig('prefix', { … })`) — an object
  «field → schema». It is injected as a dependency; it does not need to be
  registered.
- **Key** (`ключ`) — the name of the variable a field is read from:
  `APP_LOG_LEVEL`. It is derived from the prefix of the section and the
  name of the field; `from('NAME', schema)` sets the exact name.
- **Source** (`источник`) — where the values come from: `env()`,
  `dotenv(path)`, Vault, the test `vars()`. It is bound to keys at run:
  `run({ config: [bind(source, { keys })] })`. With no `config`, the
  default applies: the environment, then `.env`.
- **Binding** (`привязка`, `bind(source, { keys, optional, timeout })`) —
  the source and the keys it is responsible for. The order of the list
  sets the priority.
- **`.keys`** — the exported description of the keys of a section. It
  grants the right to bind a source to them, but not the right to read the
  values.
- **Secret** (`секрет`, `secret(schema)`) — a field whose value does not
  reach logs and reports.
- **Reloadable** (`reloadable`) — a section whose values are updated
  without restarting the application. The changes arrive through
  `onChange(signal, cb)`.
- **Derived field** (`вычисляемое поле`, `derived(deps, fn)`, the third
  argument of `makeConfig`) — a field of a section without a key,
  computed from its other fields. It inherits the secrecy of its
  dependencies and is recomputed on a reload.
- **Snapshot** (`снимок`) — the values of all sources read on the phase
  0 BOOTSTRAP; the sections are computed from it on ASSEMBLE.

## Streaming (`@nestlingjs/operations`)

- **`Topic<T>`** — a source of events with any number of subscribers.
  `push` does not wait for subscribers; every subscription has its own
  buffer.
- **Slow consumer** (`медленный подписчик`) — a subscription whose buffer
  has overflowed. What to do is decided by `onSlowConsumer`:
  `drop-oldest` or `disconnect`.
- **Backpressure** (`backpressure`) — the consumer reads the
  `AsyncIterable` at its own pace, and the producer does not outrun it.
- **`AbortSignal`** — the standard way to cancel a request or a
  subscription, or to stop the application.

## Testing (`@nestlingjs/testing`)

- **App test** (`App-тест`) — a test that assembles the application
  through `assembleTest(app, …)` and calls the endpoints directly:
  `testApp.call(Endpoint, payload)`. The socket is not opened.
- **`overrides`** — the replacement of graph nodes in a test assembly:
  `[[Token, value]]`.
- **`check(args?)`** — a method of the application declaration: check the
  graph, go through the phases 0–1 and return the report on the features,
  switches, endpoints, transports and operations. Instances are not
  created, transports are not started.
- **`vars({ … })`** — a configuration source for tests.
