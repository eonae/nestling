/**
 * Замыкание выбора по вызываемым операциям.
 *
 * Поля `dependsOn` у фичи нет: связь между фичами уже записана в коде —
 * вызывающая сторона названа в `deps` декларации, реализация объявлена в
 * составе другой фичи. `includeDeps` читает эту связь и добавляет в выбор
 * тех, без кого вызов некому обслужить.
 *
 * В замыкании участвуют только `request` и `command`. У события ноль или
 * больше подписчиков, и отсутствие подписчика в этом процессе — законная
 * топология, а не недостача.
 */

import type { Feature } from './feature.js';
import { injectedTokens } from './feature.js';

import { asFamilyMember } from '@nestling/container';
import { EmitterFamily, PortFamily } from '@nestling/operations';
import { busBindingOf } from '@nestling/ports';

/**
 * Имена операций видов `request` и `command`, которые вызывает фича.
 *
 * Источник — все токены единицы: вызыватель инжектируют и декларации, и
 * обычные провайдеры.
 */
function callsOf(feature: Feature): Set<string> {
  const calls = new Set<string>();

  for (const dependency of injectedTokens(feature)) {
    const member = asFamilyMember(dependency);

    if (member?.family === PortFamily || member?.family === EmitterFamily) {
      calls.add(member.param);
    }
  }

  return calls;
}

/**
 * Карта «операция → фича, которая её реализует».
 *
 * Строится по объявленным фичам, а не по выбранным: замыкание для того и
 * нужно, чтобы дотянуться до невыбранной.
 */
function implementers(
  declared: ReadonlyMap<string, Feature>,
): Map<string, Feature> {
  const owners = new Map<string, Feature>();

  for (const feature of declared.values()) {
    for (const endpoint of feature.endpoints) {
      const binding = busBindingOf(endpoint);

      // Событие в замыкании не участвует: подписчик — не владелец
      if (!binding || binding.kind === 'event' || owners.has(binding.subject)) {
        continue;
      }

      owners.set(binding.subject, feature);
    }
  }

  return owners;
}

/**
 * Замыкает выбор по вызываемым операциям.
 *
 * @param selected - Фичи, названные в `select`
 * @param declared - Все объявленные фичи
 * @returns Выбор плюс фичи, реализующие вызываемые операции
 */
export function closeOverCalls(
  selected: readonly Feature[],
  declared: ReadonlyMap<string, Feature>,
): Feature[] {
  const owners = implementers(declared);

  const chosen = [...selected];
  const seen = new Set(selected);

  // Обход очередью, а не `for-of`: список растёт по ходу — добавленная
  // фича может звать третью
  const queue = [...selected];

  while (queue.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const feature = queue.shift()!;

    for (const call of callsOf(feature)) {
      const owner = owners.get(call);

      if (!owner || seen.has(owner)) {
        continue;
      }

      seen.add(owner);
      chosen.push(owner);
      queue.push(owner);
    }
  }

  return chosen;
}
