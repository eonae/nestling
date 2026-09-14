# From NestJS

> The correspondences are verified against `design/` and the package READMEs (2026-09-08).

The tables below answer the question «what does Nestling write for
something I did like this in NestJS». The «What differs» column gives
one phrase about the difference that affects the code. The details are
in the chapters that the last column links to.

## Application structure

| NestJS | Nestling | What differs | Chapter |
|---|---|---|---|
| `NestFactory.create(AppModule)` and `app.listen()` | `makeApp({ features, transports }).build().run()` | `run()` takes the application through the phases and sets up the shutdown on `SIGTERM` itself | [1](./guide/01-first-service.md) |
| `@Module({ providers, imports })` | `makeModule({ providers, dependsOn })` | a module is an object, not a class; it has no lifecycle hooks | [14](./guide/14-features.md) |
| `@Module({ controllers })` | `makeFeature({ providers, endpoints })` | the endpoints are listed by the feature, not the module; a feature can be moved into a separate process | [1](./guide/01-first-service.md), [14](./guide/14-features.md) |
| `exports` of a module | none | visibility rests on ES modules: a DI token that is not exported from the file cannot be injected | [6](./guide/06-repository.md) |
| `@Global()` | `makePlugin` and the `plugins:` field of the root | a plugin is present in every process, and it is addressed by a DI token | [14](./guide/14-features.md) |
| `DynamicModule`, `forRoot(options)` | a function that returns a module or a plugin | the value is created once and passed into the root | [14](./guide/14-features.md) |
| `@Controller()` with `@Get()`, `@Post()` | `httpEndpoint.get(path, { input, output, handler })` | an endpoint is a value with an address, schemas and a handler; the HTTP method names the constructor, the path is the first argument; the handler is a function or a class with the `handle` method | [1](./guide/01-first-service.md), [5](./guide/05-handler-class.md) |

## Dependencies

| NestJS | Nestling | What differs | Chapter |
|---|---|---|---|
| `@Injectable()` with `emitDecoratorMetadata` | `@Component([deps])`, `@Resource([deps])`, `@Handler([deps])` | the decorator names the role of the class, the dependencies are listed as an explicit list of DI tokens; `reflect-metadata` is not needed | [6](./guide/06-repository.md) |
| `@Inject(TOKEN)` | a DI token in the `deps` list and the position in the constructor | an interface gets the DI token `Name$` through `makeToken` | [6](./guide/06-repository.md) |
| `forwardRef()` | none | a dependency cycle is a `build()` error | [6](./guide/06-repository.md) |
| `Scope.REQUEST` | `Ctx(Var)` and a pipeline layer that puts the value | providers stay singletons, and request data is read from the asynchronous context | [9](./guide/09-logging.md) |
| `Scope.TRANSIENT` with `INQUIRER` | `Family.auto` | a family member named after the consumer is created at build, not on every injection | [recipe](./recipes/token-families.md) |
| a provider with `useFactory` and `inject` | `factoryProvider(token, factory, deps)` | the same meaning, the dependencies are positional | [6](./guide/06-repository.md) |
| `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy` | the static `acquire` and `release` of a resource, `@OnStart()` on a provider method | the acquisition follows the topological order of the graph, the release the reverse one; there is one start hook | [6](./guide/06-repository.md) |
| `ModuleRef.get()` | none | the container is not exposed outward; instances are obtained through `deps` or in `@OnStart` | [6](./guide/06-repository.md) |

## Request handling

