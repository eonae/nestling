/**
 * Фикстура: внутренний слой требует поля, которого нет ни в одном внешнем.
 *
 * Ожидаемая диагностика называет `identity` вместе с его типом.
 */

import { compose, makePipeline, withRequestId } from '@nestling/pipeline';

import type { User } from '../support/fixture-kit.js';

const outer = makePipeline().pre(withRequestId());

const inner = makePipeline<{ identity: User; requestId: string }>();

export const composed = compose(outer, inner);
