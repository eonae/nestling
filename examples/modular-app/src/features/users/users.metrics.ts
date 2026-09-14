import { counter, makeMetrics } from '@nestlingjs/app';

/**
 * Метрики фичи `users`: объявление-значение.
 *
 * Группа подключается вкладом `metrics:` фичи, поэтому процесс, собранный
 * без неё, рядов этих метрик не заводит вовсе. Писателя раздаёт граф по
 * группе-DI-токену, а имя ряда складывается из префикса и ключа —
 * `users.registrations`.
 */
export const UsersMetrics = makeMetrics('users', {
  registrations: counter({
    help: 'Обработанные команды регистрации по исходу',
    attributes: {
      outcome: ['registered', 'duplicate', 'address_rejected'],
    },
  }),
});
