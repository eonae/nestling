/**
 * Фикстура: pre-юнит перезаписывает поле, уже присутствующее в input,
 * другим типом. Накопление input монотонно — перезапись запрещена.
 */

import { makePipeline } from '@nestlingjs/app';

import { addField } from '../support/fixture-kit.js';

export const pipeline = makePipeline()
  .pre(addField({ userId: 'abc' }))
  .pre(addField({ userId: 42 }));
