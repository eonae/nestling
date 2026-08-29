import { withTiming } from '../common/middleware';

import type { FilePart } from '@nestling/pipeline';
import { makePipeline, multipart, upload } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import z from 'zod';

const MiB = 1024 * 1024;

// POST /reports — поля формы и файл; путь до DI здесь не нужен
const ReportFields = z.object({
  title: z.string().min(1),
});

const UploadReportOutput = z.object({
  title: z.string(),
  filename: z.string(),
  mime: z.string(),
});

type ReportFields = z.infer<typeof ReportFields>;
type UploadReportOutput = z.infer<typeof UploadReportOutput>;

/**
 * Демонстрирует форму `multipart({ fields, files })`:
 * - поля формы валидируются схемой `fields`, файлы приходят под
 *   объявленными именами и типизированы (`upload()` без `multiple` — один
 *   `FilePart`);
 * - лимит и MIME-фильтр объявлены на самом поле и применяются **во время**
 *   разбора: файл сверх `maxSize` не буферизуется целиком ради того, чтобы
 *   потом быть отвергнутым (413), а чужой MIME отвергается до чтения тела
 *   (400);
 * - незаявленное файловое поле отвергается — форма закрыта.
 */
export const UploadReport = httpEndpoint({
  method: 'POST',
  path: '/reports',
  input: multipart({
    fields: ReportFields,
    files: {
      report: upload({ maxSize: 2 * MiB, mime: ['application/pdf'] }),
    },
  }),
  output: UploadReportOutput,
  pipeline: makePipeline().pre(withTiming),
  handle: async (payload: {
    fields: ReportFields;
    files: { report: FilePart };
  }): Promise<UploadReportOutput> => {
    // Размер и тип уже проверил транспорт — endpoint'у остаётся домен
    const { report } = payload.files;

    return {
      title: payload.fields.title,
      filename: report.filename,
      mime: report.mime,
    };
  },
});
