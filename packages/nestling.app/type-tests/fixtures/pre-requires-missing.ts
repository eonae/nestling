/**
 * Фикстура: pre-юнит требует поля, которого в накопленном input ещё нет
 * (`needsIdentity` читает `identity`, а её никто не добавил).
 */

import { makePipeline } from '@nestlingjs/app';

import { needsIdentity } from '../support/fixture-kit.js';

export const pipeline = makePipeline().pre(
  needsIdentity({ permissions: ['read'] }),
);
