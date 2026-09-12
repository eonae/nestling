import { createEslintConfig } from '../../.config/eslint.config.js';

import nestling from '@nestlingjs/eslint-plugin';

/**
 * Правило `endpoint-has-layer` подсказывает в редакторе про тот же
 * инвариант, который `app.ts` объявляет политикой сборки. Уровень `warn`:
 * правило синтаксическое, гарантию даёт проверка политики на собранном
 * графе.
 */
export default [
  ...createEslintConfig(import.meta.url, { published: false }),
  {
    files: ['src/**/*.ts'],
    plugins: { '@nestlingjs': nestling },
    rules: {
      '@nestlingjs/endpoint-has-layer': [
        'warn',
        { layer: 'observability', constructorName: 'httpEndpoint' },
      ],
    },
  },
];
