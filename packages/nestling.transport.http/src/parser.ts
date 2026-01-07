import type { IncomingMessage } from 'node:http';

import type { Optional } from '@common/misc';
import type { FilePart } from '@nestling/pipeline';
import { parsePayload, SchemaValidationError } from '@nestling/pipeline';
import Busboy from 'busboy';
import type { Schema, z, ZodError } from 'zod';

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
 * Парсинг multipart/form-data через busboy
 */
export function parseMultipart(req: IncomingMessage): Promise<FilePart[]> {
  return new Promise((resolve, reject) => {
    const busboyInstance = Busboy({ headers: req.headers });
    const files: FilePart[] = [];

    busboyInstance.on('file', (fieldname, stream, info) => {
      const { filename, mimeType } = info;
      files.push({
        field: fieldname,
        filename: filename || 'unknown',
        mime: mimeType || 'application/octet-stream',
        stream,
      });
    });

    busboyInstance.on('finish', () => {
      resolve(files);
    });

    busboyInstance.on('error', reject);

    req.pipe(busboyInstance);
  });
}

/**
 * Парсинг streaming данных как AsyncIterator
 */
export function parseStream<T>(
  req: IncomingMessage,
  schema?: Optional<Schema>,
): AsyncIterator<T> {
  async function* streamGenerator() {
    for await (const chunk of req) {
      if (schema) {
        // Если есть схема, парсим каждый chunk напрямую через схему
        try {
          // Chunk может быть Buffer, нужно преобразовать в объект для валидации
          const chunkData =
            Buffer.isBuffer(chunk) || typeof chunk === 'string'
              ? JSON.parse(chunk.toString())
              : chunk;

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
        // Иначе возвращаем chunk как есть
        yield chunk as T;
      }
    }
  }

  return streamGenerator();
}

/**
 * Парсинг multipart с полями формы и файлами
 */
export function parseWithFiles<T>(
  req: IncomingMessage,
  schema: Optional<Schema>,
): Promise<{ data: T; files: FilePart[] }> {
  return new Promise((resolve, reject) => {
    const busboyInstance = Busboy({ headers: req.headers });
    const fields: Record<string, unknown> = {};
    const files: FilePart[] = [];

    busboyInstance.on('field', (name, value) => {
      fields[name] = value;
    });

    busboyInstance.on('file', (fieldname, stream, info) => {
      const { filename, mimeType } = info;
      files.push({
        field: fieldname,
        filename: filename || 'unknown',
        mime: mimeType || 'application/octet-stream',
        stream,
      });
    });

    busboyInstance.on('finish', () => {
      const data = parsePayload(schema as z.ZodTypeAny, {
        payload: fields,
        metadata: {},
      }) as T;
      resolve({ data, files });
    });

    busboyInstance.on('error', reject);

    req.pipe(busboyInstance);
  });
}

/**
 * Парсинг только файлов без полей формы
 */
export function parseFilesOnly(req: IncomingMessage): Promise<FilePart[]> {
  return parseMultipart(req);
}
