/**
 * Типовые тесты объявления метрик.
 *
 * Файл не гоняется jest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на сборке пакета. Негативные случаи закрыты `@ts-expect-error`:
 * исчезни ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import type { MetricsOf } from './declaration.js';
import { counter, histogram, makeMetrics, open } from './declaration.js';

const OrdersMetrics = makeMetrics('orders', {
  created: counter({
    help: 'Created orders',
    attributes: { tier: ['free', 'paid'], source: open },
  }),

  'checkout.duration': histogram({
    unit: 'ms',
    buckets: [10, 100],
    attributes: { step: ['validate', 'charge'] },
  }),

  restarts: counter(),
});

declare const metrics: MetricsOf<typeof OrdersMetrics>;

/** Значение перечня и любое значение открытого атрибута принимаются */
metrics.created.add(1, { tier: 'paid', source: 'web' });

/** Прибавка необязательна: без неё счётчик растёт на единицу */
metrics.created.add({ tier: 'free', source: 'cli' });

/** Значение вне перечня не компилируется */
// @ts-expect-error 'gold' не входит в перечень значений 'tier'
metrics.created.add(1, { tier: 'gold', source: 'web' });

/** Лишний ключ атрибута не компилируется */
// @ts-expect-error атрибута 'region' метрика не объявляла
metrics.created.add(1, { tier: 'paid', source: 'web', region: 'eu' });

/** Объявленный атрибут обязателен: без него ряд не определён */
// @ts-expect-error пропущен объявленный атрибут 'source'
metrics.created.add(1, { tier: 'paid' });

/** Метрики нет в группе */
// @ts-expect-error ключа 'deleted' в группе нет
metrics.deleted.add();

/** У счётчика нет метода гистограммы */
// @ts-expect-error 'created' объявлен счётчиком
metrics.created.record(1, { tier: 'paid', source: 'web' });

/** Гистограмма принимает наблюдение и объявленные атрибуты */
metrics['checkout.duration'].record(42, { step: 'charge' });

/** У гистограммы нет метода счётчика */
// @ts-expect-error 'checkout.duration' объявлена гистограммой
metrics['checkout.duration'].add(1, { step: 'charge' });

/** Метрика без атрибутов пишется без них */
metrics.restarts.add();
metrics.restarts.add(2);

/** Атрибуты метрики, которая их не объявляла, не компилируются */
// @ts-expect-error 'restarts' не объявляла атрибутов
metrics.restarts.add(1, { tier: 'paid' });

/** Корзины у счётчика не принимаются */
// @ts-expect-error у счётчика нет поля 'buckets'
const withBuckets = counter({ buckets: [1, 2] });

/** Гистограмма без корзин не компилируется */
// @ts-expect-error поле 'buckets' обязательно
const withoutBuckets = histogram({ unit: 'ms' });
