/**
 * Объявление метрик: группа — значение, метрика — её член.
 *
 * Группа создаётся `makeMetrics(prefix, { … })` и служит DI-токеном:
 * `@Component([OrdersMetrics])` даёт писателя, у которого метрика
 * выбирается полем. Строкового имени в точке записи не бывает, поэтому
 * состав метрик известен сборке целиком.
 */

import type { Token } from '@nestlingjs/container';

/**
 * Пометка открытого атрибута: значения известны только в рантайме.
 *
 * Пометка обязательна и умолчания не имеет. Количество рядов метрики —
 * ответственность её автора, и `open` — место, где он её берёт: ряд
 * такого атрибута заводится по факту записи, и нулей до неё нет.
 */
export const open: unique symbol = Symbol('nestling.metrics.open');

/** Тип пометки открытого атрибута */
export type Open = typeof open;

/** Объявление атрибута: перечень значений или пометка `open` */
export type AttributeSpec = readonly string[] | Open;

/** Объявленные атрибуты метрики: имя атрибута — его объявление */
export type AttributesSpec = Readonly<Record<string, AttributeSpec>>;

/** Метрика без атрибутов: у неё ровно один ряд */
export type NoAttributes = Readonly<Record<never, never>>;

/** Общие поля объявления любой метрики */
export interface MetricOptions<A extends AttributesSpec = AttributesSpec> {
  /** Описание метрики: уходит в `# HELP` экспозиции */
  readonly help?: string;

  /** Единица измерения: `ms`, `bytes`, `requests` */
  readonly unit?: string;

  /** Объявленные атрибуты; без поля метрика имеет ровно один ряд */
  readonly attributes?: A;
}

/** Объявление гистограммы: общие поля плюс границы корзин */
export interface HistogramOptions<A extends AttributesSpec = AttributesSpec>
  extends MetricOptions<A> {
  /** Границы корзин по возрастанию; агрегат считает по ним store */
  readonly buckets: readonly number[];
}

/** Объявленный счётчик */
export interface CounterDeclaration<A extends AttributesSpec = AttributesSpec> {
  /** Вид метрики */
  readonly kind: 'counter';

  /** Описание метрики */
  readonly help?: string;

  /** Единица измерения */
  readonly unit?: string;

  /** Объявленные атрибуты */
  readonly attributes: A;
}

/** Объявленная гистограмма */
export interface HistogramDeclaration<
  A extends AttributesSpec = AttributesSpec,
> {
  /** Вид метрики */
  readonly kind: 'histogram';

  /** Описание метрики */
  readonly help?: string;

  /** Единица измерения */
  readonly unit?: string;

  /** Объявленные атрибуты */
  readonly attributes: A;

  /** Границы корзин по возрастанию */
  readonly buckets: readonly number[];
}

/** Объявление метрики любого вида */
export type MetricDeclaration =
  | CounterDeclaration<any>
  | HistogramDeclaration<any>;

/** Состав группы: ключ записи — объявление метрики */
export type MetricsMembers = Readonly<Record<string, MetricDeclaration>>;

/**
 * Член группы: объявление, знающее своё полное имя.
 *
 * Имя приписывает `makeMetrics`: до группы у метрики его нет, а после —
 * членом группы адресуют ряд в снимке, не называя его строкой.
 */
export type Member<D extends MetricDeclaration> = D & {
  /** Полное имя метрики: префикс группы и ключ записи */
  readonly name: string;
};

/** Состав группы после приписывания имён */
export type MembersOf<M extends MetricsMembers> = {
  readonly [K in keyof M]: Member<M[K]>;
};

/** Член любой группы — там, где вид метрики не важен */
export type AnyMember = Member<MetricDeclaration>;

/** Значения атрибута: перечень даёт свои, `open` — любой скаляр */
type ValuesOf<S extends AttributeSpec> = S extends readonly (infer V)[]
  ? V
  : string | number | boolean;

/** Атрибуты записи: по одному значению на каждый объявленный атрибут */
export type AttributesOf<A extends AttributesSpec> = {
  readonly [K in keyof A]: ValuesOf<A[K]>;
};

/**
 * Аргументы `add`: у метрики без атрибутов — только прибавка, у метрики с
 * атрибутами — атрибуты, с прибавкой или без неё.
 */
type CounterArgs<A extends AttributesSpec> = [keyof A] extends [never]
  ? [value?: number]
  :
      | [attributes: AttributesOf<A>]
      | [value: number, attributes: AttributesOf<A>];

/** Аргументы `record`: наблюдение и атрибуты, если они объявлены */
type HistogramArgs<A extends AttributesSpec> = [keyof A] extends [never]
  ? [value: number]
  : [value: number, attributes: AttributesOf<A>];

