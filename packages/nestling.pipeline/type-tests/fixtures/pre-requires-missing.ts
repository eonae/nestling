/**
 * Фикстура: pre-юнит требует поля, которого в накопленном input ещё нет
 * (`withPermissions` читает `identity`, а `withIdentity` не вызван).
 */

import { makePipeline, withPermissions } from '@nestling/pipeline';

import type { User } from '../support/fixture-kit.js';

export const pipeline = makePipeline().pre(
  withPermissions<string[], User>(() => ['read']),
);
