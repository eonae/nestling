# Приложение В. Карта понятий

> Собрано по главам гайда (2026-09-05). Понятие ведёт в главу, где оно вводится, и в файл примера, где показано.

## Часть 1. Первый сервис

| Понятие | Глава | Файл примера |
|---|---|---|
| `httpEndpoint` | [1](./01-first-service.md) | `packages/examples.users-service/src/users/endpoints/list-users.endpoint.ts` |
| паттерн | [1](./01-first-service.md) | `packages/examples.users-service/src/users/endpoints/list-users.endpoint.ts` |
| `makeFeature` | [1](./01-first-service.md) | `packages/examples.users-service/src/users.feature.ts` |
| `makeApp` | [1](./01-first-service.md) | `packages/examples.users-service/src/app.ts` |
| `app.assemble()` | [1](./01-first-service.md) | `packages/examples.users-service/src/main.ts` |
| `http()` | [1](./01-first-service.md) | `packages/examples.users-service/src/app.ts` |
| Standard Schema | [2](./02-input.md) | `packages/examples.users-service/src/users/user.ts` |
| схема `input` | [2](./02-input.md) | `packages/examples.users-service/src/users/endpoints/create-user.endpoint.ts` |
| `bind`, `query()`, `body()` | [2](./02-input.md) | `packages/examples.users-service/src/api/operations.ts` |
| `makeFail` | [3](./03-errors.md) | `packages/examples.users-service/src/users/users.errors.ts` |
| `errors:` | [3](./03-errors.md) | `packages/examples.users-service/src/users/endpoints/get-user.endpoint.ts` |
| `Output<T, typeof Def>` | [3](./03-errors.md) | `packages/examples.users-service/src/users/endpoints/get-user.endpoint.ts` |
| категория отказа | [3](./03-errors.md) | `packages/examples.users-service/src/users/users.errors.ts` |
| `Ok.created` | [3](./03-errors.md) | `packages/examples.users-service/src/users/endpoints/create-user.endpoint.ts` |
| `Ok.noContent()` | [3](./03-errors.md) | `packages/examples.users-service/src/users/endpoints/delete-user.endpoint.ts` |
| `.is()` | [3](./03-errors.md) | `packages/examples.users-service/src/users/endpoints/create-user.endpoint.spec.ts` |
| поле `handler` | [4](./04-handler-class.md) | `packages/examples.users-service/src/users/endpoints/list-users.endpoint.ts` |
| класс-хендлер | [4](./04-handler-class.md) | `packages/examples.users-service/src/users/endpoints/create-user.endpoint.ts` |
| `makeToken` | [5](./05-repository.md) | `packages/examples.users-service/src/users/users.repository.ts` |
| `@Injectable` | [5](./05-repository.md) | `packages/examples.users-service/src/database.ts` |
| `@OnInit` | [5](./05-repository.md) | `packages/examples.users-service/src/database.ts` |
| `@OnDestroy` | [5](./05-repository.md) | `packages/examples.users-service/src/database.ts` |
| `providers` | [5](./05-repository.md) | `packages/examples.users-service/src/users.feature.ts` |
| `valueProvider`, `factoryProvider` | [5](./05-repository.md) | `packages/examples.container/src/config/app.config.ts` |
| `makeConfig` | [6](./06-config.md) | `packages/examples.users-service/src/app.config.ts` |
| `from` | [6](./06-config.md) | `packages/examples.users-service/src/app.config.ts` |
| `Config<T>` | [6](./06-config.md) | `packages/examples.users-service/src/users/endpoints/list-users.endpoint.ts` |
| `secret` | [6](./06-config.md) | `packages/examples.users-service/src/app.config.ts` |
| `assembleTest(app, …)` | [7](./07-testing.md) | `packages/examples.users-service/src/app.spec.ts` |
| фаза | [7](./07-testing.md) | `packages/examples.users-service/src/app.spec.ts` |
| `testApp.call` | [7](./07-testing.md) | `packages/examples.users-service/src/app.spec.ts` |
| `unwrap` | [7](./07-testing.md) | `packages/examples.users-service/src/app.spec.ts` |
| `overrides` | [7](./07-testing.md) | `packages/examples.users-service/src/app.spec.ts` |
| `testApp.pruned` | [7](./07-testing.md) | `packages/examples.users-service/src/app.spec.ts` |
| `vars` | [7](./07-testing.md) | `packages/examples.users-service/src/app.spec.ts` |

