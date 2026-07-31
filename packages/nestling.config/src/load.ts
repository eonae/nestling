/**
 * Примордиальное чтение секции — фаза 0 (BOOTSTRAP).
 *
 * Единственное пред-сборочное чтение конфига: `select` вычисляется до
 * построения контейнера, а значит до читалки и до привязанных источников.
 * Поэтому `load` знает ровно один источник — `process.env`.
 */

import type { ConfigSectionToken } from './declaration.js';
import type { ConfigFieldFailure } from './errors.js';
import { ConfigValidationError } from './errors.js';
import { lookupSection } from './registry.js';

import { SchemaValidationError, validateSync } from '@common/misc';

/**
 * Читает секцию из `process.env` синхронно, без контейнера.
 *
 * Привязанные источники в чтении **не участвуют**: их поднимает читалка
 * внутри графа, которого на фазе 0 ещё нет. Валидация та же, что у
 * проекции из контейнера: независимая по полям, все отказы — в одну
 * ошибку, fail-fast.
 *
 * @param section - Токен секции, объявленной `makeConfig`
 * @returns Замороженные значения секции
 * @throws {ConfigValidationError} Если хотя бы одно поле невалидно
 *
 * @example
 * ```typescript
 * const RootConfig = makeConfig('app', { features: z.string().default('all') });
 *
 * const cfg = load(RootConfig);
 * await assemble({ features: [...], select: cfg.features }).run();
 * ```
 */
export const load = <Values>(
  section: ConfigSectionToken<Values, string>,
): Values => {
  // Префикс лежит на keys-хэндле токена — том же значении, которым секция
  // привязывается к источникам
  const prefix = section.keys.prefix;
  const declaration = lookupSection(prefix);

  if (!declaration) {
    throw new Error(
      `Config section '${prefix}' is not declared. Declare it with makeConfig('${prefix}', { … }) and make sure the module that declares it is imported.`,
    );
  }

  const values: Record<string, unknown> = {};
  const failures: ConfigFieldFailure[] = [];

  for (const field of declaration.fields) {
    try {
      values[field.name] = validateSync(
        field.schema,
        process.env[field.key],
        `Config key ${field.key} is invalid`,
      );
    } catch (error) {
      if (!(error instanceof SchemaValidationError)) {
        throw error;
      }

      failures.push({
        field: field.name,
        key: field.key,
        issues: error.issues,
      });
    }
  }

  if (failures.length > 0) {
    throw new ConfigValidationError(prefix, failures, ['process.env']);
  }

  return Object.freeze(values) as Values;
};
