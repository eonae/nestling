/**
 * io-декларация как **дерево форм над схемами**.
 *
 * Верхний уровень `input`/`output` — форма (`value` | `stream` | `events` |
 * `multipart`), листья — произвольная Standard Schema или примитив
 * (`'binary'`/`'text'`). Спека схем от этого не меняется: форма живёт
 * **над** схемами, а не внутри них — стрим не значение, и упаковывать его
 * в схему было бы натягиванием.
 *
 * Форма — неизменяемое значение с неперечислимым брендом (как декларация
 * endpoint'а и bind-карта): случайный объект с полем `kind` формой не
 * считается.
 */

import type { Infer, Optional, Schema } from '@common/misc';

/** Вид формы io */
export type FormKind = 'value' | 'stream' | 'events' | 'multipart';

/** Потоковые виды: у них есть item-цепочка и поэлементная валидация */
export type StreamKind = 'stream' | 'events';

/** Примитивный лист формы: тело как есть, без схемы */
export type IOPrimitive = 'binary' | 'text';

/** Лист формы: схема или примитив */
export type FormLeaf = Schema | IOPrimitive;

/**
 * Шаг item-цепочки — **данные**, а не замыкание над рантаймом: цепочка
 * объявляется вне контейнера и обязана переживать сериализацию описателя.
 */
export type ChainStep =
  | { readonly op: 'tap'; readonly fn: (item: any) => void }
  | { readonly op: 'filter'; readonly fn: (item: any) => boolean }
  | { readonly op: 'limit'; readonly max: number }
  | { readonly op: 'gapTimeout'; readonly ms: number }
  | { readonly op: 'throttle'; readonly perSecond: number }
  | { readonly op: 'batch'; readonly size: number }
  | {
      readonly op: 'through';
      readonly fn: (src: AsyncIterable<any>) => AsyncIterable<any>;
    };

/** Политика поэлементной валидации потоковой формы */
export interface ItemOptions {
  readonly validate: boolean;
  readonly onInvalid: 'fail' | 'skip';
}

/**
 * Опции потоковой формы.
 *
 * Дефолт — валидировать (schema-first не делает исключений для горячего
 * пути); opt-out явный и виден в тексте декларации.
 */
export interface StreamFormOptions {
  /** Валидировать ли элементы схемой-листом (по умолчанию `true`) */
  validate?: boolean;

  /**
   * Что делать с невалидным элементом **входа** (по умолчанию `'fail'`).
   * На выходе игнорируется: молча ронять данные из ответа фреймворк не
   * будет.
   */
  onInvalid?: 'fail' | 'skip';
}

/** Спецификация файлового поля `multipart` */
export interface UploadSpec<M extends boolean = boolean> {
  /** Лимит размера файла; не задан — берётся лимит транспорта */
  readonly maxSize?: number;

  /** Допустимые MIME-типы; не задан — любые */
  readonly mime?: readonly string[];

  /** `true` — поле принимает несколько файлов и даёт `FilePart[]` */
  readonly multiple: M;
}

/**
 * Описатель формы: то, что читают транспорт, генератор документации и
 * рантайм пайплайна.
 *
 * Заменяет прежний `analyzePayload`/`PayloadConfig`, который не различал
 * `events` и знал два разных multipart-модификатора.
 */
export interface FormDescriptor {
  readonly kind: FormKind;

  /** Лист формы: схема, примитив или ничего (`input` не объявлен) */
  readonly leaf?: FormLeaf;

  /** Шаги item-цепочки в порядке объявления (потоковые формы) */
  readonly chain?: readonly ChainStep[];

  /** Политика поэлементной валидации (потоковые формы) */
  readonly items?: ItemOptions;

  /** Схема полей формы (`multipart`) */
  readonly fields?: Schema;

  /** Файловые поля по именам (`multipart`) */
  readonly files?: Readonly<Record<string, UploadSpec>>;
}

/**
 * Потоковая форма с item-цепочкой.
 *
 * @param TWire - тип элемента **на проводе** (его описывает схема-лист)
 * @param TItem - тип элемента после уже объявленных шагов цепочки
 * @param K - вид формы: `stream` (конечные данные) или `events`
 * (открытая подписка)
 *
 * Асимметрия входа и выхода задаётся **слотом**, а не двумя билдерами:
 * `output` принимает форму с `TItem = TWire`, `input` — любую. Поэтому
 * `.batch(100)` на выходе — ошибка компиляции в точке декларации.
 */
