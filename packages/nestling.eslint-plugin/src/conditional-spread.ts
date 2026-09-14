/**
 * `conditional-spread` — условная примесь поля в объектный литерал пишется
 * связкой `&&` с явным сравнением.
 *
 * Правило разбирает две формы. Тернарник с пустым литералом
 * (`...(test ? obj : {})`, `...(test ? {} : obj)`) — длинная запись того же
 * поведения: спред ложного значения любого вида в объектный литерал не
 * добавляет ничего. Связка `&&` с небулевым по форме тестом
 * (`...(port && obj)`) — ловушка: нулевое число и пустая строка роняют
 * поле, хотя значение задано.
 *
 * Спред внутри литерала массива правило не трогает: там та же замена
 * ломает код. `[...(test && arr)]` на ложном тесте бросает `TypeError`,
 * потому что спред массива требует итерируемое.
 *
 * Автофикс тернарника ограничен булевым по форме **итогом** — тем
 * выражением, что встаёт слева от `&&`. Ограничение не про поведение:
 * поведение совпадает всегда. Оно про внутреннюю согласованность правила —
 * переписав `...(x ? obj : {})` при небулевом `x`, автофикс тут же нарушил
 * бы вторую половину того же правила. Небулевой итог получает сообщение
 * без фикса: `x !== undefined` и `x` расходятся на нуле и пустой строке, и
 * выбор между ними принадлежит автору.
 *
 * Правило **синтаксическое**: булевость определяется формой выражения, а
 * не типом. Идентификатор `ready` небулев по форме, даже когда его тип
 * `boolean`.
 *
 * Рекомендуемый уровень — `error`: правило полно по форме, которую
 * разбирает, — пустой объектный литерал виден в тексте файла целиком.
 */

import type { Rule } from 'eslint';
import type {
  ConditionalExpression,
  Expression,
  LogicalExpression,
  Node,
  PrivateIdentifier,
  SpreadElement,
} from 'estree';

/**
 * Приоритеты выражений — грубая шкала, точная вокруг `&&` и равенства.
 *
 * Правилу нужно ровно одно: решить, требует ли кусок скобок на своём
 * месте в новой записи. Числа условны, значение имеет только их порядок.
 */
const SEQUENCE = 0;
const ASSIGNMENT = 1;
const CONDITIONAL = 2;
const NULLISH = 3;
const OR = 4;
const AND = 5;
const EQUALITY = 9;
const UNARY = 14;
const PRIMARY = 18;

/** Приоритет бинарного оператора: остальные формы — `PRIMARY` */
const BINARY_PRECEDENCE: Readonly<Record<string, number | undefined>> = {
  '|': 6,
  '^': 7,
  '&': 8,
  '==': EQUALITY,
  '!=': EQUALITY,
  '===': EQUALITY,
  '!==': EQUALITY,
  '<': 10,
  '<=': 10,
  '>': 10,
  '>=': 10,
  in: 10,
  instanceof: 10,
  '<<': 11,
  '>>': 11,
  '>>>': 11,
  '+': 12,
  '-': 12,
  '*': 13,
  '/': 13,
  '%': 13,
  '**': UNARY,
};

/** Операторы, чьё отрицание пишется инверсией самого оператора */
const EQUALITY_INVERSE: Readonly<Record<string, string | undefined>> = {
  '===': '!==',
  '!==': '===',
  '==': '!=',
  '!=': '==',
};

/** Бинарные операторы, дающие булев результат по форме */
const COMPARISONS: ReadonlySet<string> = new Set([
  '===',
  '!==',
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'in',
  'instanceof',
]);

/** Имя вызова, приводящего к булеву: `Boolean(x)` */
const BOOLEAN = 'Boolean';

/**
 * Итоговый тест — выражение, которое встаёт слева от `&&`.
 *
 * Текст синтезируется: отрицание равенства пишется инверсией оператора, и
 * узла с таким текстом в дереве нет. Отсюда приоритет отдельным полем — по
 * нему расставляются скобки на месте склейки.
 */
interface Outcome {
  text: string;
  precedence: number;
  boolean: boolean;
}

function precedenceOf(node: Expression | PrivateIdentifier): number {
  switch (node.type) {
    case 'SequenceExpression':
      return SEQUENCE;
    case 'AssignmentExpression':
    case 'ArrowFunctionExpression':
    case 'YieldExpression':
      return ASSIGNMENT;
    case 'ConditionalExpression':
      return CONDITIONAL;
    case 'LogicalExpression':
      if (node.operator === '&&') {
        return AND;
      }

      return node.operator === '||' ? OR : NULLISH;
    case 'BinaryExpression':
      return BINARY_PRECEDENCE[node.operator] ?? PRIMARY;
    case 'UnaryExpression':
    case 'AwaitExpression':
      return UNARY;
    default:
      return PRIMARY;
  }
}

/**
 * Выражение булево по форме.
 *
 * Оператор `??` булевым не считается: его результат — один из операндов, а
 * не ответ на вопрос. Тип выражения не читается — правило синтаксическое.
 */
function isBooleanByShape(node: Expression | PrivateIdentifier): boolean {
  switch (node.type) {
    case 'BinaryExpression':
      return COMPARISONS.has(node.operator);
    case 'UnaryExpression':
      return node.operator === '!';
    case 'LogicalExpression':
      return (
        (node.operator === '&&' || node.operator === '||') &&
        isBooleanByShape(node.left) &&
        isBooleanByShape(node.right)
      );
    case 'CallExpression':
      return node.callee.type === 'Identifier' && node.callee.name === BOOLEAN;
    case 'Literal':
      return typeof node.value === 'boolean';
    default:
      return false;
  }
}

