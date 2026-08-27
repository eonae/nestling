/**
 * Фикстура: слои переставлены местами.
 *
 * Правильный порядок — `compose(authed, authorized)`: `authed` кладёт
 * `identity`, которую требует `authorized`. В обратном порядке внешним
 * оказывается `authorized`, и требование `requestId` слоя `authed`
 * не покрыто.
 */

import {
  compose,
  makePipeline,
  withIdentity,
  withPermissions,
} from '@nestling/pipeline';

import type { User } from '../support/fixture-kit.js';
import { authenticate } from '../support/fixture-kit.js';

const authed = makePipeline<{ requestId: string }>().pre(
  withIdentity<User>(authenticate),
);

const authorized = makePipeline<{ identity: User }>().pre(
  withPermissions<string[], User>(() => ['read']),
);

export const composed = compose(authorized, authed);
