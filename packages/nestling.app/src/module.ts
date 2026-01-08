import type { Constructor } from '@common/misc';
import type { Module } from '@nestling/container';
import { makeModule } from '@nestling/container';
import type { IEndpoint, IMiddleware } from '@nestling/pipeline';

/**
 * Расширенная конфигурация модуля для приложений с endpoints и middleware
 *
 * @example
 * ```typescript
 * const UsersModule = makeAppModule({
 *   name: 'module:users',
 *   providers: [UserService, UserRepository],
 *   middleware: [AuthMiddleware, LoggingMiddleware],
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
export interface AppModule extends Omit<Module, 'providers'> {
  /** Провайдеры модуля (опционально, т.к. endpoints и middleware тоже провайдеры) */
  providers?: Module['providers'];

  /** Endpoint-классы, декорированные @Injectable и @Endpoint */
  endpoints?: Constructor<IEndpoint>[];

  /** Middleware-классы, декорированные @Injectable и @Middleware */
  middleware?: Constructor<IMiddleware>[];
}

/**
 * Создаёт модуль приложения с поддержкой endpoints и middleware
 *
 * Это высокоуровневое API поверх makeModule из @nestling/container.
 * Endpoints и middleware автоматически добавляются в providers модуля.
 *
 * @param config - Конфигурация модуля приложения
 * @returns Модуль, готовый для использования в контейнере
 *
 * @example
 * ```typescript
 * import { makeAppModule } from '@nestling/app';
 *
 * export const UsersModule = makeAppModule({
 *   name: 'module:users',
 *   providers: [UserService, UserRepository],
 *   middleware: [AuthMiddleware],
 *   endpoints: [GetUserByIdEndpoint, CreateUserEndpoint],
 *   imports: [DatabaseModule],
 *   exports: [UserService],
 * });
 * ```
 */
export function makeAppModule(config: AppModule): Module {
  const {
    endpoints = [],
    middleware = [],
    providers,
    ...moduleConfig
  } = config;

  // Собираем все провайдеры: базовые + endpoints + middleware
  const allProviders = [
    ...(Array.isArray(providers) ? providers : []),
    ...endpoints,
    ...middleware,
  ];

  return makeModule({
    ...moduleConfig,
    providers: allProviders.length > 0 ? allProviders : undefined,
  });
}
