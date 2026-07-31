/**
 * Конфиг тестового прогона: объектом, а не через `process.env`.
 */

import type {
  ConfigBinding,
  ConfigSource,
  ObjectSource,
} from '@nestling/config';
import { objectSource } from '@nestling/config';

/**
 * Форма поля `config:` тестового корня.
 *
 * Три формы вместо одной: голый источник (сахар для `[[source, '*']]`),
 * одна привязка и список привязок. В боевом `assemble` сахара нет — там
 * привязка есть акт с приоритетами, и умолчание «весь источник» неуместно.
 */
export type TestConfig =
  | ConfigSource
  | ConfigBinding
  | readonly ConfigBinding[];

/**
 * Именованный объектный источник конфигурации.
 *
 * Тонкая обёртка над `objectSource`: механика `watch`/`set` уже реализована
 * и покрыта тестами конфига. Ценность имени в другом — оно называет **шов**:
 * конфиг теста задаётся объектом, `process.env` не трогается, поэтому
 * тесты изолированы и параллелимы бесплатно.
 *
 * @param record - Значения ключей; ключи те же, что читал бы источник env
 * @returns Источник с `get`/`watch`/`set`/`assign`
 *
 * @example
 * ```typescript
 * const src = vars({ USERS_PAGE_SIZE: '10' });
 * await using app = await assembleTest({ features: [UsersFeature], config: src });
 *
 * src.set('USERS_PAGE_SIZE', '20'); // reloadable-секция перепроецируется
 * ```
 */
export const vars = (
  record: Readonly<Record<string, unknown>> = {},
): ObjectSource => objectSource(record, 'vars');

/** Значение похоже на привязку `[источник, таргет]`? */
const isBinding = (value: unknown): value is ConfigBinding =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof (value[0] as ConfigSource | undefined)?.get === 'function';

/**
 * Приводит три формы `config:` к плоскому списку привязок.
 *
 * @internal
 */
export const toBindings = (config?: TestConfig): ConfigBinding[] => {
  if (!config) {
    return [];
  }

  if (isBinding(config)) {
    return [config];
  }

  if (Array.isArray(config)) {
    return [...(config as readonly ConfigBinding[])];
  }

  // Голый источник: тестовому корню «весь источник» — единственное
  // осмысленное умолчание
  return [[config as ConfigSource, '*']];
};
