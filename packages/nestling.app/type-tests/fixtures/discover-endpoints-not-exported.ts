/**
 * Фикстура: проход по единицам не публичен.
 *
 * Публичный вход в discovery один — `app.discover(args?)`: только у
 * декларации есть аргумент сборки. Ожидаемая диагностика говорит, что
 * `discoverEndpoints` пакет не экспортирует.
 */

import { discoverEndpoints } from '@nestlingjs/app';

export const discovered = discoverEndpoints([]);
