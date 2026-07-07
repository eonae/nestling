import type { Constructor } from '@common/misc';
import type { Module } from '@nestling/container';
import { makeModule } from '@nestling/container';
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
export interface AppModule extends Omit<Module, 'providers'> {
  /** Провайдеры модуля (опционально, т.к. endpoints тоже провайдеры) */
  providers?: Module['providers'];

  /** Endpoint-классы, декорированные @Injectable и @Endpoint */
  endpoints?: Constructor<IEndpoint<any, any, any>>[];
}

/**
 * Создаёт модуль приложения с поддержкой endpoints
 *
 * Это высокоуровневое API поверх makeModule из @nestling/container.
 * Endpoints автоматически добавляются в providers модуля.
 *
 * @param config - Конфигурация модуля приложения
 * @returns Модуль, готовый для использования в контейнере
 */
export function makeAppModule(config: AppModule): Module {
  const { endpoints = [], providers, ...moduleConfig } = config;

  // Собираем все провайдеры: базовые + endpoints
  const allProviders = [
    ...(Array.isArray(providers) ? providers : []),
    ...endpoints,
  ];

  return makeModule({
    ...moduleConfig,
    providers: allProviders.length > 0 ? allProviders : undefined,
  });
}
