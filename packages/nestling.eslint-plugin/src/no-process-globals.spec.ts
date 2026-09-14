/**
 * `no-process-globals`: единственная разрешённая форма, формы записи той
 * же глобали и границы разбора.
 *
 * Валидных кейсов столько же, сколько невалидных, и это соотношение
 * содержательно: правило синтаксическое, и каждая форма молчания —
 * решение, а не случайность.
 */

import { noProcessGlobals } from './no-process-globals.js';

import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';

// `RuleTester` объявляет кейсы через `describe`/`it`, и берёт он их отсюда:
// глобалов у прогона нет, а без этой пары кейсы исполнились бы мимо раннера
// и файл сошёл бы за пустой
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('no-process-globals', noProcessGlobals, {
  valid: [
    {
      name: 'маркер получает список целиком',
      code: `
        import { argv } from '@nestlingjs/app';
        await app.build(argv(process.argv)).run();`,
    },
    {
      name: 'маркер без импорта — идентификатор argv',
      code: 'const document = openapi.document(app.discover(argv(process.argv)));',
    },
    {
      name: 'маркер под переименованным импортом',
      code: `
        import { argv as cliArgv } from '@nestlingjs/app';
        await app.build(cliArgv(process.argv)).run();`,
    },
    {
      name: 'своя переменная с именем process',
      code: 'const process = { env: {} }; export const values = process.env;',
    },
    {
      name: 'параметр с именем process',
      code: 'export const read = (process) => process.argv;',
    },
    {
      name: 'другое свойство процесса правилу не принадлежит',
      code: 'process.exit(1);',
    },
    {
      name: 'обращение через промежуточную переменную не ловится',
      code: 'const p = process; export const values = p.env;',
    },
    {
      name: 'импорт маркера из ядра — не импорт глобали',
      code: "import { argv, env } from '@nestlingjs/app';",
    },
  ],

  invalid: [
    {
      name: 'чтение окружения в коде приложения',
      code: "export const version = process.env.BUILD_VERSION ?? 'dev';",
      errors: [{ messageId: 'environment' }],
    },
    {
      name: 'окружение целиком',
      code: 'const values = process.env;',
      errors: [{ messageId: 'environment' }],
    },
    {
      name: 'вычисляемое обращение строковым литералом',
      code: "const values = process['env'];",
      errors: [{ messageId: 'environment' }],
    },
    {
      name: 'запись через globalThis',
      code: 'const url = globalThis.process.env.API_URL;',
      errors: [{ messageId: 'environment' }],
    },
    {
      name: 'командная строка мимо маркера',
      code: 'const args = process.argv.slice(2);',
      errors: [{ messageId: 'commandLine' }],
    },
    {
      name: 'элемент списка мимо маркера',
      code: "const email = process.argv[2] ?? 'carol@example.com';",
      errors: [{ messageId: 'commandLine' }],
    },
    {
      name: 'присваивание в переменную с последующей передачей',
      code: 'const args = process.argv; await app.build(argv(args)).run();',
      errors: [{ messageId: 'commandLine' }],
    },
    {
      name: 'срез аргументом маркера',
      code: 'await app.build(argv(process.argv.slice(2))).run();',
      errors: [{ messageId: 'slicedArgv' }],
    },
    {
      name: 'именованный импорт окружения из node:process',
      code: "import { env } from 'node:process';",
      errors: [
        {
          messageId: 'importedGlobal',
          data: { name: 'env', module: 'node:process' },
        },
      ],
    },
    {
      name: 'именованный импорт командной строки из process',
      code: "import { argv } from 'process';",
      errors: [
        {
          messageId: 'importedGlobal',
          data: { name: 'argv', module: 'process' },
        },
      ],
    },
  ],
});
