/**
 * Получатель записей store: атрибуты ряда и два метода записи.
 *
 * `MetricSink` — выход, а не вход. Приложение его не реализует: накопленное
 * держит ядро, а подписывается на записи тот, кто отправляет их наружу.
 */

/**
 * Атрибуты ряда: только скаляры.
 *
 * Значения приходят из объявления метрики, а не из запроса: набор рядов
 * известен сборке, и от трафика он не растёт.
 */
export type MetricAttributes = Record<string, string | number | boolean>;

/**
 * Получатель записей store.
 *
 * Записи идут потоком, а накопленное до подписки приходит снимком —
 * поэтому у получателя три метода, а не два: без `start` push-получатель
 * терял бы всё, что записано фазами INIT и START.
 *
 * @example
 * ```typescript
 * const stop = store.tap({
 *   start: (snapshot) => exporter.seed(snapshot),
 *   counter: (name, value, attributes) => exporter.add(name, value, attributes),
 *   histogram: (name, value, attributes) =>
 *     exporter.observe(name, value, attributes),
 * });
 * ```
 */
export interface MetricSink {
  /**
   * Стартовое состояние: снимок всех рядов на момент подписки.
   *
   * @param snapshot - Ряды со значениями и описанием метрик
   */
  start(snapshot: MetricsSnapshot): void;

  /**
   * Запись счётчика.
   *
   * @param name - Полное имя метрики
   * @param value - Прибавка
   * @param attributes - Атрибуты ряда
   */
  counter(name: string, value: number, attributes: MetricAttributes): void;

  /**
   * Наблюдение гистограммы.
   *
   * @param name - Полное имя метрики
   * @param value - Наблюдённое значение
   * @param attributes - Атрибуты ряда
   */
  histogram(name: string, value: number, attributes: MetricAttributes): void;
}

/** Одна корзина гистограммы: граница и число наблюдений не больше неё */
export interface HistogramBucket {
  /** Верхняя граница корзины из декларации */
  readonly le: number;

  /** Число наблюдений, попавших в корзину */
  readonly count: number;
}

/** Общая часть ряда: адрес и каталожные поля метрики */
interface SeriesBase {
  /** Полное имя метрики: префикс группы и ключ записи */
  readonly name: string;

  /** Атрибуты ряда */
  readonly attributes: MetricAttributes;

  /** Описание метрики из декларации */
  readonly help?: string;

  /** Единица измерения из декларации */
  readonly unit?: string;
}

/** Ряд счётчика: накопленное значение */
export interface CounterSeries extends SeriesBase {
  /** Вид метрики */
  readonly kind: 'counter';

  /** Накопленное значение */
  readonly value: number;
}

/** Ряд гистограммы: счётчик наблюдений, сумма и корзины */
export interface HistogramSeries extends SeriesBase {
  /** Вид метрики */
  readonly kind: 'histogram';

  /** Число наблюдений */
  readonly count: number;

  /** Сумма наблюдённых значений */
  readonly sum: number;

  /** Корзины по границам из декларации, в порядке возрастания */
  readonly buckets: readonly HistogramBucket[];
}

/** Ряд снимка: счётчик или гистограмма */
export type MetricSeries = CounterSeries | HistogramSeries;

/**
 * Снимок состояния: все заведённые ряды на момент вызова.
 *
 * Ряд несёт каталожные поля метрики, поэтому формат экспозиции строится
 * из снимка, не обращаясь к каталогу вторым запросом.
 */
export type MetricsSnapshot = readonly MetricSeries[];