## Часть 2. Сервис в проде

| Понятие | Глава | Файл примера |
|---|---|---|
| `makePipeline` | [8](./08-logging.md) | `packages/examples.users-service/src/observability.ts` |
| `.pre` | [8](./08-logging.md) | `packages/examples.users-service/src/observability.ts` |
| `.finally` | [8](./08-logging.md) | `packages/examples.users-service/src/observability.ts` |
| `withRequestId` | [8](./08-logging.md) | `packages/examples.users-service/src/observability.ts` |
| outcome | [8](./08-logging.md) | `packages/examples.users-service/src/observability.ts` |
| `ExtendableContext` | [8](./08-logging.md) | `packages/examples.users-service/src/observability.ts` |
| `Ctx` | [8](./08-logging.md) | `packages/examples.users-service/src/users/users.repository.ts` |
| `CtxReader` | [8](./08-logging.md) | `packages/examples.users-service/src/users/users.repository.ts` |
| `compose` | [8](./08-logging.md), [9](./09-auth.md) | `packages/examples.users-service/src/auth.ts` |
| отказы слоя (`.pre(unit, { errors })`) | [9](./09-auth.md) | `packages/examples.users-service/src/auth.ts` |
| эффективное множество отказов | [9](./09-auth.md) | `packages/examples.users-service/src/users/endpoints/delete-user.endpoint.ts` |
| `everyEndpoint` | [9](./09-auth.md) | `packages/examples.users-service/src/app.ts` |
| `.hasLayer` | [9](./09-auth.md) | `packages/examples.users-service/src/app.ts` |
| `detached` | [9](./09-auth.md) | `packages/examples.users-service/src/ops.plugin.ts` |
| `multipart` | [10](./10-files-and-streams.md) | `packages/examples.users-service/src/users/endpoints/upload-avatar.endpoint.ts` |
| `upload` | [10](./10-files-and-streams.md) | `packages/examples.users-service/src/users/endpoints/upload-avatar.endpoint.ts` |
| `FilePart` | [10](./10-files-and-streams.md) | `packages/examples.users-service/src/users/endpoints/upload-avatar.endpoint.ts` |
| `stream` | [10](./10-files-and-streams.md) | `packages/examples.users-service/src/users/endpoints/export-users.endpoint.ts` |
| `.limit()` | [10](./10-files-and-streams.md) | `packages/examples.users-service/src/users/endpoints/export-users.endpoint.ts` |
| item-цепочка | [10](./10-files-and-streams.md) | `packages/examples.users-service/src/users/endpoints/export-users.endpoint.ts` |
| `.gapTimeout()` | [10](./10-files-and-streams.md) | `packages/examples.users-service/src/users/endpoints/import-users.endpoint.ts` |
| `openapi()` | [11](./11-openapi-and-client.md) | `packages/examples.users-service/src/app.ts` |
| `zodConverter` | [11](./11-openapi-and-client.md) | `packages/examples.users-service/src/app.ts` |
| `doc:` | [11](./11-openapi-and-client.md) | `packages/examples.users-service/src/users/endpoints/delete-user.endpoint.ts` |
| `makeRequest` | [11](./11-openapi-and-client.md), [12](./12-features.md) | `packages/examples.users-service/src/api/operations.ts` |
| `http:` | [11](./11-openapi-and-client.md) | `packages/examples.users-service/src/api/operations.ts` |
| `makeClient` | [11](./11-openapi-and-client.md) | `packages/examples.users-service/src/api/client.ts` |

