import type { IncomingMessage } from 'node:http';
import { PassThrough, Readable } from 'node:stream';

import {
  ChunkTooLargeError,
  JsonParseError,
  PayloadTooLargeError,
} from './errors.js';

import type { Optional, Schema } from '@common/misc';
import type { FilePart } from '@nestling/pipeline';
import { validateSync } from '@nestling/pipeline';
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

/**
 * Парсинг multipart/form-data через busboy.
 *
 * Использует hybrid подход:
 * - Файлы ≤ MAX_BUFFER_SIZE буферизуются в память (быстрый доступ, нет риска утечек)
 * - Файлы > MAX_BUFFER_SIZE используют PassThrough streaming (экономия памяти)
 *
 * Примечание: Busboy не может завершиться (событие 'finish') пока все streams
 * не будут прочитаны. Поэтому мы либо буферизуем файл целиком, либо pipe'им
 * в PassThrough, который позволяет busboy завершиться, а данные читать позже.
 */
export function parseMultipart(
  req: IncomingMessage,
  maxFileSize = 0,
): Promise<FilePart[]> {
  return new Promise((resolve, reject) => {
    const busboyInstance = Busboy({
      headers: req.headers,
      limits: maxFileSize > 0 ? { fileSize: maxFileSize } : undefined,
    });
    const files: FilePart[] = [];
    const filePromises: Promise<void>[] = [];

    busboyInstance.on('file', (fieldname, stream, info) => {
      const { filename, mimeType } = info;

      // Файл превысил limits.fileSize — busboy обрезает поток и эмитит 'limit'.
      // Отвечаем 413, дренируя оставшийся вход, чтобы соединение не зависло.
      stream.on('limit', () => {
        req.unpipe(busboyInstance);
        req.resume();
        reject(new PayloadTooLargeError(maxFileSize));
      });

      // Буферы для накопления данных (если файл маленький)
      const chunks: Buffer[] = [];
      let size = 0;
      let shouldBuffer = true; // Флаг: пытаемся ли буферизовать файл

      // PassThrough для больших файлов
      const passThrough = new PassThrough();

      // Создаем Promise для обработки stream
      const filePromise = new Promise<void>((resolveFile, rejectFile) => {
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;

          if (shouldBuffer) {
            // Пытаемся буферизовать в память
            if (size <= MAX_BUFFER_SIZE) {
              // Файл ещё помещается в лимит - продолжаем буферизацию
              chunks.push(chunk);
            } else {
              // Файл превысил лимит - переключаемся на streaming
              shouldBuffer = false;

              // Записываем уже накопленные chunks в PassThrough
              for (const bufferedChunk of chunks) {
                passThrough.write(bufferedChunk);
              }
              chunks.length = 0; // Освобождаем память от буфера

              // Записываем текущий chunk
              passThrough.write(chunk);
            }
          } else {
            // Уже в режиме streaming - просто передаем данные
            passThrough.write(chunk);
          }
        });

        stream.on('end', () => {
          if (shouldBuffer) {
            // Весь файл поместился в буфер - создаем Readable из буфера
            const buffer = Buffer.concat(chunks);
            const readable = Readable.from([buffer]);

            files.push({
              field: fieldname,
              filename: filename || 'unknown',
              mime: mimeType || 'application/octet-stream',
              stream: readable,
              size,
            });
          } else {
            // Файл был большой - используем PassThrough
            passThrough.end();

            files.push({
              field: fieldname,
              filename: filename || 'unknown',
              mime: mimeType || 'application/octet-stream',
              stream: passThrough,
              size,
            });
          }

          resolveFile();
        });

        stream.on('error', (error) => {
          passThrough.destroy(error);
          rejectFile(error);
        });
      });

      filePromises.push(filePromise);
    });

    busboyInstance.on('finish', async () => {
      try {
        // Ждем, пока все файлы будут обработаны
        await Promise.all(filePromises);
        resolve(files);
      } catch (error) {
        reject(error);
      }
    });

    busboyInstance.on('error', reject);

    req.pipe(busboyInstance);
  });
}

/**
 * Парсинг streaming данных как AsyncIterator
 * Поддерживает NDJSON формат (newline-delimited JSON)
 */
