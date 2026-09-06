/**
 * Объявление экземпляра транспорта в корне.
 *
 * Транспортов одного вида в сборке может быть несколько: публичный HTTP и
 * админский слушают разные порты и обслуживают разные endpoint'ы. Поэтому
 * корень перечисляет не провайдеры, а **объявления**: имя экземпляра, его
 * токен и провайдер, который заводит узел графа.
 */

import type { ITransport } from './interfaces.js';

import type { Provider } from '@nestling/container';
import { valueProvider } from '@nestling/container';
import type { TransportRef } from '@nestling/pipeline';

/**
 * Объявление экземпляра транспорта.
 *
 * @template Name - Имя экземпляра; им декларация выбирает транспорт в `on:`
 */
export interface TransportDeclaration<Name extends string = string> {
  /** Имя экземпляра: `'default'`, `'admin'`, `'events'` */
  readonly name: Name;

  /** Токен, под которым экземпляр попадает в граф */
  readonly token: TransportRef;

  /** Провайдер экземпляра */
  readonly provider: Provider<ITransport>;
}

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
export const makeTransportDeclaration = <D extends TransportDeclaration>(
  declaration: D,
): D => Object.freeze({ ...declaration });

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
 * @param options - Имя экземпляра и признак переносчика операций
 * @returns Объявление экземпляра
 */
export function transportValue<const Name extends string = 'default'>(
  token: TransportRef,
  instance: ITransport,
  options: { readonly name?: Name; readonly bus: true },
): BusDeclaration<Name>;
export function transportValue<const Name extends string = 'default'>(
  token: TransportRef,
  instance: ITransport,
  options?: { readonly name?: Name; readonly bus?: false },
): TransportDeclaration<Name>;
export function transportValue(
  token: TransportRef,
  instance: ITransport,
  options: { readonly name?: string; readonly bus?: boolean } = {},
): TransportDeclaration {
  const declaration: TransportDeclaration = {
    name: options.name ?? DEFAULT_INSTANCE,
    token,
    provider: valueProvider(token, instance),
  };

  return makeTransportDeclaration(
    options.bus ? { ...declaration, bus: true as const } : declaration,
  );
}
