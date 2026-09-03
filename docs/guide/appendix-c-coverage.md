# Приложение В. Карта понятий

> Собрано по главам гайда (2026-09-03). Понятие ведёт в главу, где оно вводится, и в файл примера, где показано.

## Часть 1. Первый сервис

| Понятие | Глава | Файл примера |
|---|---|---|
| `httpEndpoint` | [1](./01-first-service.md) | `packages/examples.users-service/src/users/endpoints/health.endpoint.ts` |
| паттерн | [1](./01-first-service.md) | `packages/examples.users-service/src/users/endpoints/health.endpoint.ts` |
| `makeFeature` | [1](./01-first-service.md) | `packages/examples.users-service/src/users.feature.ts` |
| `assemble` | [1](./01-first-service.md) | `packages/examples.users-service/src/main.ts` |
| `http()` | [1](./01-first-service.md) | `packages/examples.users-service/src/app.ts` |
| Standard Schema | [2](./02-input.md) | `packages/examples.users-service/src/users/user.ts` |
| схема `input` | [2](./02-input.md) | `packages/examples.users-service/src/users/endpoints/create-user.endpoint.ts` |
| `defineFail` | [3](./03-errors.md) | `packages/examples.users-service/src/users/users.errors.ts` |
| `errors:` | [3](./03-errors.md) | `packages/examples.users-service/src/users/endpoints/get-user.endpoint.ts` |
| `Output<T, E>` | [3](./03-errors.md) | `packages/examples.users-service/src/users/endpoints/get-user.endpoint.ts` |
| `FailOf` | [3](./03-errors.md) | `packages/examples.users-service/src/users/endpoints/get-user.endpoint.ts` |
| `Ok.created` | [3](./03-errors.md) | `packages/examples.users-service/src/users/endpoints/create-user.endpoint.ts` |
| `Ok.noContent()` | [3](./03-errors.md) | `packages/examples.users-service/src/users/endpoints/delete-user.endpoint.ts` |
| `.is()` | [3](./03-errors.md) | `packages/examples.users-service/src/users/endpoints/create-user.endpoint.spec.ts` |
| `makeToken` | [4](./04-repository.md) | `packages/examples.users-service/src/users/users.repository.ts` |
| `@Injectable` | [4](./04-repository.md) | `packages/examples.users-service/src/database.ts` |
| `@OnInit` | [4](./04-repository.md) | `packages/examples.users-service/src/database.ts` |
| `@OnDestroy` | [4](./04-repository.md) | `packages/examples.users-service/src/database.ts` |
| `deps` | [4](./04-repository.md) | `packages/examples.users-service/src/users/endpoints/get-user.endpoint.ts` |
| `makeConfig` | [5](./05-config.md) | `packages/examples.users-service/src/app.config.ts` |
| `from` | [5](./05-config.md) | `packages/examples.users-service/src/app.config.ts` |
| `Config<T>` | [5](./05-config.md) | `packages/examples.users-service/src/users/endpoints/list-users.endpoint.ts` |
| `secret` | [5](./05-config.md) | `packages/examples.users-service/src/app.config.ts` |
| `assembleTest` | [6](./06-testing.md) | `packages/examples.users-service/src/app.spec.ts` |
| фаза | [6](./06-testing.md) | `packages/examples.users-service/src/app.spec.ts` |
| `app.call` | [6](./06-testing.md) | `packages/examples.users-service/src/app.spec.ts` |
| `unwrap` | [6](./06-testing.md) | `packages/examples.users-service/src/app.spec.ts` |
| `overrides` | [6](./06-testing.md) | `packages/examples.users-service/src/app.spec.ts` |
| `app.pruned` | [6](./06-testing.md) | `packages/examples.users-service/src/app.spec.ts` |
| `vars` | [6](./06-testing.md) | `packages/examples.users-service/src/app.spec.ts` |

## Часть 2. Сервис в проде

