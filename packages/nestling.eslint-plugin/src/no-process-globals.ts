/**
 * `no-process-globals` — окружение и командная строка доходят до
 * приложения швом, а не глобалью процесса.
 *
 * Швов два, и каждый объявлен: окружение приходит источником `env()` в
 * привязке конфига, командная строка — маркером `argv()` в аргументе
 * сборки. Правило запрещает третью дорогу — чтение `process.env` и
 * `process.argv` в обход обоих. Разрешена одна форма: `process.argv`
 * непосредственным аргументом маркера, то есть ровно та строка, которой
 * список попадает в шов.
 *
 * Ошибкой считается и именованный импорт `env` или `argv` из `node:process`
 * и `process`: это вторая запись того же чтения.
 *
 * Правило **синтаксическое**, и полнота здесь не цель. Обращение через
 * промежуточную переменную (`const p = process; p.env`) оно не ловит: цель
 * в том, чтобы шов с процессом нельзя было завести случайно, а не в том,
 * чтобы его нельзя было завести вовсе. Идентификатор `process`,
 * объявленный в файле параметром, переменной или импортом, правило
 * пропускает.
 *
 * Законное чтение глушится директивой `eslint-disable` с причиной в самом
 * файле: причина стоит рядом с кодом, а список путей в конфиге устаревает
 * молча.
 *
 * Рекомендуемый уровень — `error`: правило полно по прямой записи, которую
 * разбирает.
 */

import type { Rule } from 'eslint';
import type { MemberExpression, Node } from 'estree';

/** Глобаль процесса и обёртка над ней */
const PROCESS = 'process';
const GLOBAL_THIS = 'globalThis';

/** Модули, чей именованный импорт — та же глобаль другой записью */
const PROCESS_MODULES: ReadonlySet<string> = new Set(['node:process', PROCESS]);

/** Свойства процесса, у которых в Nestling есть шов */
const ENVIRONMENT = 'env';
const COMMAND_LINE = 'argv';

/** Имя маркера командной строки по умолчанию — до всякого импорта */
const MARKER = 'argv';

/** Позиция `process.argv` относительно вызова маркера */
type Position = 'whole' | 'derived' | 'none';

/** Имя свойства: `env` у `process.env` и у `process['env']` */
function propertyName(member: MemberExpression): string | undefined {
  const { property } = member;

  if (!member.computed) {
    return property.type === 'Identifier' ? property.name : undefined;
  }

  return property.type === 'Literal' && typeof property.value === 'string'
    ? property.value
    : undefined;
}

export const noProcessGlobals: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'process.env and process.argv are read through the env() source and the argv() marker, not through the process global',
    },
    schema: [],
    messages: {
      environment:
        'The environment reaches the application through an env() source in ' +
        'the config binding, not through the process global. Declare the key ' +
        'in a config section and take the section as a dependency. A seam ' +
        'that legitimately reads the process silences this rule with an ' +
        'eslint-disable that states the reason.',
      commandLine:
        'The command line reaches the application through the argv() marker ' +
        'in the build argument, not through the process global. Pass the ' +
        'list whole at the entry point: app.build(argv(process.argv)). A ' +
        'seam that legitimately reads the process silences this rule with an ' +
        'eslint-disable that states the reason.',
      slicedArgv:
        'The argv() marker takes process.argv whole, and this argument is ' +
        'derived from it. The parser drops the first two entries itself, so ' +
        'dropping them here would silently build a different composition.',
      importedGlobal:
        "Importing '{{name}}' from '{{module}}' is the same read as the " +
        'process global, and it has the same seam: an env() source for the ' +
        'environment, the argv() marker for the command line.',
    },
  },

  create(context) {
    const { sourceCode } = context;

    /**
     * Локальные имена маркера.
     *
     * Своё имя маркер получает одним способом — переименованием импорта.
     * Без импорта маркером считается идентификатор `argv`: имя
     * принадлежит API Nestling, и опции у правила нет.
     */
    const markers = new Set<string>([MARKER]);

    /**
     * Имя объявлено в файле.
     *
     * Привязка без определений — глобаль из конфига линтера, а не
     * объявление: она правило не отключает.
     */
    function isDeclared(name: string, node: Node): boolean {
      let scope = sourceCode.getScope(node);

      while (scope) {
        const variable = scope.set.get(name);

        if (variable) {
          return variable.defs.length > 0;
        }

        scope = scope.upper as never;
      }

      return false;
    }

    /** Выражение — глобаль процесса: сам `process` или `globalThis.process` */
    function isProcessGlobal(node: Node): boolean {
      if (node.type === 'Identifier') {
        return node.name === PROCESS && !isDeclared(PROCESS, node);
      }

      return (
        node.type === 'MemberExpression' &&
        propertyName(node) === PROCESS &&
        node.object.type === 'Identifier' &&
        node.object.name === GLOBAL_THIS &&
        !isDeclared(GLOBAL_THIS, node.object)
      );
    }

    const isMarkerCall = (node: Rule.Node): boolean =>
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      markers.has(node.callee.name);

    /**
     * Где стоит `process.argv` относительно вызова маркера.
     *
     * Путь вверх проходит обращения к свойствам и вызовы — ими пишется
     * срез, — и всякий такой шаг делает значение производным. Аргумент
     * маркера принимается только целым.
     */
    function positionOf(node: Rule.Node): Position {
      let current: Rule.Node = node;
      let derived = false;

      for (;;) {
        const { parent } = current;

        if (!parent) {
          return 'none';
        }

        if (
          parent.type === 'CallExpression' &&
          (parent.arguments as readonly Node[]).includes(current)
        ) {
          if (!isMarkerCall(parent)) {
            return 'none';
          }

          return derived ? 'derived' : 'whole';
        }

        const stepsOn =
          (parent.type === 'MemberExpression' && parent.object === current) ||
          (parent.type === 'CallExpression' && parent.callee === current);

        if (!stepsOn) {
          return 'none';
        }

        derived = true;
        current = parent;
      }
    }

    return {
      Program(node) {
        for (const statement of node.body) {
          if (
            statement.type !== 'ImportDeclaration' ||
            typeof statement.source.value !== 'string'
          ) {
            continue;
          }

          const module = statement.source.value;

          for (const specifier of statement.specifiers) {
            if (specifier.type !== 'ImportSpecifier') {
              continue;
            }

            const imported =
              specifier.imported.type === 'Identifier'
                ? specifier.imported.name
                : String(specifier.imported.value);

            if (imported === MARKER && !PROCESS_MODULES.has(module)) {
              markers.add(specifier.local.name);

              continue;
            }

            if (
              PROCESS_MODULES.has(module) &&
              (imported === ENVIRONMENT || imported === COMMAND_LINE)
            ) {
              context.report({
                node: specifier,
                messageId: 'importedGlobal',
                data: { name: imported, module },
              });
            }
          }
        }
      },

      MemberExpression(node) {
        if (!isProcessGlobal(node.object)) {
          return;
        }

        const name = propertyName(node);

        if (name === ENVIRONMENT) {
          context.report({ node, messageId: 'environment' });

          return;
        }

        if (name !== COMMAND_LINE) {
          return;
        }

        const position = positionOf(node);

        if (position === 'whole') {
          return;
        }

        context.report({
          node,
          messageId: position === 'derived' ? 'slicedArgv' : 'commandLine',
        });
      },
    };
  },
};