/** Писатель счётчика */
export interface CounterWriter<A extends AttributesSpec = AttributesSpec> {
  /**
   * Прибавляет к счётчику.
   *
   * Без прибавки — единица. Атрибуты обязательны ровно тогда, когда они
   * объявлены: иначе ряд был бы не определён.
   */
  add(...args: CounterArgs<A>): void;
}

/** Писатель гистограммы */
export interface HistogramWriter<A extends AttributesSpec = AttributesSpec> {
  /**
   * Добавляет наблюдение.
   *
   * Атрибуты обязательны ровно тогда, когда они объявлены.
   */
  record(...args: HistogramArgs<A>): void;
}

/** Писатель группы: метрика выбирается полем по ключу состава */
export type MetricsWriter<M extends MetricsMembers> = {
  readonly [K in keyof M]: M[K] extends HistogramDeclaration<infer A>
    ? HistogramWriter<A>
    : M[K] extends CounterDeclaration<infer A>
      ? CounterWriter<A>
      : never;
};

/**
 * Группа метрик: значение, которое служит и объявлением, и DI-токеном.
 *
 * Как объявление она несёт префикс и состав — из них сборка строит
 * каталог. Как DI-токен она раздаёт писателя: `@Component([OrdersMetrics])`
 * даёт `MetricsOf<typeof OrdersMetrics>`.
 */
export interface MetricsGroup<M extends MetricsMembers = MetricsMembers>
  extends Token<MetricsWriter<M>> {
  /** Префикс имён: первая часть полного имени каждой метрики */
  readonly prefix: string;

  /** Состав группы: ключ записи — член с полным именем */
  readonly members: MembersOf<M>;
}

/** Группа с любым составом — там, где состав не важен */
export type AnyMetricsGroup = MetricsGroup<any>;

/**
 * Тип писателя группы: то, что приходит в конструктор потребителя.
 *
 * Выводится из самого DI-токена: писатель — его значение, и второго
 * источника этого типа нет.
 */
export type MetricsOf<G extends AnyMetricsGroup> =
  G extends Token<infer W> ? W : never;

/** Полное имя метрики: префикс группы и ключ записи, без преобразований */
export const metricName = (prefix: string, key: string): string =>
  `${prefix}.${key}`;

/** Проверяет объявленные атрибуты одной метрики */
function assertAttributes(
  prefix: string,
  key: string,
  attributes: AttributesSpec,
): void {
  for (const [attribute, spec] of Object.entries(attributes)) {
    if (attribute.trim().length === 0) {
      throw new Error(
        `makeMetrics('${prefix}'): metric '${key}' declares an attribute ` +
          `with an empty name. Name every attribute.`,
      );
    }

    if (spec === open) {
      continue;
    }

    if (!Array.isArray(spec) || spec.length === 0) {
      throw new Error(
        `makeMetrics('${prefix}'): attribute '${attribute}' of metric ` +
          `'${metricName(prefix, key)}' must be declared either as a ` +
          `non-empty list of values or as 'open'.`,
      );
    }

    if (new Set(spec).size !== spec.length) {
      throw new Error(
        `makeMetrics('${prefix}'): attribute '${attribute}' of metric ` +
          `'${metricName(prefix, key)}' lists a value twice. Every value ` +
          `stands for one series, so the list has no repetitions.`,
      );
    }
  }
}

/** Проверяет границы корзин: они и задают агрегат гистограммы */
function assertBuckets(
  prefix: string,
  key: string,
  buckets: readonly number[],
): void {
  if (!Array.isArray(buckets) || buckets.length === 0) {
    throw new Error(
      `makeMetrics('${prefix}'): histogram '${metricName(prefix, key)}' ` +
        `must declare bucket boundaries: the store aggregates by them.`,
    );
  }

  for (const [index, boundary] of buckets.entries()) {
    if (!Number.isFinite(boundary)) {
      throw new TypeError(
        `makeMetrics('${prefix}'): histogram '${metricName(prefix, key)}' ` +
          `declares a bucket boundary that is not a finite number ` +
          `(${String(boundary)}).`,
      );
    }

    const previous = buckets[index - 1];

    if (previous !== undefined && boundary <= previous) {
      throw new Error(
        `makeMetrics('${prefix}'): histogram '${metricName(prefix, key)}' ` +
          `declares buckets out of order (${previous} then ${boundary}). ` +
          `List the boundaries in ascending order.`,
      );
    }
  }
}

/**
 * Объявляет счётчик.
 *
 * Возврат обёрнут в `NoInfer`: без обёртки перечень атрибутов берётся не
 * из аргумента, а из ожидаемого типа члена группы, и `counter()` без
 * опций получал бы `any` вместо пустого перечня.
 *
 * @param options - Описание, единица измерения и атрибуты
 * @returns Объявление метрики; членом группы оно становится в `makeMetrics`
 *
 * @example
 * ```typescript
 * counter({ help: 'Созданные заказы', attributes: { tier: ['free', 'paid'] } })
 * ```
 */
