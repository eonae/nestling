/**
 * `dependency-list` — подсказка в редакторе: список DI-токенов в
 * `@Component([…])`, `@Handler([…])` или `@Resource([…])` расходится с
 * параметрами конструктора.
 *
 * Ожидаемый список правило выводит из аннотаций типов параметров по
 * таблице имён ядра: класс `X` даёт `X`, `Config<typeof X>` даёт `X`,
 * `Port<typeof Op>` даёт `Op.caller`, `Emitter<typeof Op>` даёт
 * `Op.emitter`, `Logger` даёт `Logger$.auto`, тип `X` при видимом в файле
 * `X$` даёт `X$`, массив `X[]` при видимом `X$` даёт `X$.all`. Эталон у
 * `@Component` и `@Handler` — собственный конструктор, у `@Resource` —
 * параметры `static acquire` без последнего, сигнала.
 *
 * Правило **синтаксическое**, как `endpoint-has-layer`: класс от
 * интерфейса оно отличает по форме объявления и импорта (`class`,
 * `import type`, `interface`), а не по типам. Тип вне таблицы делает
 * позицию непрозрачной: в ней принимается любой написанный DI-токен, а
 * остальные позиции проверяются дальше. Целиком правило молчит там, где
 * сравнивать нечего: список не литерал массива или содержит spread, у
 * класса нет собственного конструктора (у ресурса — `acquire`), декоратор
 * вызван не по имени.
 *
 * Сообщений два. Расхождение длины сообщается всегда: длину сверяет и
 * компилятор, и ложного срабатывания здесь нет. Автофикс дописывает
 * недостающие позиции каноническими элементами, когда каждая из них
 * известна; написанные элементы он не трогает, лишние убирает.
 * Расхождение элемента в известной позиции автофикса не несёт: написанный
 * DI-токен — решение автора, а таблица синтаксическая, и молчаливая
 * замена, которая компилируется (`RootLogger$` вместо `Logger$.auto`),
 * была бы худшим исходом. Замену предлагает suggestion, которую применяют
 * вручную в редакторе.
 *
 * Гарантией остаётся компилятор: типы декоратора сверяют список с
 * конструктором по типам, порядку и длине. Отсюда рекомендуемый уровень
 * `warn`.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Rule, Scope } from 'eslint';

/** Декораторы ролей: их аргумент — список зависимостей */
const ROLES: ReadonlySet<string> = new Set([
  'Component',
  'Handler',
  'Resource',
]);

/** Имена ядра, которые таблица узнаёт по тексту аннотации */
const LOGGER = 'Logger';
const CONFIG = 'Config';
const PORT = 'Port';
const EMITTER = 'Emitter';
const READONLY_ARRAY = 'ReadonlyArray';

/** Суффикс DI-токена интерфейса и семейства: `UsersRepository$`, `Logger$` */
const TOKEN_SUFFIX = '$';

/** Строковое имя типа узла: `'TSParameterProperty'`, `'Identifier'`, … */
type NodeType = `${TSESTree.Node['type']}`;

/** Узел дерева по строковому имени его типа */
type NodeOf<T extends NodeType> = Extract<TSESTree.Node, { type: T }>;

type ClassNode = TSESTree.ClassDeclaration | TSESTree.ClassExpression;

/**
 * Узел имеет данный тип.
 *
 * Сравнение идёт по строке, а не по `AST_NODE_TYPES`: перечисление —
 * рантайм-импорт, а `@typescript-eslint/utils` пакет держит только в
 * типах.
 */
const is = <T extends NodeType>(
  node: TSESTree.Node | null | undefined,
  type: T,
): node is NodeOf<T> => (node?.type as string | undefined) === type;

/**
 * Ожидаемый элемент позиции.
 *
 * `family` — элемент с головой `X$`: сам DI-токен, член семейства
 * `X$('users')`, `X$.auto`, `X$.all`. Семейство от DI-токена
 * синтаксически не отличить, поэтому совпадение считается по голове
 * выражения, а канонический текст пишется только на пустое место.
 * `opaque` — тип вне таблицы: позиция принимает любой элемент.
 */
type Expected =
  | { kind: 'identifier'; name: string }
  | { kind: 'member'; object: string; property: string }
  | { kind: 'family'; head: string; canonical: string }
  | { kind: 'opaque' };

type Known = Exclude<Expected, { kind: 'opaque' }>;

const OPAQUE: Expected = { kind: 'opaque' };

/** Канонический текст элемента: то, что автофикс пишет на пустое место */
function canonical(expected: Known): string {
  switch (expected.kind) {
    case 'identifier':
      return expected.name;
    case 'member':
      return `${expected.object}.${expected.property}`;
    case 'family':
      return expected.canonical;
  }
}

