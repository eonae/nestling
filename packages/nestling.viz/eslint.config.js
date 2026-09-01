// TODO: Move to package

import js from '@eslint/js';
import nestling from '@nestling/eslint-plugin';
import pluginRouter from '@tanstack/eslint-plugin-router';
import prettierPlugin from 'eslint-plugin-prettier/recommended';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import unusedImportsPlugin from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * У пакета свой набор правил: это React-приложение, а не библиотека на
 * Node. Общая база из `.config/eslint.config.js` сюда не подходит, но
 * игноры и привязка к пакетному `tsconfig.json` те же, что у остальных.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/*.d.ts',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'unused-imports': unusedImportsPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          vars: 'all',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  ...pluginRouter.configs['flat/recommended'],
  {
    plugins: { '@nestling': nestling },
    rules: {
      /*
       * Граница модуля — соглашение репозитория, и React-приложение под
       * `src/static` из него не выведено. Правило продублировано сюда,
       * потому что общая база в этот пакет не подходит целиком.
       *
       * Видит оно здесь не всё: импорты через алиасы (`@core/…`, `@types/…`)
       * относительными не являются, и правило про них молчит.
       */
      '@nestling/import-through-barrel': 'warn',
    },
  },
  prettierPlugin,
);