export interface StreamForm<
  TWire = unknown,
  TItem = TWire,
  K extends StreamKind = StreamKind,
> extends FormDescriptor {
  readonly kind: K;
  readonly leaf: FormLeaf;
  readonly chain: readonly ChainStep[];
  readonly items: ItemOptions;

  /** Наблюдение за элементом */
  tap(fn: (item: TItem) => void): StreamForm<TWire, TItem, K>;

  /** Отбор элементов */
  filter(predicate: (item: TItem) => boolean): StreamForm<TWire, TItem, K>;

  /** Верхняя граница числа элементов (`STREAM_LIMIT_EXCEEDED`, 413) */
  limit(max: number): StreamForm<TWire, TItem, K>;

  /** Таймаут молчания источника (`STREAM_GAP_TIMEOUT`, 504) */
  gapTimeout(ms: number): StreamForm<TWire, TItem, K>;

  /** Ограничение частоты; элементы буферизуются, а не теряются */
  throttle(perSecond: number): StreamForm<TWire, TItem, K>;

  /** Группировка — **тип-меняющий** шаг, легален только во входе */
  batch(size: number): StreamForm<TWire, TItem[], K>;

  /** Escape hatch; в выходе допустим только в варианте `T → T` */
  through<TNext>(
    fn: (src: AsyncIterable<TItem>) => AsyncIterable<TNext>,
  ): StreamForm<TWire, TNext, K>;
}

/** Форма запроса с полями и файлами; легальна только во входе */
export interface MultipartForm<
  F extends Optional<Schema> = Optional<Schema>,
  FS extends Record<string, UploadSpec> = Record<string, UploadSpec>,
> extends FormDescriptor {
  readonly kind: 'multipart';
  readonly fields?: F;
  readonly files: FS;
}

/** Любая потоковая форма — там, где тип элемента несуществен */
export type AnyStreamForm = StreamForm<any, any, StreamKind>;

/** Любая multipart-форма */
export type AnyMultipartForm = MultipartForm<any, any>;

// ---------------------------------------------------------------------------
// Бренды
// ---------------------------------------------------------------------------

const FORM_BRAND = Symbol.for('nestling:io-form');
const UPLOAD_BRAND = Symbol.for('nestling:io-upload');

function brand<T extends object>(value: T, symbol: symbol): T {
  Object.defineProperty(value, symbol, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return value;
}

/**
 * Значение создано конструктором формы (`stream`/`events`/`multipart`).
 *
 * Посторонний объект `{ kind: 'stream', leaf: Schema }` формой **не**
 * считается: тот же аргумент, что для бренда декларации.
 */
export function isForm(value: unknown): value is FormDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[FORM_BRAND] === true
  );
}

/** Значение создано `upload()` */
export function isUploadSpec(value: unknown): value is UploadSpec {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[UPLOAD_BRAND] === true
  );
}

/** Лист формы — примитив, а не схема */
export function isPrimitiveLeaf(leaf: unknown): leaf is IOPrimitive {
  return leaf === 'binary' || leaf === 'text';
}

/** Вид формы потоковый (`stream` или `events`) */
export function isStreamKind(kind: FormKind): kind is StreamKind {
  return kind === 'stream' || kind === 'events';
}

// ---------------------------------------------------------------------------
// Конструкторы форм
// ---------------------------------------------------------------------------

/** Тип элемента, описанного листом формы */
export type LeafType<T> = T extends 'binary'
  ? Buffer
  : T extends 'text'
    ? string
    : T extends Schema
      ? Infer<T>
      : never;

const DEFAULT_ITEMS: ItemOptions = Object.freeze({
  validate: true,
  onInvalid: 'fail' as const,
});

function readItemOptions(options?: StreamFormOptions): ItemOptions {
  if (!options) {
    return DEFAULT_ITEMS;
  }
  return Object.freeze({
    validate: options.validate ?? true,
    onInvalid: options.onInvalid ?? 'fail',
  });
}

/**
 * Строит потоковую форму. Каждый комбинатор возвращает **новую** форму —
 * только так цепочки переиспользуются функциями-хелперами:
 * `const guarded = (s) => stream(s).limit(50_000).gapTimeout(30_000)`.
 */
