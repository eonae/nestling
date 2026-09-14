/**
 * Снимок store: ряды со значениями и каталожными полями метрик.
 *
 * Снимок — единственный выход накопленного наружу. Приложение не
 * реализует запись и не перехватывает её: числа держит ядро, а тот, кто
 * отправляет их наружу, читает состояние на момент вызова.
 */

/**
 * Атрибуты ряда: только скаляры.
 *
 * Значения приходят из объявления метрики, а не из запроса: набор рядов
 * известен сборке, и от трафика он не растёт.
 */
export type MetricAttributes = Record<string, string | number | boolean>;

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