| Понятие | Глава | Файл примера |
|---|---|---|
| `makePipeline` | [7](./07-logging.md) | `packages/examples.users-service/src/observability.ts` |
| `.pre` | [7](./07-logging.md) | `packages/examples.users-service/src/observability.ts` |
| `.finally` | [7](./07-logging.md) | `packages/examples.users-service/src/observability.ts` |
| `withRequestId` | [7](./07-logging.md) | `packages/examples.users-service/src/observability.ts` |
| outcome | [7](./07-logging.md) | `packages/examples.users-service/src/observability.ts` |
| `ExtendableContext` | [7](./07-logging.md) | `packages/examples.users-service/src/observability.ts` |
| `Ctx` | [7](./07-logging.md) | `packages/examples.users-service/src/users/users.repository.ts` |
| `CtxReader` | [7](./07-logging.md) | `packages/examples.users-service/src/users/users.repository.ts` |
| `compose` | [7](./07-logging.md), [8](./08-auth.md) | `packages/examples.users-service/src/auth.ts` |
| `everyEndpoint` | [8](./08-auth.md) | `packages/examples.users-service/src/app.ts` |
| `.hasLayer` | [8](./08-auth.md) | `packages/examples.users-service/src/app.ts` |
| `detached` | [8](./08-auth.md) | `packages/examples.users-service/src/users/endpoints/health.endpoint.ts` |
| `multipart` | [9](./09-files-and-streams.md) | `packages/examples.users-service/src/users/endpoints/upload-avatar.endpoint.ts` |
| `upload` | [9](./09-files-and-streams.md) | `packages/examples.users-service/src/users/endpoints/upload-avatar.endpoint.ts` |
| `FilePart` | [9](./09-files-and-streams.md) | `packages/examples.users-service/src/users/endpoints/upload-avatar.endpoint.ts` |
| `stream` | [9](./09-files-and-streams.md) | `packages/examples.users-service/src/users/endpoints/export-users.endpoint.ts` |
| `.limit()` | [9](./09-files-and-streams.md) | `packages/examples.users-service/src/users/endpoints/export-users.endpoint.ts` |
| item-цепочка | [9](./09-files-and-streams.md) | `packages/examples.users-service/src/users/endpoints/export-users.endpoint.ts` |
| `.gapTimeout()` | [9](./09-files-and-streams.md) | `packages/examples.users-service/src/users/endpoints/import-users.endpoint.ts` |
| `openapi()` | [10](./10-openapi-and-client.md) | `packages/examples.users-service/src/app.ts` |
| `zodConverter` | [10](./10-openapi-and-client.md) | `packages/examples.users-service/src/app.ts` |
| `doc:` | [10](./10-openapi-and-client.md) | `packages/examples.users-service/src/users/endpoints/delete-user.endpoint.ts` |
| `makeRequest` | [10](./10-openapi-and-client.md), [11](./11-features.md) | `packages/examples.users-service/src/api/operations.ts` |
| `http:` | [10](./10-openapi-and-client.md) | `packages/examples.users-service/src/api/operations.ts` |
| `makeClient` | [10](./10-openapi-and-client.md) | `packages/examples.users-service/src/api/client.ts` |

## Часть 3. Приложение растёт

| Понятие | Глава | Файл примера |
|---|---|---|
| `implement` | [11](./11-features.md), [12](./12-events.md) | `packages/examples.app-with-http/src/features/quotas/quotas.feature.ts` |
| `.caller` | [11](./11-features.md) | `packages/examples.app-with-http/src/features/users/endpoints/create-user.endpoint.ts` |
| `deadline` | [11](./11-features.md) | `packages/examples.app-with-http/src/features/users/endpoints/create-user.endpoint.ts` |
| `makePlugin` | [11](./11-features.md) | `packages/examples.app-with-http/src/plugins/logging/logging.plugin.ts` |
| `factoryProvider` | [11](./11-features.md) | `packages/examples.app-with-http/src/plugins/logging/logging.plugin.ts` |
| `makeModule` | [11](./11-features.md) | `packages/examples.app-with-http/src/features/users/users.feature.ts` |
| `NESTLING_PORTS_DISPATCH` | [11](./11-features.md), [16](./16-split.md) | `packages/examples.app-with-http/src/app.spec.ts` |
| `makeEvent` | [12](./12-events.md) | `packages/examples.app-with-http/src/operations.ts` |
| `subscriber` | [12](./12-events.md) | `packages/examples.app-with-http/src/features/quotas/quotas.feature.ts` |
| `.emitter` | [12](./12-events.md) | `packages/examples.app-with-http/src/features/users/endpoints/create-user.endpoint.ts` |
| `makeCommand` | [12](./12-events.md) | `packages/examples.app-with-http/src/operations.ts` |
| `idempotencyKey` | [12](./12-events.md) | `packages/examples.app-with-http/src/features/users/endpoints/create-user.endpoint.ts` |
| `withIdempotencyKey` | [12](./12-events.md) | `packages/examples.app-with-http/src/features/quotas/quotas.feature.ts` |
| `BusTransport$` | [12](./12-events.md) | `packages/examples.app-with-http/src/root.ts` |
| вид операции | [12](./12-events.md) | `packages/examples.app-with-http/src/operations.ts` |
| `Topic` | [13](./13-live-feed.md) | `packages/examples.app-with-http/src/features/users/activity.hub.ts` |
| `AbortSignal` | [13](./13-live-feed.md) | `packages/examples.app-with-http/src/features/users/activity.hub.ts` |
| `events` | [13](./13-live-feed.md) | `packages/examples.app-with-http/src/features/users/endpoints/activity-stream.endpoint.ts` |
| `sse:` | [13](./13-live-feed.md) | `packages/examples.app-with-http/src/features/users/endpoints/activity-stream.endpoint.ts` |
| `tracked` | [13](./13-live-feed.md), [22](./22-ops.md) | `packages/examples.app-with-http/src/features/users/endpoints/activity-stream.endpoint.ts` |
| `onSlowConsumer` | [13](./13-live-feed.md), [24](./24-extending.md) | `packages/nestling.subscriptions/src/registry.ts` |
| `select` | [14](./14-testing-features.md), [15](./15-select.md) | `packages/examples.split-nats/src/isolated.spec.ts` |
| `stub` / `stubs:` | [14](./14-testing-features.md) | `packages/examples.split-nats/src/isolated.spec.ts` |
| `app.emit` | [14](./14-testing-features.md) | `packages/examples.split-nats/src/isolated.spec.ts` |
| `checkTopologies` | [14](./14-testing-features.md), [15](./15-select.md) | `packages/examples.split-nats/src/isolated.spec.ts` |
| `contextValue` | [14](./14-testing-features.md) | `packages/examples.app-with-http/src/app.spec.ts` |
| `includeDeps` | [14](./14-testing-features.md), [15](./15-select.md) | `packages/examples.app-with-http/src/app.spec.ts` |