function buildStreamForm(
  kind: StreamKind,
  leaf: FormLeaf,
  items: ItemOptions,
  chain: readonly ChainStep[],
): AnyStreamForm {
  const next = (step: ChainStep): AnyStreamForm =>
    buildStreamForm(kind, leaf, items, [...chain, step]);

  const form = {
    kind,
    leaf,
    items,
    chain: Object.freeze([...chain]),
    tap: (fn: (item: unknown) => void) => next({ op: 'tap', fn }),
    filter: (fn: (item: unknown) => boolean) => next({ op: 'filter', fn }),
    limit: (max: number) => next({ op: 'limit', max }),
    gapTimeout: (ms: number) => next({ op: 'gapTimeout', ms }),
    throttle: (perSecond: number) => next({ op: 'throttle', perSecond }),
    batch: (size: number) => next({ op: 'batch', size }),
    through: (fn: (src: AsyncIterable<unknown>) => AsyncIterable<unknown>) =>
      next({ op: 'through', fn }),
  };

  return Object.freeze(brand(form, FORM_BRAND)) as unknown as AnyStreamForm;
}

function assertLeaf(
  leaf: unknown,
  constructor: string,
): asserts leaf is FormLeaf {
  if (leaf === undefined || leaf === null) {
    throw new TypeError(
      `${constructor}(...): a leaf is required — pass a Standard Schema or ` +
        `a primitive ('binary' | 'text').`,
    );
  }
}

/**
 * Конечный поток данных: нормальный исход — `completed`, HTTP-framing —
 * NDJSON.
 *
 * @example
 * ```typescript
 * input: stream(LogChunk).filter(c => c.level !== 'debug').limit(50_000)
 * // → payload: AsyncIterableIterator<LogChunk>
 * ```
 */
export function stream<T extends Schema | IOPrimitive>(
  leaf: T,
  options?: StreamFormOptions,
): StreamForm<LeafType<T>, LeafType<T>, 'stream'> {
  assertLeaf(leaf, 'stream');
  return buildStreamForm(
    'stream',
    leaf,
    readItemOptions(options),
    [],
  ) as unknown as StreamForm<LeafType<T>, LeafType<T>, 'stream'>;
}

/**
 * Открытая подписка: нормальное завершение — дисконнект (исход
 * `disconnected`), HTTP-framing — SSE.
 *
 * @example
 * ```typescript
 * output: events(ActivityEvent)
 * // → возврат хендлера: AsyncIterable<ActivityEvent>
 * ```
 */
export function events<T extends Schema | IOPrimitive>(
  leaf: T,
  options?: StreamFormOptions,
): StreamForm<LeafType<T>, LeafType<T>, 'events'> {
  assertLeaf(leaf, 'events');
  return buildStreamForm(
    'events',
    leaf,
    readItemOptions(options),
    [],
  ) as unknown as StreamForm<LeafType<T>, LeafType<T>, 'events'>;
}

/** Опции файлового поля */
export interface UploadOptions<M extends boolean = boolean> {
  maxSize?: number;
  mime?: readonly string[];
  multiple?: M;
}

/**
 * Спецификация файлового поля `multipart`.
 *
 * Лимиты применяются **во время** разбора: превышение `maxSize` прерывает
 * чтение конкретного файла, несовпадение `mime` — отказ до чтения тела.
 * Вне `multipart` не имеет смысла и отвергается при создании декларации.
 *
 * Две перегрузки, а не тип-параметр: выводить `multiple` инференсом нельзя
 * — литерал `true` в позиции свойства расширяется до `boolean`, и
 * `files.<имя>` переставал бы различать `FilePart` и `FilePart[]`.
 */
export function upload(options?: UploadOptions<false>): UploadSpec<false>;
export function upload(
  options: UploadOptions<true> & { multiple: true },
): UploadSpec<true>;
export function upload(options: UploadOptions = {}): UploadSpec {
  const spec: UploadSpec = {
    ...(options.maxSize === undefined ? {} : { maxSize: options.maxSize }),
    ...(options.mime === undefined
      ? {}
      : { mime: Object.freeze([...options.mime]) }),
    multiple: options.multiple ?? false,
  };

  return Object.freeze(brand(spec, UPLOAD_BRAND));
}

/** Ключи схемы, известные типам (рантайму Standard Schema их не отдаёт) */
type FieldKeys<F> = F extends Schema ? keyof Infer<F> : never;