const isEmptyObject = (node: Expression): boolean =>
  node.type === 'ObjectExpression' && node.properties.length === 0;

export const conditionalSpread: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'conditional spread into an object literal is written with && and an explicit comparison',
    },
    fixable: 'code',
    hasSuggestions: true,
    schema: [],
    messages: {
      ternary:
        'Conditional spread into an object literal is written with &&: ' +
        'spreading a falsy value adds nothing, so the ternary with an empty ' +
        'literal says the same in more characters.',
      ternaryByHand:
        'Conditional spread into an object literal is written with &&: ' +
        'spreading a falsy value adds nothing, so the ternary with an empty ' +
        'literal says the same in more characters. This one is not fixed ' +
        'automatically: the test is not boolean by shape, and && drops the ' +
        'field on 0 and on an empty string. Write the comparison you mean — ' +
        '!== undefined for "the value is set".',
      truthyTest:
        'Conditional spread drops the field when the test is 0 or an empty ' +
        'string, although the value is set. Compare explicitly: ' +
        '{{comparison}}.',
      compareExplicitly: 'Compare explicitly: {{comparison}}',
    },
  },

  create(context) {
    const { sourceCode } = context;
    const text = (node: Node): string => sourceCode.getText(node);

    const direct = (node: Expression): Outcome => ({
      text: text(node),
      precedence: precedenceOf(node),
      boolean: isBooleanByShape(node),
    });

    /**
     * Отрицание теста — итог формы с пустой первой ветвью.
     *
     * Внешнее `!` снимается, и результат проходит ту же проверку на
     * булевость: итогом `!ready` становится `ready`, а он небулев.
     * Равенство инвертируется оператором и остаётся читаемым. Реляционные
     * операторы так инвертировать нельзя — `!(a < b)` расходится с `a >= b`
     * на `NaN`, — поэтому там и во всех остальных формах пишется `!(…)`.
     */
    function negated(node: Expression): Outcome {
      if (node.type === 'UnaryExpression' && node.operator === '!') {
        return direct(node.argument);
      }

      if (node.type === 'BinaryExpression') {
        const inverse = EQUALITY_INVERSE[node.operator];

        if (inverse !== undefined) {
          return {
            text: `${text(node.left)} ${inverse} ${text(node.right)}`,
            precedence: precedenceOf(node),
            boolean: true,
          };
        }
      }

      const inner = text(node);

      return {
        text: precedenceOf(node) < UNARY ? `!(${inner})` : `!${inner}`,
        precedence: UNARY,
        boolean: true,
      };
    }

    /** Склейка итога с примешиваемым значением: скобки — по приоритету */
    function conjunction(outcome: Outcome, value: Expression): string {
      const left =
        outcome.precedence < AND ? `(${outcome.text})` : outcome.text;
      // Правый операнд `&&` требует строго большего приоритета
      const right =
        precedenceOf(value) <= AND ? `(${text(value)})` : text(value);

      return `${left} && ${right}`;
    }

    /** Явное сравнение вместо истинности: `x !== undefined` */
    function comparisonFor(node: Expression): string {
      const written = text(node);
      const left = precedenceOf(node) < EQUALITY ? `(${written})` : written;

      return `${left} !== undefined`;
    }

    function checkTernary(
      spread: SpreadElement,
      ternary: ConditionalExpression,
    ): void {
      const emptyConsequent = isEmptyObject(ternary.consequent);
      const emptyAlternate = isEmptyObject(ternary.alternate);

      // Обе ветви пустые или обе непустые — форма не та, предлагать нечего
      if (emptyConsequent === emptyAlternate) {
        return;
      }

      const value = emptyConsequent ? ternary.alternate : ternary.consequent;
      const outcome = emptyConsequent
        ? negated(ternary.test)
        : direct(ternary.test);

      if (!outcome.boolean) {
        context.report({ node: spread, messageId: 'ternaryByHand' });

        return;
      }

      const replacement = conjunction(outcome, value);

      context.report({
        node: spread,
        messageId: 'ternary',
        fix: (fixer) => fixer.replaceText(ternary, replacement),
      });
    }

    function checkConjunction(
      spread: SpreadElement,
      logical: LogicalExpression,
    ): void {
      if (isBooleanByShape(logical.left)) {
        return;
      }

      const comparison = comparisonFor(logical.left);

      context.report({
        node: spread,
        messageId: 'truthyTest',
        data: { comparison },
        // Suggestion, а не фикс: это замена поведения, а не записи, и
        // `eslint --fix` применять её не должен
        suggest: [
          {
            messageId: 'compareExplicitly',
            data: { comparison },
            fix: (fixer) => fixer.replaceText(logical.left, comparison),
          },
        ],
      });
    }

    return {
      SpreadElement(node) {
        if (node.parent.type !== 'ObjectExpression') {
          return;
        }

        const { argument } = node;

        if (argument.type === 'ConditionalExpression') {
          checkTernary(node, argument);
        } else if (
          argument.type === 'LogicalExpression' &&
          argument.operator === '&&'
        ) {
          checkConjunction(node, argument);
        }
      },
    };
  },
};