## Часть 4. Разворачивать по частям

| Понятие | Глава | Файл примера |
|---|---|---|
| `load()` | [15](./15-select.md) | `packages/examples.app-with-http/src/main.ts` |
| `nats()` | [16](./16-split.md) | `packages/examples.split-nats/src/root.ts` |
| `intercom` | [16](./16-split.md) | `packages/examples.split-nats/src/root.ts` |
| Split-развёртывание | [16](./16-split.md), [22](./22-ops.md) | `packages/examples.split-nats/src/root.ts` |
| `durable` | [16](./16-split.md) | `packages/examples.split-nats/src/operations.ts` |
| `contextVar` | [16](./16-split.md) | `packages/examples.split-nats/src/context.ts` |
| `propagate` | [16](./16-split.md) | `packages/examples.split-nats/src/context.ts` |
| Subject | [16](./16-split.md) | `packages/examples.split-nats/src/split.spec.ts` |
| снапшот операций | [17](./17-compatibility.md) | `packages/examples.app-with-http/operations.snapshot.json` |
| `diffOperations` | [17](./17-compatibility.md) | `packages/examples.app-with-http/src/operations.compat.spec.ts` |

## Часть 5. Редкие задачи

| Понятие | Глава | Файл примера |
|---|---|---|
| `rawBody` | [18](./18-webhook.md) | `packages/examples.app-with-http/src/features/users/endpoints/user-webhook.endpoint.ts` |
| `cliEndpoint` | [19](./19-cli.md) | `packages/examples.simple-cli/src/commands/greet.command.ts` |
| `makeDispatch` | [19](./19-cli.md), [23](./23-standalone.md) | `packages/examples.simple-cli/src/main.ts` |
| `serve` | [19](./19-cli.md), [23](./23-standalone.md) | `packages/examples.simple-cli/src/main.ts` |
| `makeTokenFamily` | [20](./20-token-families.md) | `packages/examples.container/src/logging/registry.ts` |
| `familyProvider` | [20](./20-token-families.md) | `packages/examples.container/src/logging/logging.plugin.ts` |
| `.auto` | [20](./20-token-families.md) | `packages/examples.container/src/users/users.repository.ts` |
| `classProvider` | [20](./20-token-families.md) | `packages/examples.container/src/database/database.module.ts` |
| `.all` | [20](./20-token-families.md) | `packages/examples.container/src/health/health.service.ts` |
| топологический порядок | [20](./20-token-families.md) | `packages/examples.container/src/health/health.service.ts` |
| objectSource | [21](./21-config-sources.md) | `packages/examples.container/src/main.ts` |
| `configKernel` | [21](./21-config-sources.md) | `packages/examples.container/src/container.ts` |
| `.keys` | [21](./21-config-sources.md) | `packages/examples.container/src/config/app.config.ts` |
| `reloadable` | [21](./21-config-sources.md) | `packages/examples.container/src/runtime/runtime.config.ts` |
| `subscriptions()` | [22](./22-ops.md) | `packages/examples.app-with-http/src/root.ts` |
| `ContainerBuilder` | [23](./23-standalone.md) | `packages/examples.container/src/container.ts` |
| satellite | [24](./24-extending.md) | `packages/nestling.subscriptions/src/module.ts` |
| subpath `./testing` | [24](./24-extending.md) | `packages/nestling.transport.nats/package.json` |
| граница ядра | [24](./24-extending.md) | `packages/nestling.subscriptions/src/module.ts` |

## Не показано в гайде

- Backpressure — [design/streaming.md](../design/streaming.md)
- Жадная сборка — [design/container.md](../design/container.md)
