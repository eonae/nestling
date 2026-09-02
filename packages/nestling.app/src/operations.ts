/**
 * Карта операций сборки: что реализовано здесь, что уходит наружу.
 *
 * Отвечает на вопрос, который иначе задают запуском: «этот процесс сам
 * обслуживает `quotas.claim` или зовёт соседа?» Ответ виден на фазе
 * ASSEMBLE, до открытия сокета.
 */

import type { EndpointDiscovery } from './discovery.js';

import { asFamilyMember } from '@nestling/container';
import type { OperationKind } from '@nestling/contracts';
import {
  EmitterFamily,
  lookupOperation,
  PortFamily,
} from '@nestling/contracts';
import { busBindingOf } from '@nestling/ports';

/** Операция в отчёте `check()` */
export interface CheckedOperation {
  /** Имя операции — её адрес на интеркоме */
  readonly name: string;

  /** Вид операции; `undefined`, если объявление не импортировано */
  readonly kind?: OperationKind;

  /** Реализация объявлена в этой сборке */
  readonly implemented: boolean;

  /** Кто-то из этой сборки её вызывает */
  readonly called: boolean;

  /**
   * Имя транспорта, которым вызов уходит наружу.
   *
   * Есть только у вызываемой операции без местной реализации: такой вызов
   * обслуживает интерком.
   */
  readonly via?: string;
}

/** Имена операций, вызываемых обнаруженными декларациями */
function calledOperations(discovery: EndpointDiscovery): Set<string> {
  const called = new Set<string>();

  for (const { endpoint } of discovery.endpoints) {
    for (const dependency of endpoint.deps ?? []) {
      const member = asFamilyMember(dependency);

      if (member?.family === PortFamily || member?.family === EmitterFamily) {
        called.add(member.param);
      }
    }
  }

  return called;
}

/**
 * Строит карту операций сборки.
 *
 * Источник — discovery: реализация видна по bus-биндингу декларации,
 * вызов — по членам семейств вызывателей в `deps`. Реестр объявлений сюда
 * не годится: он знает всё импортированное, включая операции соседних
 * фич, которых это приложение не обслуживает.
 *
 * @param discovery - Состав приложения
 * @param intercom - Имя транспорта, назначенного переносчиком операций
 * @returns Операции в порядке имени
 */
export function mapOperations(
  discovery: EndpointDiscovery,
  intercom?: string,
): readonly CheckedOperation[] {
  const implemented = new Set<string>();

  for (const { endpoint } of discovery.endpoints) {
    const binding = busBindingOf(endpoint);

    if (binding) {
      implemented.add(binding.subject);
    }
  }

  const called = calledOperations(discovery);
  const names = [...new Set([...implemented, ...called])].sort();

  return names.map((name) => {
    const here = implemented.has(name);
    const kind = lookupOperation(name)?.kind;

    return {
      name,
      ...(kind === undefined ? {} : { kind }),
      implemented: here,
      called: called.has(name),
      ...(here || !called.has(name) || intercom === undefined
        ? {}
        : { via: intercom }),
    };
  });
}
