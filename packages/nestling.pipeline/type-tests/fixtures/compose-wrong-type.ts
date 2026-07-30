/**
 * Фикстура: поле во внешнем контексте есть, но несовместимого типа.
 *
 * До change #23 этот случай схлопывался в `MISSING_FIELDS: never` —
 * сообщение переставало называть причину. После — `missing` обязан
 * показать `requestId` с требуемым типом.
 */

import { compose, makePipeline, withRequestId } from '@nestling/pipeline';

const outer = makePipeline().pre(withRequestId());

const inner = makePipeline<{ requestId: number }>();

export const composed = compose(outer, inner);