/** Параметр эталона: имя и тип для сообщения, флаги для проверки длины */
interface Parameter {
  name: string;
  typeText: string;
  type: TSESTree.TypeNode | undefined;
  optional: boolean;
  rest: boolean;
}

/** Привязки имён в области видимости класса */
interface Lookup {
  /** У имени есть привязка: импорт или объявление в файле */
  visible(name: string): boolean;
  /** Имя объявлено классом: `class X` в файле или импорт значением */
  isClass(name: string): boolean;
}

/** Декоратор роли класса, вызванный по имени: `@Component(…)` */
function roleCall(
  node: ClassNode,
): { role: string; call: TSESTree.CallExpression } | undefined {
  for (const { expression } of node.decorators) {
    if (
      is(expression, 'CallExpression') &&
      is(expression.callee, 'Identifier') &&
      ROLES.has(expression.callee.name)
    ) {
      return { role: expression.callee.name, call: expression };
    }
  }

  return undefined;
}

/**
 * Написанный список.
 *
 * Без аргумента список пуст, литерал массива без spread даёт элементы.
 * Всё остальное — идентификатор, вызов, spread — делает список
 * непрозрачным, и правило молчит.
 */
function writtenList(call: TSESTree.CallExpression):
  | {
      array: TSESTree.ArrayExpression | undefined;
      elements: TSESTree.Expression[];
    }
  | undefined {
  const [argument] = call.arguments;

  if (argument === undefined) {
    return { array: undefined, elements: [] };
  }

  if (!is(argument, 'ArrayExpression')) {
    return undefined;
  }

  const elements: TSESTree.Expression[] = [];

  for (const element of argument.elements) {
    if (element === null || is(element, 'SpreadElement')) {
      return undefined;
    }

    elements.push(element);
  }

  return { array: argument, elements };
}

/**
 * Эталон параметров: собственный конструктор у компонента и хендлера,
 * `static acquire` без последнего параметра у ресурса.
 *
 * Перегрузки пропускаются: эталон — сигнатура с телом. Без эталона
 * правило молчит: параметры унаследованного конструктора в файле не видны.
 */
function referenceParameters(
  node: ClassNode,
  role: string,
): TSESTree.Parameter[] | undefined {
  for (const member of node.body.body) {
    if (
      !is(member, 'MethodDefinition') ||
      !is(member.value, 'FunctionExpression')
    ) {
      continue;
    }

    if (role === 'Resource') {
      if (
        member.static &&
        member.kind === 'method' &&
        !member.computed &&
        is(member.key, 'Identifier') &&
        member.key.name === 'acquire'
      ) {
        return member.value.params.slice(0, -1);
      }
    } else if (member.kind === 'constructor') {
      return member.value.params;
    }
  }

  return undefined;
}

/** Параметр в форме для таблицы и сообщения */
function describeParameter(
  text: (node: TSESTree.Node) => string,
  parameter: TSESTree.Parameter,
): Parameter {
  // Свойство-параметр `private readonly x: T` — обёртка над параметром
  const inner = is(parameter, 'TSParameterProperty')
    ? parameter.parameter
    : parameter;
  // Значение по умолчанию делает параметр необязательным
  const pattern = is(inner, 'AssignmentPattern') ? inner.left : inner;
  const binding = is(pattern, 'RestElement') ? pattern.argument : pattern;
  const type = pattern.typeAnnotation?.typeAnnotation;

  return {
    name: is(binding, 'Identifier') ? binding.name : text(binding),
    typeText: type ? text(type) : '',
    type,
    optional: is(inner, 'AssignmentPattern') || pattern.optional,
    rest: is(pattern, 'RestElement'),
  };
}

/** Имя типа без аргументов: `X` у `X`, `undefined` у `X<T>` и `A.B` */
function plainName(type: TSESTree.TypeNode): string | undefined {
  return is(type, 'TSTypeReference') &&
    is(type.typeName, 'Identifier') &&
    type.typeArguments === undefined
    ? type.typeName.name
    : undefined;
}

/** Имя под `typeof`: `X` у `typeof X` */
function typeQueryName(type: TSESTree.TypeNode): string | undefined {
  return is(type, 'TSTypeQuery') && is(type.exprName, 'Identifier')
    ? type.exprName.name
    : undefined;
}

