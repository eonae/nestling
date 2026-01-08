import type { IEndpoint } from '../core';

import type { Constructor } from '@common/misc';

/**
 * Глобальный registry для классов с декоратором @Endpoint
 *
 * Используется App для автоматического обнаружения и регистрации endpoints
 */
const endpointRegistry = new Set<Constructor<IEndpoint>>();

/**
 * Регистрирует endpoint-класс в глобальном registry
 *
 * @param ctor - Конструктор endpoint-класса
 *
 * @example
 * ```typescript
 * @Injectable([UserService])
 * @Endpoint({ transport: 'http', pattern: 'GET /users' })
 * class GetUsersEndpoint {
 *   // ...
 * }
 * // Класс автоматически регистрируется декоратором @Endpoint
 * ```
 */
export function registerEndpoint(ctor: Constructor<IEndpoint>): void {
  endpointRegistry.add(ctor);
}

/**
 * Возвращает все зарегистрированные endpoint-классы
 *
 * @returns Массив конструкторов всех endpoints
 *
 * @example
 * ```typescript
 * const endpoints = getAllEndpoints();
 * for (const EndpointClass of endpoints) {
 *   const metadata = getEndpointMetadata(EndpointClass);
 *   console.log(`Found endpoint: ${metadata.pattern}`);
 * }
 * ```
 */
export function getAllEndpoints(): Constructor<IEndpoint>[] {
  return [...endpointRegistry];
}

/**
 * Очищает registry endpoints (используется в тестах)
 *
 * @internal
 */
export function clearEndpointRegistry(): void {
  endpointRegistry.clear();
}
