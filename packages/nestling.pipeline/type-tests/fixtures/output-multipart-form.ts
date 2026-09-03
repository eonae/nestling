/**
 * Фикстура: `multipart` в слоте `output`.
 *
 * Форма input-only по построению — у ответа нет полей формы. Рантайм
 * дублирует проверку для JS-потребителей, но автор на TypeScript обязан
 * увидеть её в точке декларации.
 */

import { makePipeline, multipart, Ok, upload } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

export const BuildReport = httpEndpoint({
  method: 'POST',
  path: '/reports',
  output: multipart({ files: { report: upload() } }),
  pipeline: makePipeline(),
  handler: async () => new Ok(undefined),
});
