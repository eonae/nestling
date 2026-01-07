/* eslint-disable no-console */
import type { FilePart, ResponseContext } from '@nestling/pipeline';
import { Endpoint, withFiles } from '@nestling/pipeline';
import { z } from 'zod';

// POST /upload - загрузка файла с метаданными
const UploadFileMetadata = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  category: z.enum(['image', 'video', 'document']),
});

const UploadFileOutput = z.object({
  message: z.string(),
  files: z.array(
    z.object({
      filename: z.string(),
      size: z.number().optional(),
      mime: z.string(),
    }),
  ),
  metadata: z.object({
    title: z.string(),
    description: z.string().optional(),
    category: z.string(),
  }),
});

type UploadFileMetadata = z.infer<typeof UploadFileMetadata>;
type UploadFileOutput = z.infer<typeof UploadFileOutput>;

/**
 * Handler для загрузки файлов с метаданными
 * Демонстрирует использование withFiles() модификатора
 */
@Endpoint({
  transport: 'http',
  pattern: 'POST /upload',
  input: withFiles(UploadFileMetadata),
  output: UploadFileOutput,
})
export class UploadFileEndpoint {
  async handle(payload: {
    data: UploadFileMetadata;
    files: FilePart[];
  }): Promise<ResponseContext<UploadFileOutput>> {
    const { data, files } = payload;

    // В реальном приложении здесь была бы обработка потоков файлов
    // Например: await pipeline(file.stream, fs.createWriteStream(`/uploads/${file.filename}`))

    console.log(`Uploading ${files.length} file(s) with metadata:`, data);

    return {
      status: 201,
      value: {
        message: 'Files uploaded successfully',
        files: files.map((f) => ({
          filename: f.filename,
          size: undefined, // В реальности здесь был бы размер
          mime: f.mime,
        })),
        metadata: data,
      },
      meta: {},
    };
  }
}
