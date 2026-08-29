/**
 * `endpoint-has-layer` — подсказка в редакторе: декларация endpoint'а,
 * похоже, не композирована от требуемого слоя.
 *
 * Правило **синтаксическое и принципиально неполное**: пайплайн — значение,
 * текущее через фабрики, параметры и импорты, и никакой разбор исходника
 * гарантии не даст. Гарантией остаётся policy-check на собранном графе
 * (`everyEndpoint({ … }).hasLayer(…)` в composition root). Отсюда два
 * следствия, определяющие всю логику ниже: правило молчит везде, где
 * значение непрозрачно, и рекомендуется уровнем `warn`, а не `error`.
 */

import type { Rule } from 'eslint';
import type {
  CallExpression,
  Expression,
  Node,
  ObjectExpression,
  Property,
  SpreadElement,
} from 'estree';

/**
 * Опции правила: имя слоя, имя конструктора и фильтр по литералу пути.
 *
 * Поле называется `constructorName`, а не `constructor`: свойство с таким
 * именем в JSON-схеме правила ломает валидацию конфига в ESLint 9 —
 * `Object.prototype.constructor` подменяется, и любая настройка правила
 * отвергается сообщением «Value undefined should be string».
 */
interface Options {
  layer: string;
  constructorName: string;
  pattern?: string;
}

/**
 * Исход синтаксического разбора значения `pipeline`.
 *
 * `unknown` — не «слоя нет», а «по исходнику не видно»: единственная
 * причина, по которой правило молчит. Ложное срабатывание на допустимом
 * коде хуже пропуска — пропущенный случай ловит policy-check.
 */
type Verdict = 'yes' | 'no' | 'unknown';

/** Имена, по которым правило узнаёт композицию и создание слоя */
const COMPOSE = 'compose';
const MAKE_PIPELINE = 'makePipeline';

/** Методы деривации билдера: производный слой содержит предшественника */
const DERIVATIONS = new Set(['pre', 'ok', 'catch', 'finally']);

/** Строковый литерал или `undefined`, если значение не литерал */
function literalString(node: Node | null | undefined): string | undefined {
  return node?.type === 'Literal' && typeof node.value === 'string'
    ? node.value
    : undefined;
}

/** Свойство объектного литерала по имени; spread делает объект непрозрачным */
function propertyOf(
  object: ObjectExpression,
  name: string,
): Property | undefined {
  for (const property of object.properties) {
    if (
      property.type === 'Property' &&
      property.key.type === 'Identifier' &&
      property.key.name === name
    ) {
      return property;
    }
  }

  return undefined;
}

const hasSpread = (object: ObjectExpression): boolean =>
  object.properties.some((property) => property.type === 'SpreadElement');

/**
 * Инициализатор локальной переменной с таким именем.
 *
 * Импорт, параметр функции и любое другое определение возвращают
 * `undefined`: значение объявлено не здесь, и разбирать нечего.
 */
function localInitializer(
  context: Rule.RuleContext,
  node: Node,
  name: string,
): Expression | undefined {
  let scope = context.sourceCode.getScope(node as never);

  while (scope) {
    const variable = scope.variables.find(
      (candidate) => candidate.name === name,
    );

    if (variable) {
      const [definition] = variable.defs;

      if (
        definition?.type === 'Variable' &&
        definition.node.type === 'VariableDeclarator' &&
        definition.node.init
      ) {
        return definition.node.init as Expression;
      }

      return undefined;
    }

    scope = scope.upper as never;
  }

  return undefined;
}

/**
 * Значение `pipeline` содержит требуемый слой.
 *
 * Разбираются ровно буквальные формы: сам идентификатор слоя, `compose(...)`
 * с ним среди аргументов, деривация билдера от него и локальная переменная,
 * инициализированная любой из этих форм. Всё прочее — `unknown`.
 */
function containsLayer(
  context: Rule.RuleContext,
  node: Expression | SpreadElement,
  options: Options,
  seen: Set<Expression | SpreadElement>,
): Verdict {
  if (seen.has(node)) {
    return 'unknown';
  }
  seen.add(node);

  if (node.type === 'Identifier') {
    if (node.name === options.layer) {
      return 'yes';
    }

    const initializer = localInitializer(context, node, node.name);

    return initializer
      ? containsLayer(context, initializer, options, seen)
      : 'unknown';
  }

  if (node.type === 'CallExpression') {
    return callContainsLayer(context, node, options, seen);
  }

  return 'unknown';
}

