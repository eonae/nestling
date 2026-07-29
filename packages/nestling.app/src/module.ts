import type { Constructor } from '@common/misc';
import type { Module } from '@nestling/container';
import type { IEndpoint } from '@nestling/pipeline';

/**
 * Расширенная конфигурация модуля для приложений с endpoints
 *
 * Юниты пайплайнов (классы с handle) — обычные провайдеры: регистрируются
 * в providers, а App резолвит их на старте при bind пайплайнов endpoint'ов.
 *
 * @example
 * ```typescript
 * const UsersModule = makeAppModule({
 *   name: 'module:users',
 *   providers: [UserService, UserRepository, WithTracing],
 *   endpoints: [
 *     GetUserByIdEndpoint,
 *     CreateUserEndpoint,
 *     UpdateUserEndpoint,
 *   ],
 *   imports: [DatabaseModule],
 *   exports: [UserService],
 * });
 * ```
 */
export interface AppModule extends Module {
  /** Endpoint-классы, декорированные @Injectable и @Endpoint */
  endpoints?: Constructor<IEndpoint<any, any, any>>[];
}

/**
 * Создаёт модуль приложения с поддержкой endpoints
 *
 * Это высокоуровневое API поверх makeModule из @nestling/container.
 * Возвращаемое значение **сохраняет** список `endpoints` — именно из него
 * App собирает эндпоинты обходом дерева модулей (`discoverEndpoints`).
 * Дополнительно endpoints добавляются в providers, чтобы контейнер их
 * инстанцировал.
 *
 * @param config - Конфигурация модуля приложения
 * @returns Модуль-значение, готовый и для контейнера, и для дискавери
 */
export function makeAppModule(config: AppModule): AppModule {
  const { endpoints, providers, ...moduleConfig } = config;

  const module: AppModule = {
    ...moduleConfig,
    providers: withEndpoints(providers, endpoints),
  };

  if (endpoints) {
    module.endpoints = endpoints;
  }

  return module;
}

/**
 * Добавляет endpoints к провайдерам модуля, сохраняя форму `providers`:
 * `ProvidersFactory` остаётся фабрикой, массив — массивом.
 */
function withEndpoints(
  providers: Module['providers'],
  endpoints: AppModule['endpoints'],
): Module['providers'] {
  if (!endpoints || endpoints.length === 0) {
    return providers;
  }

  if (typeof providers === 'function') {
    return async () => [...(await providers()), ...endpoints];
  }

  return [...(providers ?? []), ...endpoints];
}
