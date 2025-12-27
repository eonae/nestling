import { fixupPluginRules } from '@eslint/compat';
import eslint from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-plugin-prettier/recommended';
import sortImports from 'eslint-plugin-simple-import-sort';
import unicorn from 'eslint-plugin-unicorn';
import tslint from 'typescript-eslint';

const plugins = {
  unicorn,
  sortImports,
  prettier,
  import: fixupPluginRules(importPlugin),
  eslint,
  tslint,
};

export default [
  plugins.eslint.configs.recommended,
  ...plugins.tslint.configs.strict.map((c) => ({ files: ['**/*.ts'], ...c })),
  ...plugins.tslint.configs.stylistic.map((c) => ({
    files: ['**/*.ts'],
    ...c,
  })),
  plugins.import.flatConfigs.typescript,
  plugins.unicorn.configs['flat/recommended'],
  {
    rules: {
      // Отключаем правило, т.к. оно не работает с ESLint 9
      'unicorn/expiring-todo-comments': 'off',
    },
  },
  plugins.prettier,
  {
    plugins: {
      'simple-import-sort': plugins.sortImports,
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'script',
      parserOptions: {
        project: './tsconfig.lint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // TODO: По крайней мере пока
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/member-ordering': 'off',
      'no-tabs': 'error',
      '@typescript-eslint/no-extraneous-class': [
        'error',
        {
          allowWithDecorator: true,
        },
      ],
    },
  },
  {
    rules: {
      // Конфликтует с преттиером
      // 'lines-around-comment': 'error',
      'no-case-declarations': 'off',
      'sort-keys': 'off',
      'no-empty-pattern': 'off',
      'import/no-cycle': 'error',
      'import/first': 'error',
      'import/newline-after-import': 'error',
      'import/no-duplicates': 'error',
      'unicorn/switch-case-braces': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-object-as-default-parameter': 'off',
      'unicorn/no-negated-condition': 'off',
      'unicorn/no-array-reduce': 'off', // Хотя в этом что-то есть!
      'unicorn/prefer-event-target': 'off',
      'unicorn/no-array-callback-reference': 'off',
      'unicorn/import-style': 'off',
      'unicorn/prefer-module': 'off', // Надо только для mjs оставить
      'unicorn/prefer-top-level-await': 'off', // Надо только для mjs оставить
      'unicorn/prefer-regexp-test': 'off', // Агрится на любой метод match, а не только на regexf
      'unicorn/no-array-method-this-argument': 'off', // Агрится на любой метод find, а не только на find у массива
      'unicorn/filename-case': 'error',
      'no-console': 'error',
      'sort-imports': 'off',
      curly: ['error', 'all'],
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            // Node.js builtins. You could also generate this regex if you use a `.js` config.
            // For example: `^(${require("module").builtinModules.join("|")})(/|$)`
            ['^(node)(:.*|$)'],
            // Side effect imports.
            [String.raw`^\u0000`],
            // Parent imports. Put `..` last.
            [String.raw`^\.\.(?!/?$)`, String.raw`^\.\./?$`],
            // Other relative imports. Put same-folder imports and `.` last.
            [
              String.raw`^\./(?=.*/)(?!/?$)`,
              String.raw`^\.(?!/?$)`,
              String.raw`^\./?$`,
            ],
          ],
        },
      ],
      ////// DEBUG
      // 'unicorn/prefer-node-protocol': 'off',
      // 'simple-import-sort/imports': 'off',
    },
  },
];
