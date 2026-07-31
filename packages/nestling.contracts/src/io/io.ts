import type {
  AnyMultipartForm,
  AnyStreamForm,
  IOPrimitive,
  MultipartForm,
  StreamForm,
  StreamKind,
  UploadSpec,
} from './forms.js';

import type { Infer, Optional, Schema } from '@common/misc';

/**
 * Конфигурация `input`: форма io.
 *
 * Значение (схема как есть), примитив, потоковая форма или `multipart`.
 * Формы — брендированные значения (`./forms.js`), а не структурные объекты.
 */
export type AnyPayload<T extends Optional<Schema> = Optional<Schema>> =
  | T // Schema
  | IOPrimitive // 'binary' | 'text'
  | AnyStreamForm // stream(T) / events(T)
  | AnyMultipartForm; // multipart({ fields, files })

/**
 * Конфигурация `output`.
 *
 * `multipart` формально входит в union, чтобы диагностика шла читаемым
 * литералом `ValidateOutputForm`, а не отказом сопоставления с границей
 * тип-параметра.
 */
export type AnyOutput<T extends Optional<Schema> = Optional<Schema>> =
  | T // Schema
  | IOPrimitive // 'binary' | 'text'
  | AnyStreamForm // stream(T) / events(T)
  | AnyMultipartForm; // отвергается ValidateOutputForm

/**
 * Описание файла в multipart-запросе.
 *
 * Живёт здесь, а не в рантайме пайплайна, потому что это **тип payload'а**,
 * выводимый из формы `multipart(...)`: без него `InferInput` неполон, а
 * форма — часть декларации.
 *
 * Поле `stream` объявлено структурно (`AsyncIterable<Uint8Array>`), а не
 * `Readable` из `node:stream`: пакет обязан типизироваться в проекте без
 * Node-типов. Node'овский `Readable` этому типу удовлетворяет, поэтому
 * транспорт кладёт в поле ровно то же значение, что и прежде.
 */
export interface FilePart {
  /** Имя поля формы */
  field: string;

  /** Имя файла */
  filename: string;

  /** MIME-тип */
  mime: string;

  /** Поток данных файла */
  stream: AsyncIterable<Uint8Array>;

  /** Размер файла (если известен) */
  size?: number;
}

/** Файлы multipart по именам объявленных полей */
export type FilesOf<FS> = {
  [K in keyof FS]: FS[K] extends UploadSpec<true> ? FilePart[] : FilePart;
};

/**
 * Выводит тип payload хендлера из формы `input`.
 *
 * Потоковая форма даёт стандартный `AsyncIterableIterator` — собственного
 * типа потока в публичном API нет.
 */
export type InferInput<I> =
  // Примитивы
  I extends 'binary'
    ? Buffer
    : I extends 'text'
      ? string
      : // Потоковые формы: тип элемента — результат item-цепочки
        I extends StreamForm<any, infer TItem, StreamKind>
        ? AsyncIterableIterator<TItem>
        : // Multipart: поля отдельно, файлы по именам полей
          I extends MultipartForm<infer F, infer FS>
          ? { fields: Infer<F>; files: FilesOf<FS> }
          : // Undefined
            I extends undefined
            ? undefined
            : // Схема (по умолчанию)
              InferSchemaType<I>;

/**
 * Выводит тип возврата хендлера из формы `output`.
 */
export type InferOutput<O> =
  // Примитивы
  O extends 'binary'
    ? Buffer
    : O extends 'text'
      ? string
      : // Потоковые формы: оба конца зафиксированы схемой (см.
        // ValidateOutputForm), поэтому тип элемента — тип провода
        O extends StreamForm<any, infer TItem, StreamKind>
        ? AsyncIterable<TItem>
        : // Multipart в выходе нелегален — значения у него нет
          O extends AnyMultipartForm
          ? never
          : // Undefined
            O extends undefined
            ? undefined
            : // Схема (по умолчанию)
              InferSchemaType<O>;

/**
 * Поля, которые может помечать bind-карта транспорта.
 *
 * Для `multipart` это поля формы (`fields`), а не `{ fields, files }`:
 * path-параметры и помеченные query-поля подмешиваются именно к ним.
 */
export type BindableFields<I> =
  I extends MultipartForm<infer F, any> ? Infer<F> : InferInput<I>;

/**
 * Вывод типа из схемы (любой Standard Schema) или примитива
 */
type InferSchemaType<S> = S extends 'binary'
  ? Buffer
  : S extends 'text'
    ? string
    : S extends Optional<Schema>
      ? Infer<S>
      : unknown;

export type AnyInput = Record<string, unknown>;
export type EmptyInput = Record<never, never>;