/** Элемент массива: `X[]`, `readonly X[]`, `ReadonlyArray<X>` */
function arrayElementOf(
  type: TSESTree.TypeNode,
): TSESTree.TypeNode | undefined {
  if (is(type, 'TSTypeOperator') && type.operator === 'readonly') {
    return type.typeAnnotation
      ? arrayElementOf(type.typeAnnotation)
      : undefined;
  }

  if (is(type, 'TSArrayType')) {
    return type.elementType;
  }

  if (
    is(type, 'TSTypeReference') &&
    is(type.typeName, 'Identifier') &&
    type.typeName.name === READONLY_ARRAY &&
    type.typeArguments?.params.length === 1
  ) {
    return type.typeArguments.params[0];
  }

  return undefined;
}

/**
 * Ожидаемый элемент по типу параметра — таблица правила.
 *
 * Строки проверяются по порядку: массив, тип при видимом `X$`, класс,
 * `Logger`, `Config`/`Port`/`Emitter` с `typeof`. Видимый `X$` сильнее
 * классификации: класс тоже бывает зарегистрирован под DI-токеном
 * интерфейса. Класс сильнее строки `Logger`: класс с таким именем,
 * объявленный в файле или импортированный значением, — обычный класс.
 */
function expectedOf(
  type: TSESTree.TypeNode | undefined,
  lookup: Lookup,
): Expected {
  if (type === undefined) {
    return OPAQUE;
  }

  const element = arrayElementOf(type);

  if (element !== undefined) {
    const name = plainName(element);
    const token = `${name}${TOKEN_SUFFIX}`;

    return name !== undefined && lookup.visible(token)
      ? { kind: 'family', head: token, canonical: `${token}.all` }
      : OPAQUE;
  }

  if (!is(type, 'TSTypeReference') || !is(type.typeName, 'Identifier')) {
    return OPAQUE;
  }

  const { name } = type.typeName;
  const args = type.typeArguments?.params ?? [];

  if (args.length === 0) {
    const token = `${name}${TOKEN_SUFFIX}`;
    // `Logger$` — семейство: голый `Logger$` не компилируется, канон — `.auto`
    const logger = {
      kind: 'family',
      head: token,
      canonical: `${token}.auto`,
    } as const;

    if (lookup.visible(token)) {
      return name === LOGGER
        ? logger
        : { kind: 'family', head: token, canonical: token };
    }

    if (lookup.isClass(name)) {
      return { kind: 'identifier', name };
    }

    // Тип `Logger` импортируют через `import type`, и без видимого `Logger$`
    // строка таблицы срабатывает по имени
    return name === LOGGER ? logger : OPAQUE;
  }

  const query = args.length === 1 ? typeQueryName(args[0]) : undefined;

  if (query === undefined) {
    return OPAQUE;
  }

  switch (name) {
    case CONFIG:
      return { kind: 'identifier', name: query };
    case PORT:
      return { kind: 'member', object: query, property: 'caller' };
    case EMITTER:
      return { kind: 'member', object: query, property: 'emitter' };
    default:
      return OPAQUE;
  }
}

/** Голова выражения — крайний левый идентификатор: `X$` у `X$('users')` */
function headOf(expression: TSESTree.Node): string | undefined {
  if (is(expression, 'Identifier')) {
    return expression.name;
  }

  if (is(expression, 'MemberExpression')) {
    return headOf(expression.object);
  }

  if (is(expression, 'CallExpression')) {
    return headOf(expression.callee);
  }

  return undefined;
}

/**
 * Написанный элемент совпадает с ожидаемым.
 *
 * Форма без головы (`as`, `await`, литерал) правилу непонятна, и оно её
 * принимает: ложное срабатывание хуже пропуска.
 */
function matches(expected: Known, written: TSESTree.Expression): boolean {
  const head = headOf(written);

  if (head === undefined) {
    return true;
  }

  switch (expected.kind) {
    case 'identifier':
      return is(written, 'Identifier') && written.name === expected.name;
    case 'member':
      return (
        is(written, 'MemberExpression') &&
        !written.computed &&
        is(written.object, 'Identifier') &&
        written.object.name === expected.object &&
        is(written.property, 'Identifier') &&
        written.property.name === expected.property
      );
    case 'family':
      return head === expected.head;
  }
}

