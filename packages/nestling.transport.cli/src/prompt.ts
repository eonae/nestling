/**
 * План вопросов команды и их форма в терминале.
 *
 * Вопрос выводится из схемы, а не объявляется второй раз рядом с ней.
 * Standard Schema интроспекции не даёт, поэтому форма поля читается с
 * JSON Schema: её отдаёт конвертер вендора — тот же, которым пользуется
 * генератор OpenAPI.
 */

import type { RouteDeclaration, SchemaDocConverter } from '@nestlingjs/app';
import { describeForm, leafJsonSchema } from '@nestlingjs/app';

/**
 * Форма вопроса: она же определяет форму ответа.
 *
 * - `'choice'` — нумерованный список значений `enum`;
 * - `'confirm'` — подтверждение `[y/n]`;
 * - `'text'` — ввод строки.
 */
export type PromptKind = 'choice' | 'confirm' | 'text';

/** Вопрос по одному полю входа */
export interface PromptQuestion {
  /** Имя поля в payload команды */
  readonly field: string;

  /** Форма вопроса, прочитанная с узла схемы */
  readonly kind: PromptKind;

  /** Значения `enum` в порядке объявления; только у `'choice'` */
  readonly choices?: readonly string[];

  /** `description` узла — печатается подсказкой перед вопросом */
  readonly description?: string;

  /** `default` узла — показывается в вопросе и подставляется по «Enter» */
  readonly fallback?: string;
}

/**
 * План вопросов команды: поля в порядке объявления схемы.
 *
 * Строится один раз на `serve` и переиспользуется при каждом вызове:
 * конвертация схемы дороже разбора argv, а меняться ей между вызовами
 * неоткуда.
 */
export type PromptPlan = readonly PromptQuestion[];

/**
 * Строит план вопросов команды с политикой `missing: 'prompt'`.
 *
 * Схема формы `input` переводится в JSON Schema в направлении
 * `io: 'input'`: это форма, в которой значение приходит извне, а извне у
 * команды приходит argv. Схема с преобразованием (`z.stringbool()`)
 * описывается строкой, и ответ строкой проходит валидацию так же, как
 * прошёл бы флаг.
 *
 * @param route - Проекция маршрута команды
 * @param converters - Разрешённый список конвертеров транспорта
 * @returns Вопросы по обязательным полям понятной формы
 * @throws {Error} Если у команды поток на входе или для вендора схемы нет
 * конвертера
 */
export function buildPromptPlan(
  route: RouteDeclaration,
  converters: readonly SchemaDocConverter[],
): PromptPlan {
  const form = describeForm(route.input);

  if (form.kind === 'stream') {
    throw new Error(
      `Command "${route.pattern}" declares input: stream(…) together with ` +
        `missing: 'prompt'. Questions and the stream both read stdin, so ` +
        `only one of them can work: drop the policy or take the value from ` +
        `a flag.`,
    );
  }

  const outcome = leafJsonSchema(converters, form.leaf, { io: 'input' });

  // Формы входа нет вовсе или она не Standard Schema: спрашивать нечего,
  // и команда работает ровно как с политикой 'error'
  if (outcome === undefined) {
    return [];
  }

  if (outcome.outcome === 'unconvertible') {
    throw new Error(
      `Command "${route.pattern}" declares missing: 'prompt', and its input ` +
        `schema comes from vendor '${outcome.vendor}'. None of the ` +
        `converters translates that vendor: pass its converter in ` +
        `cli({ converters: [...] }).`,
    );
  }

  return readQuestions(outcome.json);
}

/**
 * Читает вопросы с корневого узла JSON Schema.
 *
 * Перечень полей — `required`: поле, без которого валидация откажет.
 * Необязательное поле вопросом не собирается: его отсутствие командой
 * предусмотрено.
 */
function readQuestions(json: unknown): PromptQuestion[] {
  const root = asRecord(json);
  if (!root) {
    return [];
  }

  const required = Array.isArray(root.required) ? root.required : [];
  const properties = asRecord(root.properties) ?? {};
  const questions: PromptQuestion[] = [];

  for (const name of required) {
    if (typeof name !== 'string') {
      continue;
    }

    const question = readQuestion(name, asRecord(properties[name]));
    if (question) {
      questions.push(question);
    }
  }

  return questions;
}

