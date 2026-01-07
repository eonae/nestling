import type { IncomingMessage } from 'node:http';

import type { FilePart } from '@nestling/pipeline';
import Busboy from 'busboy';

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
