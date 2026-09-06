/**
 * Конфиг тестового прогона: объектом, а не через `process.env`.
 *
 * Форм у поля `config:` три, и живут они в `@nestling/app` (`ConfigInput`,
 * `toBindings`): их принимает и проверка состава, и тестовый корень.
 */

import type { ObjectSource } from '@nestling/app';
import { objectSource } from '@nestling/app';

/**
 * Именованный объектный источник конфигурации.
 *
 * Тонкая обёртка над `objectSource`: механика `watch`/`set` уже реализована
 * и покрыта тестами конфига. Ценность имени в другом — оно называет **шов**:
 * конфиг теста задаётся объектом, `process.env` не трогается, поэтому
 * тесты изолированы и параллелимы без дополнительного кода.
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