| NestJS | Nestling | What differs | Chapter |
|---|---|---|---|
| `@Param()`, `@Query()`, `@Body()` | the `input` schema and the field placement rule | a field is taken from the path by the parameter name, from the query for methods without a body, from the body for the rest; `bind` changes the place | [3](./guide/03-input.md) |
| `ValidationPipe` with class-validator | the `input` schema | the input is validated always, before the handler, by Standard Schema: zod, valibot, arktype | [3](./guide/03-input.md) |
| `Middleware` | a `.pre` step | the step extends the context with typed fields and does not call `next()` | [9](./guide/09-logging.md) |
| `Guard` | a `.pre` step that returns a failure | the failure is declared in the `errors:` of the endpoint; the handler is not called | [10](./guide/10-auth.md) |
| `Interceptor` | `.pre`, `.ok`, `.finally` steps | three separate phases instead of a wrapper around the call | [9](./guide/09-logging.md) |
| `ExceptionFilter` | a `.catch` step | replaces one failure with another; a failure cannot be turned into a success | [recipe](./recipes/alternatives.md) |
| `HttpException` | `makeFail` and the `errors:` list | a failure is a value with a machine code; a failure outside the list becomes `internal_error` | [4](./guide/04-errors.md) |
| `@HttpCode(201)` | `Ok.created(value)` | the success status is set on the response value and does not depend on the transport | [4](./guide/04-errors.md) |
| `@Header()`, `@Res().cookie()`, `@Redirect()` | `HttpResponse.of(ok, { headers, cookies })`, `HttpResponse.redirect(location)` | a header, a cookie and a redirect are the HTTP form of the response; it is allowed where the address is declared by the transport | [10](./guide/10-auth.md) |
| `StreamableFile`, a response through `@Res()` | the io shapes `stream(T)`, `events(T)`, `multipart()` | the handler returns an `AsyncIterable`, the transport chooses NDJSON or SSE | [12](./guide/12-files-and-streams.md), [17](./guide/17-live-feed.md) |
| `FileInterceptor` | `multipart({ fields, files })` and `upload({ maxSize, mime })` | the limit and the type are checked during parsing, a file over the limit is not buffered | [12](./guide/12-files-and-streams.md) |
| `@nestjs/swagger` decorators | the `openapi()` plugin and the `doc:` slot | the document is derived from the same schemas that validate requests | [13](./guide/13-openapi-and-client.md) |

## Interaction between application parts

| NestJS | Nestling | What differs | Chapter |
|---|---|---|---|
| injecting the service of another module | the `makeRequest` operation and `Operation.caller` | features are linked only by operations; a direct edge between features is a build error | [14](./guide/14-features.md) |
| `EventEmitter2`, `@OnEvent()` | `makeEvent`, `Operation.emitter`, `implement(Event, { subscriber })` | the event is described by a schema; the subscriber is named explicitly | [15](./guide/15-events.md) |
| `@MessagePattern()`, `ClientProxy` | `implement(Operation)` and `Operation.caller` | the calling code is the same in one process and through the broker | [14](./guide/14-features.md), [20](./guide/20-split.md) |
| `@nestjs/microservices` with the NATS transport | `nats()` in `transports:` and `intercom:` | the bus is an ordinary transport, and the role of the carrier of operations is assigned by a field of the root | [20](./guide/20-split.md) |
| a hand-written HTTP client | `makeClient(operations, config)` | the client is built from the same operations and restores failures by code | [13](./guide/13-openapi-and-client.md) |

## Configuration and tests

| NestJS | Nestling | What differs | Chapter |
|---|---|---|---|
| `ConfigModule.forRoot()` and `ConfigService.get('X')` | `makeConfig(prefix, fields)` and injecting the section | the section is typed by a schema and validated at start; it does not need to be registered | [7](./guide/07-config.md) |
| `ConfigModule` with `load` and `validationSchema` | `run({ config: [bind(source, { keys: Section.keys })] })` | a source is bound to keys, not to a module | [recipe](./recipes/config-sources.md) |
| `Test.createTestingModule()` with `overrideProvider()` | `buildTest(app, { overrides })` | the test builds the same application through the same phases; the socket is not opened | [8](./guide/08-testing.md) |
| `supertest` against `app.getHttpServer()` | `testApp.call(Endpoint, payload)` | the request goes through the full pipeline without the network; e2e on port `0` stays a separate level | [8](./guide/08-testing.md), [18](./guide/18-testing-features.md) |
| a mock of the service of a neighbour module | `stubs: [stub(Operation, impl)]` | the response of the stub is validated by the schema of the operation | [18](./guide/18-testing-features.md) |

## What Nestling does not have

- `forwardRef`: a dependency cycle does not build.
- The `REQUEST` and `TRANSIENT` scopes: request data lives in the
  asynchronous context, an instance per consumer is given by a DI token
  family.
- `exports` on a module: ES modules hold the visibility boundary.
- `next()` in request handling: pipeline steps do not wrap each other.
- A separate layer of controllers: an endpoint is a declaration with a
  handler.
