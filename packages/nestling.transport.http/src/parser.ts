import type { IncomingMessage } from 'node:http';
import { PassThrough, Readable } from 'node:stream';

import {
  ChunkTooLargeError,
  JsonParseError,
  MultipartFieldError,
  PayloadTooLargeError,
} from './errors.js';

import type { FilePart, UploadSpec } from '@nestling/pipeline';
import Busboy from 'busboy';

/**
 * Максимальный размер файла для буферизации в память (5MB).
 * Файлы меньше этого размера будут полностью загружены в память,
 * файлы больше - будут использовать streaming через PassThrough.
 */
const MAX_BUFFER_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Читает тело запроса в память с ранним прерыванием по лимиту.
 *
 * Байты считаются по мере чтения; при превышении `maxBytes` чтение
 * прерывается сразу — поток ставится на паузу (не уничтожается), тело не
 * буферизуется целиком. Пауза (а не `destroy`) позволяет транспорту доставить
 * ответ 413 до закрытия соединения. `maxBytes <= 0` отключает лимит.
 *
 * @throws PayloadTooLargeError при превышении лимита
 */
export function readBody(req: IncomingMessage, maxBytes = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const cleanup = (): void => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };

    const onData = (chunk: Buffer): void => {
      if (settled) {
        return;
      }
      size += chunk.length;
      if (maxBytes > 0 && size > maxBytes) {
        settled = true;
        cleanup();
        req.pause();
        reject(new PayloadTooLargeError(maxBytes));
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks));
    };

    const onError = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

/**
 * Разбирает JSON из уже прочитанных байтов тела.
 *
 * Отдельная функция нужна для `rawBody: true`: байты читаются один раз,
 * кладутся в стартовый контекст и разбираются из того же буфера — второго
 * чтения потока не бывает.
 *
 * @throws JsonParseError если байты не являются валидным JSON
 */
export function parseJsonBuffer(raw: Buffer): unknown {
  const body = raw.toString();
  if (!body) {
    return undefined;
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new JsonParseError({ cause: error });
  }
}

/**
 * Парсинг JSON body
 *
 * @param maxBytes - лимит размера тела (0 = без лимита)
 * @throws PayloadTooLargeError при превышении лимита
 * @throws JsonParseError если тело не является валидным JSON
 */
export async function parseJson(
  req: IncomingMessage,
  maxBytes = 0,
): Promise<unknown> {
  return parseJsonBuffer(await readBody(req, maxBytes));
}

/**
 * Парсинг raw body как Buffer
 *
 * @param maxBytes - лимит размера тела (0 = без лимита)
 * @throws PayloadTooLargeError при превышении лимита
 */
export async function parseRaw(
  req: IncomingMessage,
  maxBytes = 0,
): Promise<Buffer> {
  return readBody(req, maxBytes);
}

/** Наблюдатель прочитанных байтов: транспорт кладёт их в `summary` */
export type BytesObserver = (bytes: number) => void;

/** Разбирает одну NDJSON-строку; битая строка — ошибка входа, а не пропуск */
function decodeNdjsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new JsonParseError({ cause: error });
  }
}

/**
 * Декодирует NDJSON-тело в поток значений.
 *
 * Валидации здесь **нет**: элементы валидирует ядро (`bindInputStream`) по
 * схеме-листу формы — иначе один концерн жил бы в двух местах и расходился
 * бы политикой `onInvalid`. Транспорт остаётся переводчиком байтов.
 *
 * Лимит длины строки сохраняется: незавершённая строка не должна расти
 * бесконечно.
 *
 * @throws ChunkTooLargeError строка длиннее `maxLineBytes`
 * @throws JsonParseError строка не является валидным JSON
 */
export async function* parseNdjson(
  req: IncomingMessage,
  maxLineBytes = 0,
  onBytes?: BytesObserver,
): AsyncIterableIterator<unknown> {
  let buffer = '';

  for await (const chunk of req) {
    const bytes = chunk as Buffer;
    onBytes?.(bytes.length);
    buffer += bytes.toString();

    const lines = buffer.split('\n');
    // Последняя строка может быть неполной — оставляем её в буфере
    buffer = lines.pop() ?? '';

    // Незавершённая строка не должна расти бесконечно (защита от DoS)
    if (maxLineBytes > 0 && buffer.length > maxLineBytes) {
      throw new ChunkTooLargeError(maxLineBytes);
    }

    for (const line of lines) {
      if (maxLineBytes > 0 && line.length > maxLineBytes) {
        throw new ChunkTooLargeError(maxLineBytes);
      }

      const trimmed = line.trim();
      if (trimmed) {
        yield decodeNdjsonLine(trimmed);
      }
    }
  }

  const tail = buffer.trim();
  if (tail) {
    yield decodeNdjsonLine(tail);
  }
}

/** Разобранный multipart: поля формы и файлы под именами объявленных полей */
export interface MultipartResult {
  fields: Record<string, unknown>;
  files: Record<string, FilePart | FilePart[]>;
}

