import type {
  AnyMultipartForm,
  AnyOutcomesForm,
  AnyStreamForm,
  IOPrimitive,
  MultipartForm,
  NoneForm,
  OutcomeMap,
  OutcomesForm,
  StreamForm,
  StreamKind,
  UploadSpec,
} from './forms.js';

import type { Infer, Optional, Schema } from '@nestlingjs/common.misc';

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
 * Конфигурация `output`: форма io или развилка исходов.
 *
 * `multipart` и `none()` входят в объединение только ради диагностики: так
 * ошибка приходит читаемым литералом из `ValidateOutputForm`, а не отказом
 * сопоставления с границей тип-параметра.
 */
export type AnyOutput<T extends Optional<Schema> = Optional<Schema>> =
  | T // Schema
  | IOPrimitive // 'binary' | 'text'
  | AnyStreamForm // stream(T) / events(T)
  | AnyOutcomesForm // outputs({ ok: User, accepted: Job })
  | NoneForm // отвергается ValidateOutputForm
  | AnyMultipartForm; // отвергается ValidateOutputForm

/**
 * Файл в multipart-запросе. Часть типа payload, который выводится из формы
 * `multipart(...)`.
 *
 * Поле `stream` объявлено как `AsyncIterable<Uint8Array>`, а не `Readable`
 * из `node:stream`: пакет должен компилироваться без типов Node.
 * `Readable` этому типу удовлетворяет.
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
 * Потоковая форма даёт стандартный `AsyncIterableIterator`; собственного
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
 * Значение одной ветки развилки: `none()` тела не несёт.
 */
export type OutcomeValue<F> = F extends NoneForm ? null : InferOutput<F>;

/** Значения всех веток развилки одним объединением */
export type OutcomeValues<M extends OutcomeMap> = {
  [K in keyof M]: OutcomeValue<M[K]>;
}[keyof M];

/**
 * Выводит тип возврата хендлера из формы `output`.
 */
export type InferOutput<O> =
  // Развилка исходов: значение любой из веток
  O extends OutcomesForm<infer M>
    ? OutcomeValues<M>
    : // Примитивы
      O extends 'binary'
      ? Buffer
      : O extends 'text'
        ? string
        : // Потоковые формы: оба конца зафиксированы схемой (см.
          // ValidateOutputForm), поэтому тип элемента — тип при сериализации
          O extends StreamForm<any, infer TItem, StreamKind>
          ? AsyncIterable<TItem>
          : // Multipart в выходе нелегален — значения у него нет
            O extends AnyMultipartForm
            ? never
            : // Формы `output` нет: значения у ответа нет, и хендлер
              // компилируется без `return`
              O extends undefined
              ? /* eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- `void` здесь и есть ответ «значения нет»: из него `OutputSync` собирает тип результата хендлера */
                void
              : // Схема (по умолчанию)
                InferSchemaType<O>;

/**
 * Поля, которые можно пометить в `bind`.
 *
 * Для `multipart` это поля формы (`fields`), а не `{ fields, files }`:
 * path-параметры и query-поля добавляются именно к ним.
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

/**
 * Тип элемента потоковой формы — им типизируются колбэки секции `sse`.
 *
 * Объявлен здесь, а не в транспорте: секция `sse` есть и в
 * HTTP-декларации, и в секции `http` операции.
 */
export type InferStreamItem<O> =
  O extends StreamForm<any, infer TItem, any> ? TItem : never;

export type AnyInput = Record<string, unknown>;
export type EmptyInput = Record<never, never>;