export function counter<const A extends AttributesSpec = NoAttributes>(
  options: MetricOptions<A> = {},
): CounterDeclaration<NoInfer<A>> {
  const { help, unit, attributes } = options;

  return Object.freeze({
    kind: 'counter' as const,
    ...(help === undefined ? {} : { help }),
    ...(unit === undefined ? {} : { unit }),
    attributes: Object.freeze({ ...attributes }) as A,
  });
}

/**
 * Объявляет гистограмму.
 *
 * Конструктор отдельный, а не поле вида у общего: у счётчика корзин нет, и
 * расхождение проверяется типом в точке объявления. Возврат обёрнут в
 * `NoInfer` по той же причине, что у {@link counter}.
 *
 * @param options - Границы корзин, описание, единица измерения и атрибуты
 * @returns Объявление метрики
 *
 * @example
 * ```typescript
 * histogram({ unit: 'ms', buckets: [10, 50, 100], attributes: { step: ['charge'] } })
 * ```
 */
export function histogram<const A extends AttributesSpec = NoAttributes>(
  options: HistogramOptions<A>,
): HistogramDeclaration<NoInfer<A>> {
  const { help, unit, attributes, buckets } = options;

  return Object.freeze({
    kind: 'histogram' as const,
    ...(help === undefined ? {} : { help }),
    ...(unit === undefined ? {} : { unit }),
    attributes: Object.freeze({ ...attributes }) as A,
    buckets: Object.freeze([...(buckets ?? [])]),
  });
}

/**
 * Объявляет группу метрик.
 *
 * Группа — значение: её создание ничего не регистрирует. В каталог она
 * попадает вкладом `metrics:` фичи, модуля или плагина, а писателя
 * раздаёт граф — по ней же как по DI-токену.
 *
 * @param prefix - Префикс имён: первая часть полного имени каждой метрики
 * @param members - Состав: ключ записи — объявление метрики
 * @returns Группу-значение
 *
 * @throws {Error} Пустой префикс, пустой ключ, неверные атрибуты или
 * границы корзин не по возрастанию
 *
 * @example
 * ```typescript
 * export const OrdersMetrics = makeMetrics('orders', {
 *   created: counter({
 *     help: 'Созданные заказы',
 *     attributes: { tier: ['free', 'paid'], source: open },
 *   }),
 *   'checkout.duration': histogram({
 *     help: 'Время оформления',
 *     unit: 'ms',
 *     buckets: [5, 25, 100, 500],
 *   }),
 * });
 * ```
 */
export function makeMetrics<M extends MetricsMembers>(
  prefix: string,
  members: M,
): MetricsGroup<M> {
  if (typeof prefix !== 'string' || prefix.trim().length === 0) {
    throw new Error(
      `makeMetrics(prefix, { … }): 'prefix' must be a non-empty string — it ` +
        `is the first part of every metric name in the group.`,
    );
  }

  const keys = Object.keys(members);

  if (keys.length === 0) {
    throw new Error(
      `makeMetrics('${prefix}', { … }): the group declares no metrics. ` +
        `Declare at least one with counter({ … }) or histogram({ … }).`,
    );
  }

  for (const key of keys) {
    const declaration = members[key];

    if (key.trim().length === 0) {
      throw new Error(
        `makeMetrics('${prefix}'): a metric key is empty. The key is the ` +
          `second part of the metric name, so it is written as it should ` +
          `read in the name.`,
      );
    }

    if (declaration?.kind !== 'counter' && declaration?.kind !== 'histogram') {
      throw new Error(
        `makeMetrics('${prefix}'): member '${key}' is not a metric ` +
          `declaration. Declare it with counter({ … }) or histogram({ … }).`,
      );
    }

    assertAttributes(prefix, key, declaration.attributes);

    if (declaration.kind === 'histogram') {
      assertBuckets(prefix, key, declaration.buckets);
    }
  }

  // Имя приписывается здесь: объявление метрики о группе не знает, а
  // после неё членом группы адресуют ряд снимка
  const named: Record<string, MetricDeclaration & { name: string }> = {};

  for (const key of keys) {
    named[key] = Object.freeze({
      ...(members[key] as MetricDeclaration),
      name: metricName(prefix, key),
    });
  }

  return Object.freeze({
    id: `Metrics:${prefix}`,
    hint:
      `declare the group in 'metrics:' of the feature, module or plugin ` +
      `that owns it`,
    prefix,
    members: Object.freeze(named) as MembersOf<M>,
  }) as MetricsGroup<M>;
}

/** Проверяет, что значение — группа метрик */
export const isMetricsGroup = (value: unknown): value is AnyMetricsGroup =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as AnyMetricsGroup).prefix === 'string' &&
  typeof (value as AnyMetricsGroup).members === 'object';
