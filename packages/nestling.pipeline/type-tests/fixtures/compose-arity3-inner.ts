/**
 * Фикстура: нарушение на третьем слое при арности 3.
 *
 * Первые два слоя совместимы; третий требует `tenantId`, которого не даёт
 * ни один из них. Диагностика обязана указывать на третий аргумент.
 */

import {
  compose,
  makePipeline,
  withIdentity,
  withRequestId,
} from '@nestling/pipeline';

import type { User } from '../support/fixture-kit.js';
import { authenticate } from '../support/fixture-kit.js';

const base = makePipeline().pre(withRequestId());

const authed = makePipeline<{ requestId: string }>().pre(
  withIdentity<User>(authenticate),
);

const tenantScoped = makePipeline<{ tenantId: string }>();

export const composed = compose(base, authed, tenantScoped);