/** Привязки имён, видимые из класса: поиск вверх по областям видимости */
function lookupFrom(context: Rule.RuleContext, node: ClassNode): Lookup {
  const bindingOf = (name: string): Scope.Variable | undefined => {
    let scope: Scope.Scope | null = context.sourceCode.getScope(node as never);

    while (scope) {
      const variable = scope.set.get(name);

      if (variable) {
        return variable;
      }

      scope = scope.upper;
    }

    return undefined;
  };

  return {
    visible: (name) => bindingOf(name) !== undefined,
    isClass: (name) =>
      bindingOf(name)?.defs.some((definition) => {
        if (definition.type === 'ClassName') {
          return true;
        }

        if (definition.type !== 'ImportBinding') {
          return false;
        }

        // `import type { X }` и `import { type X }` — импорт только типа
        const specifier = definition.node as { importKind?: string };
        const declaration = definition.parent as { importKind?: string };

        return (
          specifier.importKind !== 'type' && declaration.importKind !== 'type'
        );
      }) ?? false,
  };
}

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Допустимые длины словами: `2 parameters`, `1 to 2 parameters`, … */
function describeLengths(
  required: number,
  total: number,
  rest: boolean,
): string {
  if (rest) {
    return `at least ${plural(required, 'parameter')}`;
  }

  return required === total
    ? plural(total, 'parameter')
    : `${required} to ${plural(total, 'parameter')}`;
}

export const dependencyList: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'hint: dependency list of a role decorator does not appear to match the constructor parameters',
    },
    fixable: 'code',
    hasSuggestions: true,
    schema: [],
    messages: {
      // Статус подсказки — часть текста: правило синтаксическое, и автор
      // обязан знать, где живёт настоящая гарантия
      length:
        'Dependency list of {{className}} has {{written}}, but {{source}} ' +
        'takes {{expected}}. This is an editor hint, not a guarantee: the ' +
        'compiler checks the list against the parameters.',
      mismatch:
        "Dependency list of {{className}}: parameter '{{parameter}}: {{type}}' " +
        "expects '{{expected}}', but the list has '{{written}}' in its " +
        'position. This is an editor hint, not a guarantee: the compiler ' +
        'checks the list against the parameters.',
      replace: "Replace with '{{expected}}'",
    },
  },

  create(context) {
    const text = (node: TSESTree.Node): string =>
      context.sourceCode.getText(node as never);

    function check(node: ClassNode): void {
      const decorated = roleCall(node);

      if (!decorated) {
        return;
      }

      const list = writtenList(decorated.call);
      const reference = list && referenceParameters(node, decorated.role);

      if (!list || !reference) {
        return;
      }

      const lookup = lookupFrom(context, node);
      const parameters = reference.map((parameter) =>
        describeParameter(text, parameter),
      );
      const positional = parameters.filter((parameter) => !parameter.rest);
      const required = positional.filter(
        (parameter) => !parameter.optional,
      ).length;
      const rest = positional.length < parameters.length;
      const expected = positional.map((parameter) =>
        expectedOf(parameter.type, lookup),
      );
      const className = node.id ? node.id.name : 'the anonymous class';
      const { elements, array } = list;

      if (
        elements.length < required ||
        (!rest && elements.length > positional.length)
      ) {
        // Написанное остаётся как есть, недостающее дописывается
        // каноническим текстом, лишнее уходит
        const missing = expected.slice(elements.length);
        const fixable = missing.every((entry) => entry.kind !== 'opaque');
        const items = positional.map((_, index) =>
          index < elements.length
            ? text(elements[index])
            : canonical(expected[index] as Known),
        );
        const replacement = `[${items.join(', ')}]`;

        context.report({
          node: (array ?? decorated.call) as never,
          messageId: 'length',
          data: {
            className,
            written: plural(elements.length, 'dependency token'),
            source:
              decorated.role === 'Resource'
                ? 'static acquire (signal excluded)'
                : 'the constructor',
            expected: describeLengths(required, positional.length, rest),
          },
          fix: fixable
            ? (fixer) =>
                array
                  ? fixer.replaceText(array as never, replacement)
                  : fixer.replaceTextRange(
                      [decorated.call.callee.range[1], decorated.call.range[1]],
                      `(${replacement})`,
                    )
            : null,
        });

        return;
      }

      for (const [index, element] of elements.entries()) {
        const want = expected.at(index);

        // Позиции rest-параметра и непрозрачные позиции принимают что угодно
        if (
          want === undefined ||
          want.kind === 'opaque' ||
          matches(want, element)
        ) {
          continue;
        }

        const parameter = positional[index];

        context.report({
          node: element as never,
          messageId: 'mismatch',
          data: {
            className,
            parameter: parameter.name,
            type: parameter.typeText,
            expected: canonical(want),
            written: text(element),
          },
          suggest: [
            {
              messageId: 'replace',
              data: { expected: canonical(want) },
              fix: (fixer) =>
                fixer.replaceText(element as never, canonical(want)),
            },
          ],
        });
      }
    }

    return {
      ClassDeclaration(node) {
        check(node as unknown as TSESTree.ClassDeclaration);
      },
      ClassExpression(node) {
        check(node as unknown as TSESTree.ClassExpression);
      },
    };
  },
};