/**
 * Тип-ошибка: имя файлового поля совпало с полем формы.
 *
 * Проверяется **типами**, а не рантаймом: перечня ключей Standard Schema
 * не отдаёт — то же ограничение, что у проверки path-параметров.
 */
type NoFieldConflict<F, FS> = [Extract<keyof FS, FieldKeys<F>>] extends [never]
  ? unknown
  : {
      __error: 'multipart file field collides with a field of the form schema';
      conflicting: Extract<keyof FS, FieldKeys<F>>;
    };

/**
 * Форма запроса с полями и файлами.
 *
 * @example
 * ```typescript
 * input: multipart({
 *   fields: z.object({ title: z.string() }),
 *   files: { avatar: upload({ maxSize: 5 * MiB, mime: ['image/png'] }) },
 * })
 * // → payload: { fields: { title: string }, files: { avatar: FilePart } }
 * ```
 */
export function multipart<
  F extends Optional<Schema> = undefined,
  FS extends Record<string, UploadSpec> = Record<string, UploadSpec>,
>(
  spec: { fields?: F; files: FS } & NoFieldConflict<F, FS>,
): MultipartForm<F, FS> {
  const { fields, files } = spec as { fields?: F; files: FS };

  if (typeof files !== 'object' || files === null) {
    throw new TypeError(
      "multipart({ … }): 'files' must be a record of upload() specifications.",
    );
  }

  for (const [name, value] of Object.entries(files)) {
    if (!isUploadSpec(value)) {
      throw new TypeError(
        `multipart({ … }): files.${name} is not an upload() specification.`,
      );
    }
  }

  const form = {
    kind: 'multipart' as const,
    ...(fields === undefined ? {} : { fields }),
    files: Object.freeze({ ...files }),
  };

  return Object.freeze(brand(form, FORM_BRAND)) as unknown as MultipartForm<
    F,
    FS
  >;
}

// ---------------------------------------------------------------------------
// Описатель и media types
// ---------------------------------------------------------------------------

const VALUE_NONE: FormDescriptor = Object.freeze({ kind: 'value' as const });

/**
 * Описывает io-конфигурацию как форму.
 *
 * Схема без обёртки (и `undefined`) — это `kind: 'value'`: «схема как
 * есть» остаётся канонической записью, вводить `value(...)` не нужно.
 */
export function describeForm(io?: unknown): FormDescriptor {
  if (io === undefined || io === null) {
    return VALUE_NONE;
  }

  if (isPrimitiveLeaf(io)) {
    return { kind: 'value', leaf: io };
  }

  if (isForm(io)) {
    return io;
  }

  return { kind: 'value', leaf: io as Schema };
}

/**
 * Media type формы — **однозначная функция от формы**.
 *
 * Одно правило на всех: транспорт выбирает framing, генератор OpenAPI —
 * `content`, клиент — заголовки запроса.
 */
export function mediaTypeOf(io?: unknown): string {
  const form = describeForm(io);

  switch (form.kind) {
    case 'stream': {
      return 'application/x-ndjson';
    }
    case 'events': {
      return 'text/event-stream';
    }
    case 'multipart': {
      return 'multipart/form-data';
    }
    default: {
      if (form.leaf === 'binary') {
        return 'application/octet-stream';
      }
      if (form.leaf === 'text') {
        return 'text/plain';
      }
      return 'application/json';
    }
  }
}

/**
 * Тип-ошибка слота `output`: тип элемента цепочки разошёлся с типом
 * провода.
 *
 * Правило журнала «оба конца выхода зафиксированы схемой» выражено одной
 * сигнатурой: отдельного «выходного» типа цепочки не появляется.
 */
export type ValidateOutputForm<O> = O extends AnyMultipartForm
  ? {
      __error: "'multipart' is an input-only form and cannot be declared in 'output'";
    }
  : O extends StreamForm<infer TWire, infer TItem, StreamKind>
    ? SameItem<TWire, TItem> extends true
      ? unknown
      : {
          __error: "Output item chain must preserve the wire type: '.batch' and type-changing '.through' are input-only";
        }
    : unknown;

/**
 * Совпадают ли тип провода и тип элемента цепочки.
 *
 * Литерал диагностики обязан быть **анонимным и развёрнутым в точке
 * печати**: именованный алиас TypeScript печатает именем, и текст правила
 * из сообщения пропадает. Поэтому сравнение вынесено сюда, а сам литерал
 * остаётся inline.
 */
type SameItem<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