/**
 * Выводит форму вопроса с узла поля.
 *
 * Узел, форму которого прочитать не удалось (`array`, `object`, `anyOf`,
 * `$ref`), вопроса не даёт — и ошибки тоже: поле могло быть задано флагом,
 * и отказ при старте запретил бы рабочую команду. Незаданное поле дальше
 * забирает валидация.
 */
function readQuestion(
  field: string,
  node: Record<string, unknown> | undefined,
): PromptQuestion | undefined {
  if (!node) {
    return undefined;
  }

  const common = {
    field,
    ...(typeof node.description === 'string'
      ? { description: node.description }
      : {}),
    ...(node.default === undefined ? {} : { fallback: String(node.default) }),
  };

  const choices = readChoices(node.enum);
  if (choices) {
    return { ...common, kind: 'choice', choices };
  }

  if (node.type === 'boolean') {
    return { ...common, kind: 'confirm' };
  }

  if (
    node.type === 'string' ||
    node.type === 'number' ||
    node.type === 'integer'
  ) {
    return { ...common, kind: 'text' };
  }

  return undefined;
}

/** Значения `enum`, если все они печатаемы строкой */
function readChoices(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const choices = value.map((item) =>
    typeof item === 'string' ? item : String(item),
  );

  return choices;
}

/** Приводит значение к записи JSON-объекта */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Печатает подсказку и текст вопроса.
 *
 * Подсказка — `description` узла как написан автором схемы: транслитерации
 * и переписывания здесь нет.
 */
export function formatQuestion(question: PromptQuestion): string {
  const lines: string[] = [];

  if (question.description !== undefined) {
    lines.push(question.description);
  }

  if (question.kind === 'choice') {
    for (const [index, choice] of (question.choices ?? []).entries()) {
      lines.push(`  ${index + 1}) ${choice}`);
    }
  }

  const suffix = question.kind === 'confirm' ? ' [y/n]' : '';
  const shown =
    question.fallback === undefined ? '' : ` (${question.fallback})`;

  lines.push(`${question.field}${suffix}${shown}: `);

  return lines.join('\n');
}

/**
 * Переводит ответ в значение payload.
 *
 * Правило одно: **вопрос кладёт то же, что положил бы флаг командной
 * строки**. Строка для скаляра, `true`/`false` для подтверждения, элемент
 * списка для выбора. Приведения к типу из JSON Schema нет — схема,
 * написанная под argv (`z.coerce.number()`), работает с вопросами без
 * единой правки.
 *
 * @returns Значение поля или `undefined`, если поле остаётся незаданным
 */
export function readAnswer(
  question: PromptQuestion,
  answer: string,
): string | boolean | undefined {
  const trimmed = answer.trim();

  if (trimmed === '') {
    return question.fallback === undefined
      ? undefined
      : coerceFallback(question);
  }

  if (question.kind === 'choice') {
    const choices = question.choices ?? [];
    const index = Number(trimmed);

    return Number.isInteger(index) && index >= 1 && index <= choices.length
      ? choices[index - 1]
      : trimmed;
  }

  if (question.kind === 'confirm') {
    return readConfirm(trimmed) ?? trimmed;
  }

  return trimmed;
}

/** Умолчание узла в форме ответа на свой вопрос */
function coerceFallback(question: PromptQuestion): string | boolean {
  const fallback = question.fallback as string;

  return question.kind === 'confirm'
    ? (readConfirm(fallback) ?? fallback)
    : fallback;
}

/** `y`/`n` и их длинные формы; прочее — не подтверждение */
function readConfirm(answer: string): boolean | undefined {
  const normalized = answer.toLowerCase();

  if (normalized === 'y' || normalized === 'yes' || normalized === 'true') {
    return true;
  }

  if (normalized === 'n' || normalized === 'no' || normalized === 'false') {
    return false;
  }

  return undefined;
}
