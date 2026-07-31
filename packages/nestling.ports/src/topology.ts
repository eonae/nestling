/**
 * Топология реализаций: «кто обслуживает контракт в этой сборке».
 *
 * Считается дискавери из дерева **выбранных** модулей, поэтому реализация
 * в невыбранной фиче в топологию не попадает — и вызыватель строится так,
 * как предписывает её отсутствие. Реестр имён контрактов на этот вопрос не
 * отвечает и отвечать не может: он знает объявленные контракты, а не состав
 * приложения.
 */

import type { ContractKind } from './contract.js';
import { busBindingOf } from './transport.js';

/** Одна co-located реализация контракта */
export interface ContractImplementation {
  /** Паттерн ручки: адрес внутри процесса */
  readonly pattern: string;

  /** Имя подписчика (только `event`) */
  readonly subscriber?: string;

  /** Модуль, объявивший реализацию */
  readonly moduleName: string;
}

/** Всё, что известно об одном контракте в этой сборке */
export interface ContractTopologyEntry {
  /** Subject шины — имя контракта */
  readonly subject: string;

  readonly kind: ContractKind;

  /** Реализации в порядке обхода дерева модулей */
  readonly implementations: readonly ContractImplementation[];
}

/** Топология: имя контракта → его реализации */
export type ContractTopology = ReadonlyMap<string, ContractTopologyEntry>;

/**
 * Обнаруженная декларация — структурный вход, а не тип `@nestling/app`.
 *
 * Стрелка зависимостей идёт от корня к пакету, поэтому топология описывает
 * то, что ей нужно, сама: паттерн, биндинг и модуль-объявитель.
 */
export interface DiscoveredDeclaration {
  readonly endpoint: { readonly pattern: string; readonly binding?: unknown };
  readonly moduleName: string;
}

/**
 * Собирает топологию реализаций контрактов из результата дискавери.
 *
 * @param endpoints - Обнаруженные декларации приложения (все транспорты)
 * @returns Топология: только декларации на транспорте шины
 * @throws {Error} Два владельца у `request`/`command`; два подписчика
 * `event` с одинаковым именем
 */
export function collectImplementations(
  endpoints: readonly DiscoveredDeclaration[],
): ContractTopology {
  const topology = new Map<string, ContractTopologyEntry>();

  for (const { endpoint, moduleName } of endpoints) {
    const binding = busBindingOf(endpoint);
    if (!binding) {
      continue;
    }

    const entry = topology.get(binding.subject);

    if (!entry) {
      topology.set(binding.subject, {
        subject: binding.subject,
        kind: binding.kind,
        implementations: [
          {
            pattern: endpoint.pattern,
            ...(binding.subscriber === undefined
              ? {}
              : { subscriber: binding.subscriber }),
            moduleName,
          },
        ],
      });

      continue;
    }

    const [first] = entry.implementations;

    if (binding.kind !== 'event') {
      throw new Error(
        `Contract '${binding.subject}' is a '${binding.kind}' contract and ` +
          `therefore has exactly one owner, but it is implemented twice: in ` +
          `module '${first.moduleName}' and in module '${moduleName}'. ` +
          `Remove one of the implementations, or split the operation into ` +
          `two contracts.`,
      );
    }

    const duplicate = entry.implementations.find(
      (existing) => existing.subscriber === binding.subscriber,
    );

    if (duplicate) {
      throw new Error(
        `Event contract '${binding.subject}' has two subscribers named ` +
          `'${binding.subscriber}': in module '${duplicate.moduleName}' and ` +
          `in module '${moduleName}'. A subscriber name is the subscription ` +
          `address, so it must be unique per contract.`,
      );
    }

    (entry.implementations as ContractImplementation[]).push({
      pattern: endpoint.pattern,
      ...(binding.subscriber === undefined
        ? {}
        : { subscriber: binding.subscriber }),
      moduleName,
    });
  }

  return topology;
}
