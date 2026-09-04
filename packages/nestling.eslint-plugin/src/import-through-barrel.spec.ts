/**
 * `import-through-barrel`: где проходит граница модуля.
 *
 * Правило читает файловую систему, поэтому фикстуры настоящие — дерево во
 * временной папке. Подделать его строкой нельзя: проверяемый факт в том и
 * состоит, лежит ли рядом с целью баррель и реэкспортирует ли он её.
 *
 * Валидные кейсы описывают три разрешённые формы — сосед, предок и сам
 * баррель, — и они же объясняют, почему правило не воюет с `import/no-cycle`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { importThroughBarrel } from './import-through-barrel.js';

import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';

/**
 * Дерево пакета: `providers` и `graph` — модули с баррелем, `common.ts` —
 * плоский сосед бареля пакета, `internal.ts` — лист, который барель
 * `providers` намеренно не реэкспортирует.
 */
const root = mkdtempSync(join(tmpdir(), 'import-through-barrel-'));
const source = join(root, 'pkg', 'src');

const write = (path: string, text: string): void => {
  const full = join(source, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text, 'utf8');
};

mkdirSync(source, { recursive: true });

// Корень пакета: на нём правило прекращает подъём за границей модуля
writeFileSync(join(root, 'pkg', 'package.json'), '{}', 'utf8');

write(
  'index.ts',
  "export * from './providers/index.js';\nexport * from './common.js';\n",
);
write('common.ts', 'export const shared = 1;\n');
write('consumer.ts', 'export const consumer = 1;\n');
write('tokens.ts', 'export const tokens = 1;\n');
write('providers/index.ts', "export { family } from './token-family.js';\n");
write('providers/token-family.ts', 'export const family = 1;\n');
write('providers/internal.ts', 'export const internal = 1;\n');
write('providers/sibling.ts', 'export const sibling = 1;\n');
write('graph/index.ts', "export * from './deep/index.js';\n");
write('graph/deep/index.ts', "export * from './leaf.js';\n");
write('graph/deep/leaf.ts', 'export const leaf = 1;\n');

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const file = (path: string): string => join(source, path);

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser as never,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('import-through-barrel', importThroughBarrel, {
  valid: [
    {
      name: 'сосед в своей папке — внутреннее устройство модуля',
      filename: file('providers/token-family.ts'),
      code: "import { sibling } from './sibling.js';",
    },
    {
      name: 'импорт вверх, к предку: его границу импортёр не пересекает',
      filename: file('providers/token-family.ts'),
      code: "import { shared } from '../common.js';",
    },
    {
      name: 'импорт папки — обращение к её баррелю',
      filename: file('consumer.ts'),
      code: "import { family } from './providers';",
    },
    {
      name: 'на баррель указали файлом — та же дверь',
      filename: file('consumer.ts'),
      code: "import { family } from './providers/index.js';",
    },
    {
      name: 'сам баррель собирает поверхность из внутренностей',
      filename: file('index.ts'),
      code: "export { family } from './providers/token-family.js';",
    },
    {
      name: 'точка входа пакета: entrypoints',
      filename: file('tokens.ts'),
      code: "export { family } from './providers/token-family.js';",
      options: [{ entrypoints: ['**/tokens.ts'] }],
    },
    {
      name: 'разрешённая цель: allow',
      filename: file('consumer.ts'),
      code: "import { family } from './providers/token-family.js';",
      options: [{ allow: ['**/providers/token-family.ts'] }],
    },
    {
      name: 'типовой импорт при allowTypeImports',
      filename: file('consumer.ts'),
      code: "import type { family } from './providers/token-family.js';",
      options: [{ allowTypeImports: true }],
    },
    {
      name: 'приватный лист при onMissingReexport: allow',
      filename: file('consumer.ts'),
      code: "import { internal } from './providers/internal.js';",
      options: [{ onMissingReexport: 'allow' }],
    },
    {
      name: 'межпакетный импорт — его границу стережёт поле exports',
      filename: file('consumer.ts'),
      code: "import { assemble } from '@nestling/app';",
    },
    {
      name: 'спецификатор не резолвится — правило молчит',
      filename: file('consumer.ts'),
      code: "import { missing } from './providers/nowhere.js';",
    },
    {
      name: 'вычисляемый путь непрозрачен',
      filename: file('consumer.ts'),
      code: "const name = 'token-family';\nawait import(`./providers/${name}.js`);",
    },
    {
      name: 'динамический импорт при checkDynamicImports: false',
      filename: file('consumer.ts'),
      code: "await import('./providers/token-family.js');",
      options: [{ checkDynamicImports: false }],
    },
  ],

  invalid: [
    {
      name: 'вход внутрь модуля мимо бареля',
      filename: file('consumer.ts'),
      code: "import { family } from './providers/token-family.js';",
      errors: [{ messageId: 'crossesBoundary' }],
    },
    {
      name: 'типовой импорт границу пересекает так же',
      filename: file('consumer.ts'),
      code: "import type { family } from './providers/token-family.js';",
      errors: [{ messageId: 'crossesBoundary' }],
    },
    {
      name: 'реэкспорт — тот же импорт',
      filename: file('consumer.ts'),
      code: "export { family } from './providers/token-family.js';",
      errors: [{ messageId: 'crossesBoundary' }],
    },
    {
      name: 'реэкспорт всего',
      filename: file('consumer.ts'),
      code: "export * from './providers/token-family.js';",
      errors: [{ messageId: 'crossesBoundary' }],
    },
    {
      name: 'динамический импорт с литеральным путём',
      filename: file('consumer.ts'),
      code: "await import('./providers/token-family.js');",
      errors: [{ messageId: 'crossesBoundary' }],
    },
    {
      name: 'лист, не реэкспортированный баррелем, приватен',
      filename: file('consumer.ts'),
      code: "import { internal } from './providers/internal.js';",
      errors: [{ messageId: 'privateModule' }],
    },
    {
      name: 'граница берётся внешняя: вложенный баррель чужаку не дверь',
      filename: file('consumer.ts'),
      code: "import { leaf } from './graph/deep/leaf.js';",
      errors: [
        {
          messageId: 'crossesBoundary',
          data: {
            module: file('graph'),
            barrel: file('graph/index.ts'),
            target: file('graph/deep/leaf.ts'),
          },
        },
      ],
    },
    {
      name: 'вход внутрь соседнего модуля из модуля рядом',
      filename: file('graph/deep/leaf.ts'),
      code: "import { internal } from '../../providers/internal.js';",
      errors: [{ messageId: 'privateModule' }],
    },
  ],
});
