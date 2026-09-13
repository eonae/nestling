import { counter, histogram, makeMetrics } from '@nestlingjs/app';

/**
 * Метрики фичи пользователей: объявление-значение.
 *
 * Группа подключается вкладом `metrics:` фичи и служит DI-токеном: писателя
 * раздаёт граф, метрика выбирается полем. Имя ряда складывается из
 * префикса группы и ключа записи — `users.created`, `users.import.duration`.
 *
 * Атрибуты объявлены перечнями, поэтому ряды известны на сборке, и
 * экспозиция показывает по ним нули ещё до первого запроса.
 */
export const UsersMetrics = makeMetrics('users', {
  created: counter({
    help: 'Попытки создать пользователя по исходу',
    attributes: { outcome: ['stored', 'dry_run', 'email_taken'] },
  }),

  'import.duration': histogram({
    help: 'Время импорта пачки пользователей',
    unit: 'ms',
    buckets: [10, 50, 100, 500, 1000, 5000],
  }),
});
