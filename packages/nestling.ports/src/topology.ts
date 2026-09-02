/**
 * Топология реализаций: «кто обслуживает операция в этой сборке».
 *
 * Считается по discovery дерева выбранных модулей, поэтому реализация в
 * невыбранной фиче в топологию не попадает, и вызыватель строится так, как
 * предписывает её отсутствие. Реестр имён операций на этот вопрос не
 * отвечает и отвечать не может: он знает объявленные операции, а не
 * состав приложения.
 */

import { busBindingOf } from './transport.js';

import type { OperationKind } from '@nestling/operations';

/** Одна co-located реализация операции */
export interface ContractImplementation {
  /** Паттерн endpoint'а: адрес внутри процесса */
  readonly pattern: string;

  /** Имя подписчика (только `event`) */
  readonly subscriber?: string;

  /** Модуль, объявивший реализацию */
  readonly moduleName: string;
}

/** Всё, что известно об одном операции в этой сборке */
export interface ContractTopologyEntry {
  /** Subject шины — имя операции */
  readonly subject: string;

  readonly kind: OperationKind;

  /** Реализации в порядке обхода дерева модулей */
  readonly implementations: readonly ContractImplementation[];
}

/** Топология: реализации операции по его имени */
export type OperationTopology = ReadonlyMap<string, ContractTopologyEntry>;

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
 * Собирает топологию реализаций операций из результата discovery.
 *
 * @param endpoints - Обнаруженные декларации приложения (все транспорты)
 * @returns Топология: только декларации на транспорте шины
 * @throws {Error} Два владельца у `request`/`command`; два подписчика
 * `event` с одинаковым именем
 */
export function collectImplementations(
  endpoints: readonly DiscoveredDeclaration[],
): OperationTopology {
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
        `Operation '${binding.subject}' is a '${binding.kind}' operation and ` +
          `therefore has exactly one owner, but it is implemented twice: in ` +
          `module '${first.moduleName}' and in module '${moduleName}'. ` +
          `Remove one of the implementations, or split the operation into ` +
          `two operations.`,
      );
    }

    const duplicate = entry.implementations.find(
      (existing) => existing.subscriber === binding.subscriber,
    );

    if (duplicate) {
      throw new Error(
        `Event operation '${binding.subject}' has two subscribers named ` +
          `'${binding.subscriber}': in module '${duplicate.moduleName}' and ` +
          `in module '${moduleName}'. A subscriber name is the subscription ` +
          `address, so it must be unique per operation.`,
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
