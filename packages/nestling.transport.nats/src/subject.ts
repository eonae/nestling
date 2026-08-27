/**
 * Отображение контракта на брокер: subject, группа доставки и имена
 * JetStream.
 *
 * Правило адресации одно и выводится из значения: имя контракта **уже**
 * адрес (`quotas.claim`), и точки в нём — родные разделители subject'ов
 * NATS. Карты subject'ов, вычисления имени из модуля или фичи не
 * существует.
 */

import type { BusBinding } from '@nestling/ports';

/**
 * Группа доставки — та же карта, что считает in-proc шина.
 *
 * - `request`/`command` — одна группа на subject: владелец один, его
 *   реплики делят нагрузку;
 * - `event` — группа на имя подписчика: каждый подписчик получает копию,
 *   его реплики делят её между собой.
 *
 * Добавление реплики процесса не требует правки конфигурации — это и есть
 * довод в пользу subject-адресации.
 */
export function groupOf(binding: BusBinding, pattern: string): string {
  return binding.kind === 'event'
    ? (binding.subscriber ?? pattern)
    : `owner:${binding.subject}`;
}

/**
 * Имя потока JetStream, выведенное из subject'а.
 *
 * Детерминированное: все процессы просят одно и то же определение, поэтому
 * создание идемпотентно и гонки на старте не бывает.
 */
export function streamNameOf(subject: string): string {
  return `nestling_${sanitize(subject)}`;
}

/**
 * Имя durable-потребителя, выведенное из потока и группы доставки.
 *
 * Реплики одного подписчика делят поток (общее имя), разные подписчики
 * читают его независимо (разные имена).
 */
export function consumerNameOf(stream: string, group: string): string {
  return `${stream}__${sanitize(group)}`;
}

/**
 * Приводит строку к тому, что NATS принимает в имени потока и потребителя:
 * точки, двоеточия и пробелы там недопустимы.
 */
function sanitize(value: string): string {
  return value.replaceAll(/[^\w-]/g, '_');
}
