import base from '../../.config/eslint.config.js';

import nestling from '@nestling/eslint-plugin';

/**
 * Догфудинг editor-фидбека: правило `endpoint-has-layer` подсказывает про
 * тот же инвариант, который `main.ts` объявляет политикой.
 *
 * Уровень `warn`, а не `error`, — сознательно: правило синтаксическое и
 * принципиально неполное, гарантию даёт policy-check на собранном графе.
 * Настройка живёт в конфиге примера, а не в общем `.config/`, потому что
 * имя слоя (`observability`) — свойство этого приложения, а не репозитория.
 */
export default [
  ...base,
  {
    files: ['src/**/*.ts'],
    plugins: { '@nestling': nestling },
    rules: {
      '@nestling/endpoint-has-layer': [
        'warn',
        { layer: 'observability', constructorName: 'httpEndpoint' },
      ],
    },
  },
];