function callContainsLayer(
  context: Rule.RuleContext,
  node: CallExpression,
  options: Options,
  seen: Set<Expression | SpreadElement>,
): Verdict {
  const { callee } = node;

  if (callee.type === 'Identifier' && callee.name === COMPOSE) {
    const verdicts = new Set(
      node.arguments.map(
        (argument): Verdict =>
          argument.type === 'SpreadElement'
            ? 'unknown'
            : containsLayer(context, argument, options, seen),
      ),
    );

    if (verdicts.has('yes')) {
      return 'yes';
    }

    // Хоть один непрозрачный аргумент — и про композицию в целом сказать
    // нечего: слой мог оказаться именно в нём
    return verdicts.has('unknown') ? 'unknown' : 'no';
  }

  // `makePipeline()` — прозрачно пустой слой: требуемого слоя в нём нет
  if (callee.type === 'Identifier' && callee.name === MAKE_PIPELINE) {
    return 'no';
  }

  // `authedBase.pre(withTenant())` — деривация помнит предшественника
  if (
    callee.type === 'MemberExpression' &&
    callee.property.type === 'Identifier' &&
    DERIVATIONS.has(callee.property.name) &&
    callee.object.type !== 'Super'
  ) {
    return containsLayer(context, callee.object as Expression, options, seen);
  }

  return 'unknown';
}

/** Декларация попадает под фильтр пути (или фильтра нет) */
function underPattern(
  declaration: ObjectExpression,
  pattern: string | undefined,
): boolean {
  if (pattern === undefined) {
    return true;
  }

  const path = literalString(propertyOf(declaration, 'path')?.value as Node);

  // Путь не литерал — под фильтр не подвести, значит и говорить не о чем
  return path === undefined ? false : new RegExp(pattern).test(path);
}

export const endpointHasLayer: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'hint: endpoint declaration does not appear to compose the required pipeline layer',
    },
    schema: [
      {
        type: 'object',
        properties: {
          layer: { type: 'string' },
          constructorName: { type: 'string' },
          pattern: { type: 'string' },
        },
        required: ['layer'],
        additionalProperties: false,
      },
    ],
    messages: {
      // Статус подсказки — часть текста: правило неполно by design, и
      // автор обязан знать, где живёт настоящая гарантия
      missingLayer:
        "Endpoint declaration does not appear to compose layer '{{layer}}'. " +
        'This is an editor hint, not a guarantee: the guarantee is the ' +
        'assembly policy check (everyEndpoint({ … }).hasLayer({{layer}})) in ' +
        "the composition root. Opt out deliberately with detached: '<reason>'.",
    },
  },

  create(context) {
    const raw = (context.options[0] ?? {}) as Partial<Options>;
    const options: Options = {
      layer: raw.layer ?? '',
      constructorName: raw.constructorName ?? 'httpEndpoint',
      pattern: raw.pattern,
    };

    if (!options.layer) {
      return {};
    }

    return {
      CallExpression(node: CallExpression & Rule.NodeParentExtension) {
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== options.constructorName
        ) {
          return;
        }

        const [argument] = node.arguments;
        if (argument?.type !== 'ObjectExpression') {
          return;
        }

        // Осознанный opt-out — не повод для второй жалобы
        if (literalString(propertyOf(argument, 'detached')?.value as Node)) {
          return;
        }

        if (!underPattern(argument, options.pattern)) {
          return;
        }

        // Spread делает словарь непрозрачным: `pipeline` мог оказаться в нём
        if (hasSpread(argument)) {
          return;
        }

        const pipeline = propertyOf(argument, 'pipeline');

        const verdict: Verdict = pipeline
          ? containsLayer(
              context,
              pipeline.value as Expression,
              options,
              new Set(),
            )
          : 'no';

        if (verdict === 'no') {
          context.report({
            node,
            messageId: 'missingLayer',
            data: { layer: options.layer },
          });
        }
      },
    };
  },
};
