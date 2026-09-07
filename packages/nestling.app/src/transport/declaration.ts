/**
 * Объявление экземпляра транспорта в корне.
 *
 * Транспортов одного вида в сборке может быть несколько: публичный HTTP и
 * админский слушают разные порты и обслуживают разные endpoint'ы. Поэтому
 * корень перечисляет не провайдеры, а **объявления**: имя экземпляра, его
 * токен и провайдер, который заводит узел графа.
 */

import type { TransportCapabilities, TransportRef } from '../pipeline/index.js';

import type { IListener, ITransport, ServerToken } from './interfaces.js';

import type { Provider } from '@nestling/container';
import { valueProvider } from '@nestling/container';

/**
 * Объявление экземпляра транспорта.
 *
 * @template Name - Имя экземпляра; им декларация выбирает транспорт в `on:`
 */
export interface TransportDeclaration<Name extends string = string> {
  /**
   * Что объявлено: транспорт.
   *
   * Поле `transports:` корня принимает и объявления серверов, поэтому
   * элементы различаются дискриминатором, а не догадкой по форме.
   */
  readonly kind: 'transport';

  /** Имя экземпляра: `'default'`, `'admin'`, `'events'` */
  readonly name: Name;

  /** Токен, под которым экземпляр попадает в граф */
  readonly token: TransportRef;

  /** Провайдер экземпляра */
  readonly provider: Provider<ITransport>;

  /**
   * Формы io, которые транспорт умеет принимать и отдавать.
   *
   * Данные объявления, а не экземпляра: на фазе ASSEMBLE экземпляров нет,
   * а проверка форм идёт там. Поле обязательное — собственное объявление
   * транспорта без него не компилируется.
   */
  readonly capabilities: TransportCapabilities;

  /**
   * Сервер, на котором работает транспорт.
   *
   * Транспорт, которому нужен сокет, кладёт сюда объявление своего
   * сервера: либо переданное автором (`http({ server: api })`), либо
   * созданное фабрикой с тем же именем, что у транспорта. Корень
   * регистрирует такое вложенное объявление вместе с транспортом, поэтому
   * `transports: [http()]` заводит два узла и в корне про сервер не
   * пишется ни строки.
   *
   * Транспорт без сокета (`cli()`, шина) поля не имеет.
   */
  readonly server?: ServerDeclaration;
}

/**
 * Объявление экземпляра сервера — узла, который владеет сокетом.
 *
 * Поля `capabilities` у него нет: формы io объявляет транспорт, сервер про
 * них не знает. Сервер перечисляется в `transports:` корня наравне с
 * транспортами.
 *
 * @template Name - Имя экземпляра; из него транспортный пакет строит
 * префикс своей конфиг-секции
 */
export interface ServerDeclaration<Name extends string = string> {
  /** Что объявлено: сервер */
  readonly kind: 'server';

  /** Имя экземпляра: `'default'`, `'api'`, `'admin'` */
  readonly name: Name;

  /** Токен, под которым экземпляр попадает в граф */
  readonly token: ServerToken;

  /** Провайдер экземпляра; сервер — ресурс, поэтому это провайдер ресурса */
  readonly provider: Provider<IListener>;
}

/**
 * Элемент поля `transports:` корня: объявление транспорта или сервера.
 *
 * Union, а не два поля: сервер объявляется рядом с транспортом, который на
 * нём работает, а состав корня и без того длинный.
 */
export type TransportEntry = TransportDeclaration | ServerDeclaration;

/**
 * Объявление транспорта, который переносит объявленные операции.
 *
 * Отдельный тип, а не флаг: только такое объявление встаёт в роль
 * интеркома, и проверяет это компилятор. Транспорт без операций поля `bus`
 * не имеет вовсе, поэтому спутать их нечем.
 *
 * @template Name - Имя экземпляра
 */
export interface BusDeclaration<Name extends string = string>
  extends TransportDeclaration<Name> {
  /** Транспорт переносит объявленные операции */
  readonly bus: true;
}

/**
 * Строит объявление экземпляра транспорта.
 *
 * Зовут его конструкторы транспортов (`http`, `cli`, `nats`), а не
 * прикладной код.
 *
 * @param declaration - Имя, токен и провайдер экземпляра
 * @returns То же объявление, замороженное
 */
export const makeTransportDeclaration = <
  D extends Omit<TransportDeclaration, 'kind'>,
>(
  declaration: D,
): D & { readonly kind: 'transport' } =>
  Object.freeze({ ...declaration, kind: 'transport' as const });

/**
 * Строит объявление экземпляра сервера.
 *
 * Зовут его конструкторы транспортных пакетов (`httpServer`), а не
 * прикладной код.
 *
 * @param declaration - Имя, токен и провайдер экземпляра
 * @returns То же объявление, замороженное
 */
export const makeServerDeclaration = <
  D extends Omit<ServerDeclaration, 'kind'>,
>(
  declaration: D,
): D & { readonly kind: 'server' } =>
  Object.freeze({ ...declaration, kind: 'server' as const });

/**
 * Имя экземпляра по умолчанию.
 *
 * Декларация без `on:` обслуживается им, поэтому приложение с одним
 * транспортом каждого вида про имена не пишет ни строки.
 */
export const DEFAULT_INSTANCE = 'default';

/**
 * Объявляет экземпляр из **готового** транспорта.
 *
 * Путь для тестов и для транспорта, собранного вручную: значение уже
 * создано, контейнеру остаётся зарегистрировать его узлом.
 *
 * @param token - Токен экземпляра
 * @param instance - Готовый транспорт
 * @param options - Способности транспорта, имя экземпляра и признак
 * переносчика операций
 * @returns Объявление экземпляра
 */
export function transportValue<const Name extends string = 'default'>(
  token: TransportRef,
  instance: ITransport,
  options: {
    readonly name?: Name;
    readonly capabilities: TransportCapabilities;
    readonly bus: true;
  },
): BusDeclaration<Name>;
export function transportValue<const Name extends string = 'default'>(
  token: TransportRef,
  instance: ITransport,
  options: {
    readonly name?: Name;
    readonly capabilities: TransportCapabilities;
    readonly bus?: false;
  },
): TransportDeclaration<Name>;
export function transportValue(
  token: TransportRef,
  instance: ITransport,
  options: {
    readonly name?: string;
    readonly capabilities: TransportCapabilities;
    readonly bus?: boolean;
  },
): TransportDeclaration {
  const declaration: Omit<TransportDeclaration, 'kind'> = {
    name: options.name ?? DEFAULT_INSTANCE,
    token,
    provider: valueProvider(token, instance),
    capabilities: options.capabilities,
  };

  return makeTransportDeclaration(
    options.bus ? { ...declaration, bus: true as const } : declaration,
  );
}
