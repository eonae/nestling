/**
 * Формы io: `stream`, `events`, `multipart` и их описатель.
 *
 * `input` и `output` декларации — это форма (`value`, `stream`, `events`
 * или `multipart`), а лист формы — Standard Schema или примитив
 * (`'binary'`, `'text'`). Форма описывает, как передаются данные; схема
 * описывает сами данные.
 *
 * Форма — неизменяемое значение с неперечислимым брендом. Объект с полем
 * `kind`, созданный вручную, формой не считается.
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
 * Шаг item-цепочки. Хранится как данные, а не как замыкание: цепочка
 * объявляется вне контейнера, и описатель должен сериализоваться.
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
 * Опции потоковой формы. По умолчанию элементы валидируются; отключение
 * явное и видно в декларации.
 */
export interface StreamFormOptions {
  /** Валидировать ли элементы схемой-листом (по умолчанию `true`) */
  validate?: boolean;

  /**
   * Что делать с невалидным элементом входа (по умолчанию `'fail'`).
   * На выходе не действует: невалидный элемент ответа всегда даёт отказ.
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
 * Описатель формы. Его читают транспорт, генератор документации и рантайм
 * пайплайна.
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
 * @param TWire - Тип элемента в сети; его описывает схема-лист
 * @param TItem - Тип элемента после объявленных шагов цепочки
 * @param K - Вид формы: `stream` (конечные данные) или `events`
 * (открытая подписка)
 *
 * Слот `output` принимает только форму с `TItem = TWire`, слот `input` —
 * любую. Поэтому `.batch(100)` в `output` — ошибка компиляции.
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

  /** Группировка элементов; меняет тип, поэтому допустима только во входе */
  batch(size: number): StreamForm<TWire, TItem[], K>;

  /** Произвольное преобразование потока; в выходе допустимо только без смены типа */
  through<TNext>(
    fn: (src: AsyncIterable<TItem>) => AsyncIterable<TNext>,
  ): StreamForm<TWire, TNext, K>;
}

/** Форма запроса с полями и файлами; допустима только во входе */
export interface MultipartForm<
  F extends Optional<Schema> = Optional<Schema>,
  FS extends Record<string, UploadSpec> = Record<string, UploadSpec>,
> extends FormDescriptor {
  readonly kind: 'multipart';
  readonly fields?: F;
  readonly files: FS;
}

/** Любая потоковая форма; для мест, где тип элемента не важен */
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
 * Проверяет, что значение создано конструктором формы (`stream`, `events`
 * или `multipart`). Объект `{ kind: 'stream', leaf }`, созданный вручную,
 * формой не считается.
 */
export function isForm(value: unknown): value is FormDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[FORM_BRAND] === true
  );
}

/** Проверяет, что значение создано `upload()` */
export function isUploadSpec(value: unknown): value is UploadSpec {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[UPLOAD_BRAND] === true
  );
}

/** Проверяет, что лист формы — примитив */
export function isPrimitiveLeaf(leaf: unknown): leaf is IOPrimitive {
  return leaf === 'binary' || leaf === 'text';
}

/** Проверяет, что вид формы потоковый (`stream` или `events`) */
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
 * Строит потоковую форму. Каждый комбинатор возвращает новую форму, поэтому
 * цепочки можно переиспользовать функциями:
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
 * Объявляет конечный поток данных. Нормальный исход — `completed`; по HTTP
 * передаётся как NDJSON.
 *
 * @example
 * ```typescript
 * input: stream(LogChunk).filter(c => c.level !== 'debug').limit(50_000)
 * // payload: AsyncIterableIterator<LogChunk>
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
 * Объявляет открытую подписку. Нормальный исход — `disconnected`; по HTTP
 * передаётся как SSE.
 *
 * @example
 * ```typescript
 * output: events(ActivityEvent)
 * // хендлер возвращает AsyncIterable<ActivityEvent>
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
 * Объявляет файловое поле формы `multipart`.
 *
 * Лимиты применяются во время разбора: превышение `maxSize` прерывает
 * чтение файла, несовпадение `mime` даёт отказ до чтения тела. Вне
 * `multipart` спецификация отвергается при создании декларации.
 *
 * Две перегрузки вместо тип-параметра: литерал `true` в позиции свойства
 * расширяется до `boolean`, и `files.<имя>` перестал бы различать
 * `FilePart` и `FilePart[]`.
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
 * Ошибка типов: имя файлового поля совпало с полем формы.
 *
 * Проверяется типами, а не рантаймом: Standard Schema не даёт списка
 * ключей.
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
 * // payload: { fields: { title: string }, files: { avatar: FilePart } }
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
 * Возвращает описатель формы для значения `input` или `output`.
 *
 * Схема без обёртки и `undefined` дают `kind: 'value'`: отдельного
 * конструктора `value(...)` нет.
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
 * Возвращает media type формы.
 *
 * Правило одно для всех потребителей: транспорт выбирает по нему
 * кодирование, генератор OpenAPI — `content`, клиент — заголовки запроса.
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
 * Проверка формы `output` на уровне типов: `multipart` не допускается, а
 * тип элемента цепочки должен совпадать с типом элемента в сети.
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
 * Совпадают ли два типа элемента.
 *
 * Сравнение вынесено в отдельный тип, а литерал диагностики в
 * `ValidateOutputForm` оставлен на месте: именованный алиас TypeScript
 * печатает именем, и текст ошибки пропал бы.
 */
type SameItem<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
