# @nestlingjs/container

A dependency container on standard ECMAScript decorators, with a full
check of the graph at build. `build()` builds the graph and stops on a
missing dependency, a cycle or a class of the wrong role. `init()`
creates the instances, as a whole and in topological order. It is the
basis of the other Nestling packages, and it also works on its own.

> 🚧 Active development, the API may change. The decorators are
> standard: `experimentalDecorators` and `reflect-metadata` are not
> needed.
> Design: [`docs/en/design/container.md`](../../docs/en/design/container.md).
> Guide: [recipe "Dependencies by name and contributions collected from modules"](../../docs/en/recipes/token-families.md),
> [chapter 19. Start only a part of the features](../../docs/en/guide/19-select.md).

## Install

```bash
npm install @nestlingjs/container
```

## Minimal example

```typescript
import { classProvider, Component, ContainerBuilder, makeModule, makeToken }
  from '@nestlingjs/container';

// a DI token gives the interface a name at runtime
const ILogger = makeToken<ILogger>('ILogger');

@Component([])
class ConsoleLogger implements ILogger {
  log(message: string) {
    console.log(message);
  }
}

// dependencies are listed explicitly, in the order of the constructor
@Component([ILogger])
class UserService {
  constructor(private logger: ILogger) {}
}

const UsersModule = makeModule({
  name: 'module:users',
  providers: [classProvider(ILogger, ConsoleLogger), UserService],
});

const container = new ContainerBuilder().register(UsersModule).build();

await container.init();
container.getOrThrow(UserService);
await container.destroy();
```

## Exports

- **DI tokens and common** ([design](../../docs/en/design/container.md)) —
  `Constructor`, `InjectionToken`, `isToken`, `makeToken`, `Token`,
  `tokenId`, `UnwrapInjectionTokens`.
- **Container build** — `BuiltContainer`, `ContainerBuilder`,
  `ContainerBuilderOptions`, `FamilyOverrideEntry`, `HealthResource`,
  `TokenOverride`.
- **Providers** — `asFamilyMember`, `classProvider`, `Component`,
  `dependenciesOf`, `factoryProvider`, `familyProvider`,
  `getAutoSentinelFamily`, `Handler`, `HealthStatus`, `makeTokenFamily`,
  `ModuleProvider`, `Provider`, `Resource`, `resourceProvider`,
  `ResourceProviderDefinition`, `TokenFamily`, `valueProvider`.
- **Lifecycle** — `OnStart`.
- **Modules** — `makeModule`, `Module`.
- **Switches** — `AnySwitch`, `Branchable`, `branchCandidates`,
  `makeSwitch`, `resolveBranches`, `Switch`, `SwitchBranch`,
  `switchesUsed`, `SwitchOptions`, `SwitchValues`, `Toggle`,
  `ToggleSwitch`.
- **Subpath `./tokens`** — `makeToken`, `makeTokenFamily`, `Token`,
  `TokenFamily`, `tokenId`: the declaration of a DI token and a family
  without the builder, the graph and providers.

## Package boundaries

The container holds the graph and the lifecycle. It knows nothing about
requests, transports and configuration: `@nestlingjs/app` brings them.
