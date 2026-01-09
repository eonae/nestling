import type { IncomingMessage } from 'node:http';
import { PassThrough, Readable } from 'node:stream';

import type { Optional, Schema } from '@common/misc';
import type { FilePart } from '@nestling/pipeline';
import { SchemaValidationError } from '@nestling/pipeline';
import Busboy from 'busboy';
import type { z, ZodError } from 'zod';

/**
 * Максимальный размер файла для буферизации в память (5MB).
 * Файлы меньше этого размера будут полностью загружены в память,
 * файлы больше - будут использовать streaming через PassThrough.
 */
const MAX_BUFFER_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Парсинг JSON body
 */
export async function parseJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString();
  if (!body) {
    return undefined;
  }
  return JSON.parse(body);
}

/**
 * Парсинг raw body как Buffer
 */
export async function parseRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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
export function parseMultipart(req: IncomingMessage): Promise<FilePart[]> {
  return new Promise((resolve, reject) => {
    const busboyInstance = Busboy({ headers: req.headers });
    const files: FilePart[] = [];
    const filePromises: Promise<void>[] = [];

    busboyInstance.on('file', (fieldname, stream, info) => {
      const { filename, mimeType } = info;

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

        stream.on('fail', (error) => {
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

    busboyInstance.on('fail', reject);

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

      // Обрабатываем все полные строки
      for (const line of lines) {
        const trimmedLine = line.trim();

        // Пропускаем пустые строки
        if (!trimmedLine) {
          continue;
        }

        if (schema) {
          try {
            // Парсим JSON строку
            const chunkData = JSON.parse(trimmedLine);

            // Валидируем через схему
            const parsed = (schema as z.ZodTypeAny).parse(chunkData);
            yield parsed as T;
          } catch (error) {
            if (error && typeof error === 'object' && 'issues' in error) {
              throw new SchemaValidationError(
                'Stream chunk validation failed',
                error as ZodError,
              );
            }
            throw error;
          }
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
        try {
          const chunkData = JSON.parse(buffer.trim());
          const parsed = schema.parse(chunkData);
          yield parsed as T;
        } catch (error) {
          if (error && typeof error === 'object' && 'issues' in error) {
            throw new SchemaValidationError(
              'Stream chunk validation failed',
              error as ZodError,
            );
          }
          throw error;
        }
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
): Promise<{ data: T; files: FilePart[] }> {
  return new Promise((resolve, reject) => {
    const busboyInstance = Busboy({ headers: req.headers });
    const fields: Record<string, unknown> = {};
    const files: FilePart[] = [];
    const filePromises: Promise<void>[] = [];

    busboyInstance.on('field', (name, value) => {
      fields[name] = value;
    });

    busboyInstance.on('file', (fieldname, stream, info) => {
      const { filename, mimeType } = info;

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

        stream.on('fail', (error) => {
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

    busboyInstance.on('fail', reject);

    req.pipe(busboyInstance);
  });
}

/**
 * Парсинг только файлов без полей формы
 */
export function parseFilesOnly(req: IncomingMessage): Promise<FilePart[]> {
  return parseMultipart(req);
}
