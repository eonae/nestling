# @nestling/container

Контейнер зависимостей на стандартных декораторах ECMAScript с полной
проверкой графа на сборке. `build()` строит граф и останавливается на
отсутствующей зависимости, цикле или классе не той роли; экземпляры создаёт
`init()` — целиком и в топологическом порядке. Основа остальных пакетов
Nestling; работает и отдельно.

> 🚧 Активная разработка, API может меняться. Декораторы стандартные:
> `experimentalDecorators` и `reflect-metadata` не нужны.
> Дизайн: [`docs/design/container.md`](../../docs/design/container.md).
> Гайд: [глава 22. Логгер с именем потребителя и сбор вкладов](../../docs/guide/22-token-families.md),
> [глава 17. Запускать только часть фич](../../docs/guide/17-select.md).

## Установка

```bash
npm install @nestling/container
```

## Минимальный пример

```typescript
import { classProvider, Component, ContainerBuilder, makeModule, makeToken }
  from '@nestling/container';

// DI-токен даёт интерфейсу имя во время выполнения
const ILogger = makeToken<ILogger>('ILogger');

@Component([])
class ConsoleLogger implements ILogger {
  log(message: string) {
    console.log(message);
  }
}

// Зависимости перечисляются явно; порядок совпадает с конструктором
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

## Экспорты

- **DI-токены и общее** ([design](../../docs/design/container.md)) —
  `ClassToken`, `Constructor`, `InjectionToken`, `isToken`, `makeToken`,
  `Token`, `tokenId`, `UnwrapInjectionTokens`.
- **Сборка контейнера** — `BuiltContainer`, `ContainerBuilder`,
  `ContainerBuilderOptions`, `FamilyOverrideEntry`, `HealthResource`,
  `TokenOverride`.
- **Провайдеры** — `asFamilyMember`, `classProvider`, `ClassProviderDefinition`,
  `ClassRole`, `Component`, `decoratorOf`, `dependenciesOf`, `factoryProvider`,
  `FactoryProviderDefinition`, `FactoryProviderWithDeps`, `FamilyAllToken`,
  `FamilyAutoToken`, `FamilyMemberToken`, `familyOf`, `familyProvider`,
  `FamilyProviderDefinition`, `getAllSentinelFamily`, `getAutoSentinelFamily`,
  `Handler`, `HealthStatus`, `isClassDefinition`, `isDefinition`,
  `isFactoryProvider`, `isFamilyDefinition`, `isResourceDefinition`,
  `isTokenFamily`, `isValueDefinition`, `makeTokenFamily`, `ModuleProvider`,
  `Provider`, `ProviderDefinition`, `ProvidersFactory`, `readRoleMeta`,
  `resolveAutoDependency`, `Resource`, `ResourceClass`, `resourceProvider`,
  `ResourceProviderDefinition`, `ResourceProviderWithDeps`, `RoleMetadata`,
  `SyncValue`, `TokenFamily`, `UnwrapTokens`, `valueProvider`,
  `ValueProviderDefinition`.
- **Жизненный цикл** — `getLifecycleHooks`, `Hook`, `LifecycleHooks`,
  `LifecycleMetadata`, `OnStart`, `resolveHook`.
- **Модули** — `isModule`, `makeModule`, `Module`.
- **Переключатели** — `AnySwitch`, `BRANCH`, `Branchable`, `branchCandidates`,
  `BranchMeta`, `isSwitch`, `isSwitchBranch`, `makeSwitch`, `NoExtraValues`,
  `PickTable`, `resolveBranches`, `Switch`, `SwitchBranch`, `switchesUsed`,
  `switchOf`, `SwitchOptions`, `SwitchValues`, `TableItems`, `Toggle`,
  `ToggleSwitch`, `Unbranch`, `unknownValueMessage`.
- **Граф** — `DIGraph`, `DINode`, `DINodeData`, `DINodeMetadata`, `JsonDIGraph`,
  `JsonDINode`.
- **Подпуть `./tokens`** — те же имена группы «DI-токены и общее» плюс
  семейства, без графа и провайдеров: фронтенду хватает объявления DI-токена.

## Границы пакета

Контейнер держит граф и жизненный цикл. Запросов, транспортов и
конфигурации он не знает: их приносит `@nestling/app`.