## Часть 3. Приложение растёт

| Понятие | Глава | Файл примера |
|---|---|---|
| `implement` | [12](./12-features.md), [13](./13-events.md) | `packages/examples.app-with-http/src/features/quotas/claim-quota.endpoint.ts` |
| `.caller` | [12](./12-features.md) | `packages/examples.app-with-http/src/features/users/endpoints/create-user.endpoint.ts` |
| сверка отказов слоя с операцией | [12](./12-features.md) | `packages/examples.app-with-http/src/api/operations.ts` |
| `deadline` | [12](./12-features.md) | `packages/examples.app-with-http/src/features/users/endpoints/create-user.endpoint.ts` |
| `makePlugin` | [12](./12-features.md) | `packages/examples.app-with-http/src/plugins/logging/logging.plugin.ts` |
| `factoryProvider` | [12](./12-features.md) | `packages/examples.app-with-http/src/plugins/logging/logging.plugin.ts` |
| `makeModule` | [12](./12-features.md) | `packages/examples.app-with-http/src/features/users/users.feature.ts` |
| `NESTLING_PORTS_DISPATCH` | [12](./12-features.md), [17](./17-split.md) | `packages/examples.app-with-http/src/app.spec.ts` |
| `makeEvent` | [13](./13-events.md) | `packages/examples.app-with-http/src/operations.ts` |
| `subscriber` | [13](./13-events.md) | `packages/examples.app-with-http/src/features/quotas/user-registered-in-quotas.endpoint.ts` |
| `.emitter` | [13](./13-events.md) | `packages/examples.app-with-http/src/features/users/endpoints/create-user.endpoint.ts` |
| `makeCommand` | [13](./13-events.md) | `packages/examples.app-with-http/src/operations.ts` |
| `idempotencyKey` | [13](./13-events.md) | `packages/examples.app-with-http/src/features/users/endpoints/create-user.endpoint.ts` |
| `withIdempotencyKey` | [13](./13-events.md) | `packages/examples.app-with-http/src/features/quotas/signup-recorded.endpoint.ts` |
| `BusTransport$` | [13](./13-events.md) | `packages/examples.app-with-http/src/app.ts` |
| вид операции | [13](./13-events.md) | `packages/examples.app-with-http/src/operations.ts` |
| `Topic` | [14](./14-live-feed.md) | `packages/examples.app-with-http/src/features/users/activity.hub.ts` |
| `AbortSignal` | [14](./14-live-feed.md) | `packages/examples.app-with-http/src/features/users/activity.hub.ts` |
| `events` | [14](./14-live-feed.md) | `packages/examples.app-with-http/src/features/users/endpoints/activity-stream.endpoint.ts` |
| `sse:` | [14](./14-live-feed.md) | `packages/examples.app-with-http/src/features/users/endpoints/activity-stream.endpoint.ts` |
| `tracked` | [14](./14-live-feed.md), [23](./23-ops.md) | `packages/examples.app-with-http/src/features/users/endpoints/activity-stream.endpoint.ts` |
| `onSlowConsumer` | [14](./14-live-feed.md), [25](./25-extending.md) | `packages/nestling.subscriptions/src/registry.ts` |
| `select` | [15](./15-testing-features.md), [16](./16-select.md) | `packages/examples.split-nats/src/isolated.spec.ts` |
| `stub` / `stubs:` | [15](./15-testing-features.md) | `packages/examples.split-nats/src/isolated.spec.ts` |
| `testApp.emit` | [15](./15-testing-features.md) | `packages/examples.split-nats/src/isolated.spec.ts` |
| `checkTopologies` | [15](./15-testing-features.md), [16](./16-select.md) | `packages/examples.split-nats/src/isolated.spec.ts` |
| `contextValue` | [15](./15-testing-features.md) | `packages/examples.app-with-http/src/app.spec.ts` |
| `includeDeps` | [15](./15-testing-features.md), [16](./16-select.md) | `packages/examples.app-with-http/src/app.spec.ts` |

