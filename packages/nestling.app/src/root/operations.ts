/**
 * Карта операций сборки: что реализовано здесь, что уходит наружу.
 *
 * Отвечает на вопрос, который иначе задают запуском: «этот процесс сам
 * обслуживает `quotas.claim` или зовёт соседа?» Ответ виден на фазе
 * ASSEMBLE, до открытия сокета.
 */

import { busBindingOf } from '../ports/index.js';

import type { EndpointDiscovery } from './discovery.js';
import type { ResolvedBundle } from './feature.js';
import { injectedTokens } from './feature.js';

import type { SwitchValues } from '@nestlingjs/container';
import { asFamilyMember } from '@nestlingjs/container';
import type { OperationKind } from '@nestlingjs/operations';
import {
  EmitterFamily,
  lookupOperation,
  PortFamily,
} from '@nestlingjs/operations';

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

/** Имена операций, вызываемых единицами сборки */
function calledOperations(
  bundles: readonly ResolvedBundle[],
  values: SwitchValues,
): Set<string> {
  const called = new Set<string>();

  for (const bundle of bundles) {
    for (const dependency of injectedTokens(bundle, values)) {
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
 * @param bundles - Выбранные фичи и подключённые плагины: их провайдеры
 * тоже инжектируют вызыватели
 * @param values - Значения переключателей фазы ASSEMBLE
 * @param intercom - Имя транспорта, назначенного переносчиком операций
 * @returns Операции в порядке имени
 */
export function mapOperations(
  discovery: EndpointDiscovery,
  bundles: readonly ResolvedBundle[],
  values: SwitchValues,
  intercom?: string,
): readonly CheckedOperation[] {
  const implemented = new Set<string>();

  for (const { endpoint } of discovery.endpoints) {
    const binding = busBindingOf(endpoint);

    if (binding) {
      implemented.add(binding.subject);
    }
  }

  const called = calledOperations(bundles, values);
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
