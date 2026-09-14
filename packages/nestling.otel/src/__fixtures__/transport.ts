/**
 * Транспорт-фейк для спек пакета: DI-токен экземпляра и конструктор
 * декларации.
 *
 * Спекам сателлита нужен endpoint, который можно позвать тестовым корнем,
 * а не конкретный протокол. Настоящий HTTP дал бы то же самое ценой
 * зависимости, которой у пакета нет: своего endpoint'а он не объявляет.
 */

import type {
  ITransport,
  TransportCapabilities,
  TransportDeclaration,
} from '@nestlingjs/app';
import { DEFAULT_INSTANCE, makeTransportDeclaration } from '@nestlingjs/app';
import type { TokenFamily } from '@nestlingjs/container';
import { makeTokenFamily, valueProvider } from '@nestlingjs/container';

/** Семейство DI-токенов транспорта-фейка: один DI-токен на экземпляр */
export const TestTransport$: TokenFamily<ITransport, [instance: string]> =
  makeTokenFamily<ITransport, [instance: string]>('transport:test');

/** Способности транспорта-фейка: все формы io, включая поток */
const ALL_FORMS: TransportCapabilities = {
  input: new Set(['value', 'stream', 'events', 'multipart']),
  output: new Set(['value', 'stream', 'events']),
};

/** Транспорт-фейк: сокета не открывает, запросы приходят тестовым корнем */
class SilentTransport implements ITransport {
  async serve(): Promise<void> {
    return undefined;
  }
}

/**
 * Объявляет транспорт-фейк для `transports:` корня.
 *
 * @returns Объявление транспорта с экземпляром по умолчанию
 */
export function testTransport(): TransportDeclaration<string> {
  const token = TestTransport$(DEFAULT_INSTANCE);

  return makeTransportDeclaration({
    name: DEFAULT_INSTANCE,
    token,
    capabilities: ALL_FORMS,
    provider: valueProvider(token, new SilentTransport()),
  });
}