export function parseStream<T>(
  req: IncomingMessage,
  schema?: Optional<Schema>,
  maxLineBytes = 0,
): AsyncIterator<T> {
  async function* streamGenerator() {
    let buffer = '';

    for await (const chunk of req) {
      // Добавляем chunk в буфер
      buffer += chunk.toString();

      // Разбиваем буфер на строки
      const lines = buffer.split('\n');

      // Последняя строка может быть неполной, сохраняем её в буфере
      buffer = lines.pop() || '';

      // Незавершённая строка не должна расти бесконечно (защита от DoS):
      // если она уже превысила лимит до прихода '\n' — прерываем.
      if (maxLineBytes > 0 && buffer.length > maxLineBytes) {
        throw new ChunkTooLargeError(maxLineBytes);
      }

      // Обрабатываем все полные строки
      for (const line of lines) {
        // Полная строка тоже не должна превышать лимит
        if (maxLineBytes > 0 && line.length > maxLineBytes) {
          throw new ChunkTooLargeError(maxLineBytes);
        }

        const trimmedLine = line.trim();

        // Пропускаем пустые строки
        if (!trimmedLine) {
          continue;
        }

        if (schema) {
          // Парсим JSON строку
          const chunkData = JSON.parse(trimmedLine);

          // Валидируем через схему
          yield validateSync(
            schema,
            chunkData,
            'Stream chunk validation failed',
          ) as T;
        } else {
          // Без схемы возвращаем распарсенный JSON
          try {
            yield JSON.parse(trimmedLine) as T;
          } catch {
            // Если парсинг не удался, пропускаем строку
            continue;
          }
        }
      }
    }

    // Обрабатываем последнюю строку в буфере, если она есть
    if (buffer.trim()) {
      if (schema) {
        const chunkData = JSON.parse(buffer.trim());

        yield validateSync(
          schema,
          chunkData,
          'Stream chunk validation failed',
        ) as T;
      } else {
        try {
          yield JSON.parse(buffer.trim()) as T;
        } catch {
          // Игнорируем ошибки парсинга последней строки
        }
      }
    }
  }

  return streamGenerator();
}

/**
 * Парсинг multipart с полями формы и файлами.
 *
 * Использует hybrid подход (аналогично parseMultipart):
 * - Файлы ≤ MAX_BUFFER_SIZE буферизуются в память
 * - Файлы > MAX_BUFFER_SIZE используют PassThrough streaming
 *
 * Примечание: схема НЕ валидируется здесь, потому что валидация должна
 * происходить в transport.ts после merge с route.params
 */
export function parseWithFiles<T>(
  req: IncomingMessage,
  maxFileSize = 0,
): Promise<{ data: T; files: FilePart[] }> {
  return new Promise((resolve, reject) => {
    const busboyInstance = Busboy({
      headers: req.headers,
      limits: maxFileSize > 0 ? { fileSize: maxFileSize } : undefined,
    });
    const fields: Record<string, unknown> = {};
    const files: FilePart[] = [];
    const filePromises: Promise<void>[] = [];

    busboyInstance.on('field', (name, value) => {
      fields[name] = value;
    });

    busboyInstance.on('file', (fieldname, stream, info) => {
      const { filename, mimeType } = info;

      // Файл превысил limits.fileSize — busboy обрезает поток и эмитит 'limit'.
      // Отвечаем 413, дренируя оставшийся вход, чтобы соединение не зависло.
      stream.on('limit', () => {
        req.unpipe(busboyInstance);
        req.resume();
        reject(new PayloadTooLargeError(maxFileSize));
      });

      // Буферы для накопления данных (если файл маленький)
      const chunks: Buffer[] = [];
      let size = 0;
      let shouldBuffer = true; // Флаг: пытаемся ли буферизовать файл

      // PassThrough для больших файлов
      const passThrough = new PassThrough();

      // Создаем Promise для обработки stream
      const filePromise = new Promise<void>((resolveFile, rejectFile) => {
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;

          if (shouldBuffer) {
            // Пытаемся буферизовать в память
            if (size <= MAX_BUFFER_SIZE) {
              // Файл ещё помещается в лимит - продолжаем буферизацию
              chunks.push(chunk);
            } else {
              // Файл превысил лимит - переключаемся на streaming
              shouldBuffer = false;

              // Записываем уже накопленные chunks в PassThrough
              for (const bufferedChunk of chunks) {
                passThrough.write(bufferedChunk);
              }
              chunks.length = 0; // Освобождаем память от буфера

              // Записываем текущий chunk
              passThrough.write(chunk);
            }
          } else {
            // Уже в режиме streaming - просто передаем данные
            passThrough.write(chunk);
          }
        });

        stream.on('end', () => {
          if (shouldBuffer) {
            // Весь файл поместился в буфер - создаем Readable из буфера
            const buffer = Buffer.concat(chunks);
            const readable = Readable.from([buffer]);

            files.push({
              field: fieldname,
              filename: filename || 'unknown',
              mime: mimeType || 'application/octet-stream',
              stream: readable,
              size,
            });
          } else {
            // Файл был большой - используем PassThrough
            passThrough.end();

            files.push({
              field: fieldname,
              filename: filename || 'unknown',
              mime: mimeType || 'application/octet-stream',
              stream: passThrough,
              size,
            });
          }

          resolveFile();
        });

        stream.on('error', (error) => {
          passThrough.destroy(error);
          rejectFile(error);
        });
      });

      filePromises.push(filePromise);
    });

    busboyInstance.on('finish', async () => {
      try {
        // Ждем, пока все файлы будут обработаны
        await Promise.all(filePromises);

        // Возвращаем raw fields без валидации
        // Валидация будет выполнена в transport.ts после merge с route.params
        resolve({ data: fields as T, files });
      } catch (error) {
        reject(error);
      }
    });

    busboyInstance.on('error', reject);

    req.pipe(busboyInstance);
  });
}

/**
 * Парсинг только файлов без полей формы
 */
export function parseFilesOnly(
  req: IncomingMessage,
  maxFileSize = 0,
): Promise<FilePart[]> {
  return parseMultipart(req, maxFileSize);
}
