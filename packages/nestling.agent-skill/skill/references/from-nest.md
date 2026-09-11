# From NestJS

What a thing is called in NestJS and what replaces it here. The right-hand
column is the difference that changes the code. For the full list of names
behind each replacement, read the README of the package that owns it —
[`@nestlingjs/app`](https://www.npmjs.com/package/@nestlingjs/app),
[`@nestlingjs/container`](https://www.npmjs.com/package/@nestlingjs/container),
[`@nestlingjs/operations`](https://www.npmjs.com/package/@nestlingjs/operations),
[`@nestlingjs/transport.http`](https://www.npmjs.com/package/@nestlingjs/transport.http),
[`@nestlingjs/testing`](https://www.npmjs.com/package/@nestlingjs/testing).

## Structure

| NestJS | Nestling | Difference |
|---|---|---|
| `NestFactory.create(AppModule)`, `app.listen()` | `makeApp({ features, transports }).assemble().run()` | `run()` walks the phases and installs the `SIGTERM` handler itself |
| `@Module({ providers, imports })` | `makeModule({ name, providers })` | a module is an object, not a class, and has no lifecycle hooks |
| `@Module({ controllers })` | `makeFeature({ providers, endpoints })` | endpoints belong to a feature, and a feature can be deployed on its own |
| `exports` of a module | nothing | ES modules hold visibility: an unexported token cannot be injected |
| `@Global()` | `makePlugin` and `plugins:` of the root | a plugin is present in every process and is reached by token |
| `DynamicModule`, `forRoot(options)` | a function returning a module or a plugin | the value is created once and passed to the root |
| `@Controller` with `@Get`, `@Post` | `httpEndpoint({ method, path, input, output, handler })` | an endpoint is a value; the handler is a function or a class with `handle` |

## Dependencies

| NestJS | Nestling | Difference |
|---|---|---|
| `@Injectable()` with `emitDecoratorMetadata` | `@Component([…])`, `@Resource([…])`, `@Handler([…])` | the decorator names the role, dependencies are an explicit list of tokens |
| `@Inject(TOKEN)` | the token in the list and the position in the constructor | an interface gets a token `Name$` from `makeToken` |
| `forwardRef()` | nothing | a dependency cycle is a build error |
| `Scope.REQUEST` | `Ctx(Var)` and a layer that sets the variable | providers stay singletons; request data is read from the async context |
| `Scope.TRANSIENT` with `INQUIRER` | `Family.auto` | the member named after its consumer is created during assembly |
| `useFactory` with `inject` | `factoryProvider(token, fn, deps)` | same meaning, positional dependencies, no I/O allowed |
| `OnModuleInit`, `OnModuleDestroy` | `static acquire` and `release` of a resource, `@OnStart()` | acquisition follows the graph order, release the reverse |
| `ModuleRef.get()` | nothing | the container is not handed out; take instances through `deps` |

## Handling a request

| NestJS | Nestling | Difference |
|---|---|---|
| `@Param()`, `@Query()`, `@Body()` | the `input` schema and the placement rule | path by parameter name, query for methods without a body, body otherwise; `bind` overrides |
| `ValidationPipe` with class-validator | the `input` schema | input is always validated, before the handler, through Standard Schema |
| `Middleware` | a `.pre` unit | a unit adds typed fields to the context and never calls `next()` |
| `Guard` | a `.pre` unit that returns a failure | the failure is declared in `errors:`; the handler does not run |
| `Interceptor` | `.pre`, `.ok`, `.finally` units | three separate phases instead of a wrapper around the call |
| `ExceptionFilter` | a `.catch` unit | it exchanges one failure for another; it cannot produce a success |
| `HttpException` | `makeFail` and the `errors:` list | a failure is a value with a code; one outside the list becomes `internal_error` |
| `@HttpCode(201)` | `Ok.created(value)` | the success status is set on the value and does not mention HTTP |
| `@Header()`, `@Res().cookie()`, `@Redirect()` | `HttpResponse.of(ok, { headers, cookies })`, `HttpResponse.redirect(location)` | the HTTP shape of a response, allowed where the transport owns the address |
| `StreamableFile`, `@Res()` | `stream(T)`, `events(T)`, `multipart()` | the handler returns an `AsyncIterable`; the transport picks NDJSON or SSE |
| `FileInterceptor` | `multipart({ fields, files })`, `upload({ maxSize, mime })` | limits are checked while parsing; an oversized file is never buffered |
| `@nestjs/swagger` decorators | the `openapi()` plugin and the `doc:` slot | the document comes from the schemas that validate requests |

## Talking between parts

| NestJS | Nestling | Difference |
|---|---|---|
| injecting a service of another module | `makeRequest` and `Operation.caller` | features are linked only by operations; a direct edge is an assembly error |
| `EventEmitter2`, `@OnEvent()` | `makeEvent`, `Operation.emitter`, `implement(Event, { subscriber })` | the event has a schema and the subscriber is named |
| `@MessagePattern()`, `ClientProxy` | `implement(Operation)` and `Operation.caller` | the calling code is identical in one process and across a broker |
| `@nestjs/microservices` over NATS | `nats()` in `transports:` and `intercom:` | the bus is an ordinary transport; carrying operations is a role assigned to it |
| a hand-written HTTP client | `makeClient(operations, config)` | the client is built from the same operations and restores failures by code |

## Configuration and tests

| NestJS | Nestling | Difference |
|---|---|---|
| `ConfigModule.forRoot()`, `ConfigService.get('X')` | `makeConfig(prefix, fields)` and injecting the section | the section is typed by schema and validated at start; nothing to register |
| `ConfigModule` with `load` and `validationSchema` | `config: [[source, Section.keys]]` in the root | a source is bound to keys, not to a module |
| `Test.createTestingModule()`, `overrideProvider()` | `assembleTest(app, { overrides })` | the test assembles the same application through the same phases |
| `supertest` against `app.getHttpServer()` | `testApp.call(Endpoint, payload)` | the request goes through the whole pipeline without a network |
| mocking a service of a neighbouring module | `stubs: [stub(Operation, impl)]` | the answer of the stub is validated against the operation schema |

## Not here at all

- `forwardRef`: a dependency cycle does not assemble.
- `REQUEST` and `TRANSIENT` scopes: request data lives in the async
  context, and an instance per consumer comes from a token family.
- `exports` of a module: ES modules are the visibility boundary.
- `next()`: pipeline units do not wrap each other.
- A controller layer: an endpoint is a declaration with a handler.
