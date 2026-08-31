import type { Module } from '@nestling/container';
import type { AnyEndpointDefinition } from '@nestling/pipeline';

/**
 * Расширенная конфигурация модуля для приложений с endpoints
 *
 * `endpoints` — список **деклараций-значений**, созданных конструктором
 * своего транспорта (`httpEndpoint`, `cliEndpoint`). Инстанцировать в них
 * нечего, поэтому в `providers` они не попадают. Зависимости хендлера
 * (токены `deps`, класс-хендлер) и юниты пайплайнов — обычные провайдеры:
 * регистрируются в `providers` явно, а App резолвит их на старте.
 *
 * @example
 * ```typescript
 * const UsersModule = makeAppModule({
 *   name: 'module:users',
 *   providers: [UserService, UserRepository, WithTracing, CreateUserHandler],
 *   endpoints: [GetUser, CreateUser, UpdateUser],
 *   imports: [DatabaseModule],
 * });
 * ```
 */
export interface AppModule extends Module {
  /** Декларации-значения, созданные конструктором своего транспорта */
  endpoints?: AnyEndpointDefinition[];
}

/**
 * Создаёт модуль приложения с поддержкой endpoints
 *
 * Это высокоуровневое API поверх makeModule из @nestling/container.
 * Возвращаемое значение **сохраняет** список `endpoints` — именно из него
 * App собирает endpoint'ы обходом дерева модулей (`discoverEndpoints`).
 * В `providers` ничего не подмешивается: декларация — значение, а её
 * зависимости регистрируются так же явно, как любые другие.
 *
 * @param config - Конфигурация модуля приложения
 * @returns Модуль-значение, готовый и для контейнера, и для discovery
 */
export function makeAppModule(config: AppModule): AppModule {
  const { endpoints, ...moduleConfig } = config;

  const module: AppModule = { ...moduleConfig };

  if (endpoints) {
    module.endpoints = endpoints;
  }

  return module;
}