/**
 * Собирает `FilePart` из потока busboy гибридно: маленький файл
 * буферизуется в память, большой уезжает в `PassThrough`.
 *
 * Лимит применяется **во время** чтения: превышение прерывает разбор
 * конкретного файла, не буферизуя его целиком.
 */
function readFilePart(
  field: string,
  stream: NodeJS.ReadableStream,
  info: { filename?: string; mimeType?: string },
  maxSize: number,
  onOversize: (limit: number) => void,
): Promise<FilePart> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const passThrough = new PassThrough();
    let size = 0;
    let buffering = true;
    let aborted = false;

    stream.on('data', (chunk: Buffer) => {
      if (aborted) {
        return;
      }

      size += chunk.length;
      if (maxSize > 0 && size > maxSize) {
        aborted = true;
        onOversize(maxSize);
        return;
      }

      if (buffering && size <= MAX_BUFFER_SIZE) {
        chunks.push(chunk);
        return;
      }

      if (buffering) {
        buffering = false;
        for (const buffered of chunks) {
          passThrough.write(buffered);
        }
        chunks.length = 0;
      }

      passThrough.write(chunk);
    });

    stream.on('end', () => {
      if (aborted) {
        return;
      }

      const part: FilePart = {
        field,
        filename: info.filename || 'unknown',
        mime: info.mimeType || 'application/octet-stream',
        stream: buffering
          ? Readable.from([Buffer.concat(chunks)])
          : (passThrough.end(), passThrough),
        size,
      };

      resolve(part);
    });

    stream.on('error', (error: Error) => {
      passThrough.destroy(error);
      reject(error);
    });
  });
}

/**
 * Разбирает multipart по **форме декларации**.
 *
 * Файлы приходят под именами объявленных полей; лимиты `maxSize` и `mime`
 * каждого поля применяются во время разбора. Незаявленное файловое поле и
 * второй файл в single-поле — ошибки входа, а не тихое игнорирование.
 *
 * @param specs - файловые поля формы (`multipart({ files })`)
 * @param defaultMaxSize - лимит поля без собственного `maxSize`
 */
export function parseMultipartForm(
  req: IncomingMessage,
  specs: Readonly<Record<string, UploadSpec>>,
  defaultMaxSize = 0,
): Promise<MultipartResult> {
  return new Promise((resolve, reject) => {
    const busboyInstance = Busboy({ headers: req.headers });
    const fields: Record<string, unknown> = {};
    const files: Record<string, FilePart | FilePart[]> = {};
    const pending: Promise<void>[] = [];
    let settled = false;

    /** Дренирует вход и отвечает отказом: соединение не должно зависать */
    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      req.unpipe(busboyInstance);
      req.resume();
      reject(error);
    };

    busboyInstance.on('field', (name, value) => {
      fields[name] = value;
    });

    busboyInstance.on('file', (field, stream, info) => {
      const spec = specs[field];

      if (!spec) {
        stream.resume();
        fail(
          new MultipartFieldError(
            `Unexpected file field '${field}'; declared file fields: ` +
              `${Object.keys(specs).join(', ') || '(none)'}`,
          ),
        );
        return;
      }

      if (spec.mime && !spec.mime.includes(info.mimeType)) {
        // Отказ до чтения тела файла
        stream.resume();
        fail(
          new MultipartFieldError(
            `File field '${field}' expects one of ${spec.mime.join(', ')}, ` +
              `got '${info.mimeType}'`,
          ),
        );
        return;
      }

      if (!spec.multiple && files[field] !== undefined) {
        stream.resume();
        fail(
          new MultipartFieldError(
            `File field '${field}' accepts a single file; declare ` +
              `upload({ multiple: true }) to accept several`,
          ),
        );
        return;
      }

      const maxSize = spec.maxSize ?? defaultMaxSize;

      pending.push(
        readFilePart(field, stream, info, maxSize, (limit) => {
          stream.resume();
          fail(new PayloadTooLargeError(limit));
        }).then((part) => {
          if (spec.multiple) {
            const bucket = (files[field] as FilePart[] | undefined) ?? [];
            bucket.push(part);
            files[field] = bucket;
          } else {
            files[field] = part;
          }
        }),
      );
    });

    busboyInstance.on('finish', () => {
      void Promise.all(pending)
        .then(() => {
          if (settled) {
            return;
          }
          settled = true;
          // Поля формы отдаются как есть: валидирует их схема `fields`
          // после подмешивания path-параметров и помеченных query-полей
          resolve({ fields, files });
        })
        .catch((error: Error) => fail(error));
    });

    busboyInstance.on('error', (error) =>
      fail(error instanceof Error ? error : new Error(String(error))),
    );

    req.pipe(busboyInstance);
  });
}

/** Все файлы разобранного multipart — для дренажа непрочитанных потоков */
export function collectFileParts(result: MultipartResult): FilePart[] {
  return Object.values(result.files).flatMap((entry) =>
    Array.isArray(entry) ? entry : [entry],
  );
}
