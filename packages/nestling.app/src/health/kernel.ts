/**
 * Kernel-модуль проб: узел `Health$` и вклады ресурсов.
 *
 * Корень регистрирует его **всегда**, без полей в `makeApp` и без условий:
 * `container.getOrThrow(Health$)` обязан работать у любого приложения,
 * иначе satellite-пакет, тест и адаптер транспорта договаривались бы с
 * корнем о том, включены ли пробы.
 *
 * Регистрация идёт после модулей: узел называет каждый вклад поимённо, а
 * состав вкладов известен только когда зарегистрированы все модули.
 */

import type { Logger } from '../logger/interface.js';
import { Logger$ } from '../logger/tokens.js';
import type { AppPhase } from '../root/phase.js';

import type { HealthConfig } from './config.js';
import { NestlingHealthConfig } from './config.js';
import type { HealthCheck, HealthStatus } from './interface.js';
import type { NamedHealthCheck } from './node.js';
import { HealthNode } from './node.js';
import { Health$, HealthCheck$ } from './tokens.js';

import type {
  ContainerBuilder,
  HealthResource,
  Module,
  ModuleProvider,
} from '@nestlingjs/container';
import { factoryProvider } from '@nestlingjs/container';

/** Опции kernel-модуля проб */
export interface HealthKernelOptions {
  /**
   * Читает текущую фазу приложения.
   *
   * Функция, а не DI-токен графа: значение фазы принадлежит рантайму, и
   * прикладной код инжектить его не должен.
   */
  readonly phase: () => AppPhase;

  /**
   * Зарегистрированные вклады: члены семейства `HealthCheck$`.
   *
   * Приходят перечнем, а не агрегатом `HealthCheck$.all`, потому что имя
   * проверки живёт в DI-токене члена, а агрегат отдаёт только значения.
   * Перечень даёт `ContainerBuilder.familyMembers(HealthCheck$)`.
   */
  readonly checks: readonly { readonly param: string }[];
}

/**
 * Собирает kernel-модуль проб.
 *
 * @param options - Чтение фазы и перечень вкладов
 *
 * @example
 * ```typescript
 * builder.register(...resourceHealthChecks(builder.healthResources()));
 * builder.register(
 *   healthKernel({ phase, checks: builder.familyMembers(HealthCheck$) }),
 * );
 * ```
 */
export const healthKernel = (options: HealthKernelOptions): Module => {
  const names = options.checks.map(({ param }) => param);

  return {
    name: 'kernel:health',
    providers: [
      {
        provide: Health$,
        useFactory: (
          config: HealthConfig,
          logger: Logger,
          ...checks: HealthCheck[]
        ) =>
          new HealthNode(
            names.map(
              (name, index): NamedHealthCheck => ({
                name,
                check: checks[index],
              }),
            ),
            options.phase,
            config,
            logger,
          ),
        // Имя и вклад приходят одной парой по построению: тот же перечень
        // задаёт и `names`, и хвост списка зависимостей
        deps: [
          NestlingHealthConfig,
          Logger$('nestling:health'),
          ...options.checks.map(({ param }) => HealthCheck$(param)),
        ],
      },
    ],
  };
};

/**
 * Заводит по вкладу на каждый ресурс, объявивший `health`.
 *
 * Вклад ресурса критичен: ресурс — внешнее соединение, без которого его
 * потребитель не работает. Некритичная проверка объявляется обычным
 * провайдером члена с `critical: false`.
 *
 * @param resources - Перечень `ContainerBuilder.healthResources()`
 * @returns Провайдеры членов `HealthCheck$` под идентификаторами узлов
 *
 * @example
 * ```typescript
 * builder.register(...resourceHealthChecks(builder.healthResources()));
 * ```
 */
export const resourceHealthChecks = (
  resources: readonly HealthResource[],
): readonly ModuleProvider[] =>
  resources.map(({ token, id, health }) =>
    factoryProvider(
      HealthCheck$(id),
      (value: unknown): HealthCheck => ({
        critical: true,
        check: async (signal: AbortSignal): Promise<HealthStatus> =>
          await health(value, signal),
      }),
      [token],
    ),
  );

/**
 * Регистрирует пробы целиком: вклады ресурсов, затем узел.
 *
 * Порядок обязателен: узел называет каждый вклад поимённо, поэтому вклады
 * ресурсов должны стоять в билдере раньше него.
 *
 * @param builder - Билдер со всеми уже зарегистрированными модулями
 * @param phase - Читает текущую фазу приложения
 */
export const registerHealth = (
  builder: ContainerBuilder,
  phase: () => AppPhase,
): void => {
  builder.register(...resourceHealthChecks(builder.healthResources()));
  builder.register(
    healthKernel({ phase, checks: builder.familyMembers(HealthCheck$) }),
  );
};
