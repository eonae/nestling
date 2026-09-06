/**
 * Два семейства конфига.
 *
 * Отдельный файл, потому что и объявление секции, и kernel-модуль ссылаются
 * на `ConfigSection`: общий низ разрывает цикл импортов между ними.
 */

import type { ConfigSectionToken } from './declaration.js';

import { makeTokenFamily } from '@nestling/container';

/**
 * Узел на секцию. Рецепт семейства принадлежит фреймворку: он находит
 * декларацию в реестре по префиксу и зависит только от читалки.
 *
 * Токен члена совпадает по строковому id с классом-токеном, который вернул
 * `makeConfig`, — инжект секции и есть упоминание члена в `deps`.
 *
 * @internal Пользовательский код обращается к секции её собственным токеном
 */
export const ConfigSection = makeTokenFamily<unknown, [prefix: string]>(
  'ConfigSection',
);

/**
 * Узел на **одиночный ключ**. Отдаёт сырое значение из читалки.
 *
 * Обслуживает on-demand-инфраструктуру и unbound-свойства: провайдер
 * клиента к серверу `users` транзитивно зависит от
 * `Config(addressKey('users'))`, и жадная сборка создаёт узел только
 * для ключей, упомянутых в `deps`, без рантайм-резолюции.
 *
 * Значение **не валидируется**: валидация — свойство секции, потребитель
 * сырого ключа отвечает за проверку сам.
 *
 * @example
 * ```typescript
 * const addressKey = (server: string) => `${server.toUpperCase()}_GRPC_ADDRESS`;
 *
 * familyProvider(GrpcClient, (server) => ({
 *   provide: GrpcClient(server),
 *   useFactory: (address: unknown) => new Client(String(address)),
 *   deps: [Config(addressKey(server))],
 * }));
 * ```
 */
export const Config = makeTokenFamily<unknown, [key: string]>('Config');

/**
 * Тип проекции секции: `Config<typeof OrdersConfig>`.
 *
 * Делит имя с семейством выше намеренно — так это записано в design-доке.
 * Тип и значение живут в разных пространствах имён, поэтому объявлены
 * рядом: слияние имени работает только внутри одного модуля.
 */
export type Config<T extends ConfigSectionToken<any, any>> =
  T extends ConfigSectionToken<infer Values, any> ? Values : never;
