/**
 * Фикстура: слои переставлены местами.
 *
 * Правильный порядок — `compose(authed, authorized)`: `authed` кладёт
 * `identity`, которую требует `authorized`. В обратном порядке внешним
 * оказывается `authorized`, и требование `requestId` слоя `authed`
 * не покрыто.
 */

import { compose, makePipeline } from '@nestlingjs/app';

import type { User } from '../support/fixture-kit.js';
import { addField, needsIdentity, testUser } from '../support/fixture-kit.js';

const authed = makePipeline<{ requestId: string }>().pre(
  addField({ identity: testUser }),
);

const authorized = makePipeline<{ identity: User }>().pre(
  needsIdentity({ permissions: ['read'] }),
);

export const composed = compose(authorized, authed);
