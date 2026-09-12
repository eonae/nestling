import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixupPluginRules } from '@eslint/compat';
import eslint from '@eslint/js';
import nestling from '@nestlingjs/eslint-plugin';
import globals from 'globals';
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

/**
 * Селекторы esquery для кириллицы в значении строки.
 *
 * Правило смотрит на строковый литерал и на кусок шаблонной строки, то
 * есть на значение, а не на текст файла: комментарий и JSDoc остаются
 * русскими. Сравнение с регулярным выражением esquery применяет только к
 * строковому значению, поэтому число и регулярное выражение под селектор
 * не попадают.
 */
const cyrillicStringSelectors = [
  {
    selector: String.raw`Literal[value=/[\u0400-\u04FF]/]`,
    message:
      'Строка, которую процесс отдаёт наружу, пишется по-английски: ' +
      'сообщения ошибок, логи, причины `hidden` и `detached`, `summary` и ' +
      '`description` операций. Правило — capability ' +
      '`runtime-message-language`. Русскими остаются README, JSDoc, ' +
      'комментарии и спеки.',
  },
  {
    selector: String.raw`TemplateElement[value.raw=/[\u0400-\u04FF]/]`,
    message:
      'Шаблонная строка, которую процесс отдаёт наружу, пишется ' +
      'по-английски. Правило — capability `runtime-message-language`.',
  },
];

/**
 * Базовая конфигурация ESLint для пакета.
 *
 * Пакет передаёт `import.meta.url`, и правила с типами получают его
 * собственный `tsconfig.json`. Так линтер видит ровно тот проект, что и
 * редактор: `customConditions` пакета работают, а программа не раздувается
 * до всей монорепы.
 *
 * Второй аргумент объявляет факт о пакете, из которого следует правило.
 * `published: false` выключает проверку языка строк — её выключают
 * примеры: их `summary` и `description` цитируются главами русского
 * гайда, и перевод разошёлся бы с прозой главы. Умолчание `true`: пакет,
 * ничего не объявивший, проверяется. Остальные правила флаг не трогает.
 *
 * @param fileUrl - `import.meta.url` конфига пакета
 * @param options - `{ published }`: публикуется ли пакет в npm
 */
export function createEslintConfig(fileUrl, options = {}) {
  const packageRoot = dirname(fileURLToPath(fileUrl));
  const { published = true } = options;

  return [
    {
      ignores: [
        'dist/**',
        'node_modules/**',
        // Конфиги сборки и сгенерированные декларации — не исходный код
        '**/*.config.js',
        '**/*.config.ts',
        '**/*.d.ts',
        '**/*.d.mts',
        // Фикстуры type-tests обязаны не компилироваться: их диагностики —
        // предмет снапшотов, и в проект пакета они не входят
        'type-tests/fixtures/**',
        // Сгенерированное — не исходный код и в проект пакета не входит
        '**/.generated/**',
      ],
    },
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
      plugins: { '@nestlingjs': nestling },
      rules: {
        /*
         * Граница модуля внутри пакета: войти в папку с баррелем можно
         * только через её баррель. Настройка живёт здесь, а не в конфигах
         * пакетов, потому что соглашение общее для репозитория — в отличие
         * от `endpoint-has-layer`, где имя слоя есть свойство приложения.
         *
         * Уровень `warn` — временный: накопленные пересечения разбираются
         * вручную, и красный CI до конца разбора остановил бы работу.
         * Правило полно (спецификаторы импорта — литералы), поэтому после
         * разбора его место — `error`.
         */
        '@nestlingjs/import-through-barrel': 'warn',
      },
    },
    ...(published
      ? [
          {
            /*
             * Язык строк, которые процесс отдаёт наружу. Область — `src`
             * пакета, то есть код, который уезжает в `dist`. Спеки,
             * проверки типов и фикстуры под правило не попадают: их
             * читает тот, кто открыл репозиторий.
             */
            files: ['src/**/*.ts'],
            ignores: [
              'src/**/*.spec.ts',
              'src/**/*.test.ts',
              'src/**/*.type-test.ts',
              'src/**/__fixtures__/**',
            ],
            rules: {
              'no-restricted-syntax': ['error', ...cyrillicStringSelectors],
            },
          },
        ]
      : []),
    {
      // Скрипты пакета на голом Node: `console`, `process` и веб-глобали
      // вроде `URL` объявлены средой, а не импортом
      files: ['**/*.mjs', '**/*.cjs'],
      languageOptions: {
        globals: globals.node,
      },
    },
    {
      files: ['**/*.ts'],
      languageOptions: {
        ecmaVersion: 5,
        sourceType: 'script',
        parserOptions: {
          project: './tsconfig.json',
          tsconfigRootDir: packageRoot,
        },
      },
      rules: {
        '@typescript-eslint/interface-name-prefix': 'off',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        // TODO: По крайней мере пока
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/consistent-type-imports': 'error',
        // Параметр с подчёркиванием — объявленный намеренно и неиспользуемый.
        // Так объявляется `signal` у `static acquire` ресурса: тип роли
        // требует его в сигнатуре, а конкретному захвату он бывает не нужен
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_' },
        ],
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
        // `InternalError()` и подобные — определения `makeFail`, а не классы ошибок: `new` там менял бы смысл записи
        'unicorn/throw-new-error': 'off',
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
}
