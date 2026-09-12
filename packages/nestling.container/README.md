# @nestlingjs/container

Контейнер зависимостей на стандартных декораторах ECMAScript с полной
проверкой графа на сборке. `build()` строит граф и останавливается на
отсутствующей зависимости, цикле или классе не той роли; экземпляры создаёт
`init()` — целиком и в топологическом порядке. Основа остальных пакетов
Nestling; работает и отдельно.

> 🚧 Активная разработка, API может меняться. Декораторы стандартные:
> `experimentalDecorators` и `reflect-metadata` не нужны.
> Дизайн: [`docs/design/container.md`](../../docs/design/container.md).
> Гайд: [рецепт «Зависимости по имени и сбор вкладов из модулей»](../../docs/recipes/token-families.md),
> [глава 19. Запускать только часть фич](../../docs/guide/19-select.md).

## Установка

```bash
npm install @nestlingjs/container
```

## Минимальный пример

```typescript
import { classProvider, Component, ContainerBuilder, makeModule, makeToken }
  from '@nestlingjs/container';

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
  `Constructor`, `InjectionToken`, `isToken`, `makeToken`, `Token`,
  `tokenId`, `UnwrapInjectionTokens`.
- **Сборка контейнера** — `BuiltContainer`, `ContainerBuilder`,
  `ContainerBuilderOptions`, `FamilyOverrideEntry`, `HealthResource`,
  `TokenOverride`.
- **Провайдеры** — `asFamilyMember`, `classProvider`, `Component`,
  `dependenciesOf`, `factoryProvider`, `familyProvider`,
  `getAutoSentinelFamily`, `Handler`, `HealthStatus`, `makeTokenFamily`,
  `ModuleProvider`, `Provider`, `Resource`, `resourceProvider`,
  `ResourceProviderDefinition`, `TokenFamily`, `valueProvider`.
- **Жизненный цикл** — `OnStart`.
- **Модули** — `makeModule`, `Module`.
- **Переключатели** — `AnySwitch`, `Branchable`, `branchCandidates`,
  `makeSwitch`, `resolveBranches`, `switchesUsed`, `SwitchValues`.
- **Подпуть `./tokens`** — `makeToken`, `makeTokenFamily`, `Token`,
  `TokenFamily`, `tokenId`: объявление DI-токена и семейства без билдера,
  графа и провайдеров.

## Границы пакета

Контейнер держит граф и жизненный цикл. Запросов, транспортов и
конфигурации он не знает: их приносит `@nestlingjs/app`.