## Часть 4. Разворачивать по частям

| Понятие | Глава | Файл примера |
|---|---|---|
| `load()` | [16](./16-select.md) | `packages/examples.app-with-http/src/main.ts` |
| `nats()` | [17](./17-split.md) | `packages/examples.split-nats/src/app.ts` |
| `intercom` | [17](./17-split.md) | `packages/examples.split-nats/src/app.ts` |
| Split-развёртывание | [17](./17-split.md), [23](./23-ops.md) | `packages/examples.split-nats/src/app.ts` |
| `durable` | [17](./17-split.md) | `packages/examples.split-nats/src/operations.ts` |
| `contextVar` | [17](./17-split.md) | `packages/examples.split-nats/src/context.ts` |
| `propagate` | [17](./17-split.md) | `packages/examples.split-nats/src/context.ts` |
| Subject | [17](./17-split.md) | `packages/examples.split-nats/src/split.spec.ts` |
| снапшот операций | [18](./18-compatibility.md) | `packages/examples.app-with-http/operations.snapshot.json` |
| `diffOperations` | [18](./18-compatibility.md) | `packages/examples.app-with-http/src/operations.compat.spec.ts` |

## Часть 5. Редкие задачи

| Понятие | Глава | Файл примера |
|---|---|---|
| `rawBody` | [19](./19-webhook.md) | `packages/examples.app-with-http/src/features/users/endpoints/user-webhook.endpoint.ts` |
| `cliEndpoint` | [20](./20-cli.md) | `packages/examples.simple-cli/src/commands/greet.command.ts` |
| `makeDispatch` | [20](./20-cli.md), [24](./24-standalone.md) | `packages/examples.simple-cli/src/main.ts` |
| `serve` | [20](./20-cli.md), [24](./24-standalone.md) | `packages/examples.simple-cli/src/main.ts` |
| `makeTokenFamily` | [21](./21-token-families.md) | `packages/examples.container/src/logging/registry.ts` |
| `familyProvider` | [21](./21-token-families.md) | `packages/examples.container/src/logging/logging.plugin.ts` |
| `.auto` | [21](./21-token-families.md) | `packages/examples.container/src/users/users.repository.ts` |
| `classProvider` | [21](./21-token-families.md) | `packages/examples.container/src/database/database.module.ts` |
| `.all` | [21](./21-token-families.md) | `packages/examples.container/src/health/health.service.ts` |
| топологический порядок | [21](./21-token-families.md) | `packages/examples.container/src/health/health.service.ts` |
| objectSource | [22](./22-config-sources.md) | `packages/examples.container/src/main.ts` |
| `configKernel` | [22](./22-config-sources.md) | `packages/examples.container/src/container.ts` |
| `.keys` | [22](./22-config-sources.md) | `packages/examples.container/src/config/app.config.ts` |
| `reloadable` | [22](./22-config-sources.md) | `packages/examples.container/src/runtime/runtime.config.ts` |
| `subscriptions()` | [23](./23-ops.md) | `packages/examples.app-with-http/src/app.ts` |
| `ContainerBuilder` | [24](./24-standalone.md) | `packages/examples.container/src/container.ts` |
| satellite | [25](./25-extending.md) | `packages/nestling.subscriptions/src/module.ts` |
| subpath `./testing` | [25](./25-extending.md) | `packages/nestling.transport.nats/package.json` |
| граница ядра | [25](./25-extending.md) | `packages/nestling.subscriptions/src/module.ts` |

## Не показано в гайде

- Backpressure — [design/streaming.md](../design/streaming.md)
- Жадная сборка — [design/container.md](../design/container.md)
