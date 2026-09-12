/**
 * Построение определений инструментов из объявленных операций.
 *
 * Схемы переводятся в JSON Schema помощником ядра `leafJsonSchema` — тем
 * же, которым пользуется генератор OpenAPI. Конвертер приходит данными в
 * `converters:`, поэтому зависимости от валидатора у пакета нет.
 *
 * Нарушения копятся в {@link McpDiagnostics} и бросаются одним списком.
 */

import type { McpViolation } from './diagnostics.js';
import { McpDiagnostics, whereOf } from './diagnostics.js';
import type { AnyRequestOperation, DeclaredTool } from './tool.js';
import { deriveToolName, TOOL_NAME_PATTERN } from './tool.js';
import type { JsonValue, McpObjectSchema, McpToolDefinition } from './types.js';

import type { SchemaDocConverter } from '@nestlingjs/app';
import { describeForm, leafJsonSchema } from '@nestlingjs/app';

/** Что построение определений получает помимо списка инструментов */
export interface BuildOptions {
  /** Конвертеры листовых схем: список — данные вызывающего */
  readonly converters?: readonly SchemaDocConverter[];
}

/**
 * Инструмент, готовый к вызову: определение для агента и операция, чей
 * порт его исполняет.
 */
export interface BoundToolDefinition<
  C extends AnyRequestOperation = AnyRequestOperation,
> {
  /** Определение, которое уходит агенту в `tools/list` */
  readonly definition: McpToolDefinition;

  /** Операция, чей порт исполняет вызов */
  readonly operation: C;

  /**
   * Объявлена ли схема выхода.
   *
   * Успешное значение уходит в `structuredContent` только тогда: клиент
   * проверяет поле объявленной схемой, и без неё структурированный ответ
   * проверять нечем.
   */
  readonly structured: boolean;
}

/** Схема выхода конвертера как объектная JSON Schema или ничто */
function asObjectSchema(json: unknown): McpObjectSchema | undefined {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return undefined;
  }

  const source = json as Record<string, unknown>;

  return source.type === 'object' ? (source as McpObjectSchema) : undefined;
}

/** Пустая схема входа: операция без `input` принимает вызов без аргументов */
function emptyObjectSchema(): McpObjectSchema {
  return { type: 'object', properties: {} };
}

/** Что получилось из перевода одного слота io */
type SlotOutcome =
  | { readonly outcome: 'object'; readonly schema: McpObjectSchema }
  | { readonly outcome: 'empty' }
  | { readonly outcome: 'not-object' }
  | { readonly outcome: 'failed' };

/**
 * Переводит форму io в объектную JSON Schema.
 *
 * Нарушения перевода — отсутствие конвертера и непереводимая схема —
 * пишутся в копилку сразу: у них есть и координаты, и способ починки.
 * Решение, считать ли исход нарушением, принимает вызывающий: у входа
 * схема обязательна, у выхода нет.
 */
function convertSlot(
  io: unknown,
  slot: 'input' | 'output',
  where: string,
  options: BuildOptions,
  diagnostics: McpDiagnostics,
): SlotOutcome {
  const form = describeForm(io);

  if (form.kind !== 'value') {
    return { outcome: 'not-object' };
  }

  if (form.leaf === undefined) {
    return { outcome: 'empty' };
  }

  if (form.leaf === 'binary' || form.leaf === 'text') {
    return { outcome: 'not-object' };
  }

  let resolved: ReturnType<typeof leafJsonSchema>;

  try {
    resolved = leafJsonSchema(options.converters, form.leaf, { io: slot });
  } catch (error) {
    diagnostics.add(
      where,
      `its '${slot}' schema could not be converted to JSON Schema: ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        `Declare the schema explicitly with jsonSchema(schema, { … }), or ` +
        `replace the unrepresentable part of it.`,
    );
    return { outcome: 'failed' };
  }

  if (!resolved) {
    return { outcome: 'not-object' };
  }

  if (resolved.outcome === 'unconvertible') {
    diagnostics.add(
      where,
      `the '${slot}' schema is a '${resolved.vendor}' schema, and no ` +
        `converter for that vendor was passed. Either add one to ` +
        `'converters' (for example zodConverter() from ` +
        `@nestlingjs/schema.zod), or declare the schema explicitly with ` +
        `jsonSchema(schema, { … }).`,
    );
    return { outcome: 'failed' };
  }

  const schema = asObjectSchema(asJson(resolved.json));

  return schema === undefined
    ? { outcome: 'not-object' }
    : { outcome: 'object', schema };
}

/**
 * Приводит вывод конвертера к JSON-значению.
 *
 * Отбрасываются `undefined` и функции: они не переживут `JSON.stringify`,
 * которым определение уходит агенту. Порядок ключей не меняется — его
 * задал автор схемы.
 */
function asJson(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => asJson(item));
  }

  switch (typeof value) {
    case 'boolean':
    case 'string': {
      return value;
    }
    case 'number': {
      return Number.isFinite(value) ? value : null;
    }
    case 'object': {
      const result: Record<string, JsonValue> = {};

      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (item === undefined || typeof item === 'function') {
          continue;
        }
        result[key] = asJson(item);
      }

      return result;
    }
    default: {
      return null;
    }
  }
}

/** Сообщает о столкновении имён, называя подстановку причиной */
function reportCollision(
  first: DeclaredTool,
  second: DeclaredTool,
  diagnostics: McpDiagnostics,
): void {
  const derived = first.nameDerived || second.nameDerived;
  const cause = derived
    ? ` The name is derived from the operation name with dots replaced by ` +
      `underscores, and '${deriveToolName(first.operation.name)}' comes out ` +
      `of both. Give one of them an explicit 'name'.`
    : ` Give one of them a different 'name'.`;

  diagnostics.add(
    whereOf(second.name, second.operation.name),
    `its name is already taken by the tool of operation ` +
      `'${first.operation.name}'.${cause}`,
  );
}

/**
 * Строит определения инструментов и проверяет объявления.
 *
 * @param tools - Список `tools:` плагина
 * @param options - Конвертеры схем
 * @returns Определения в порядке объявления
 * @throws {Error} Перечисление всех нарушений одним сообщением
 */
export function buildToolDefinitions(
  tools: readonly DeclaredTool[],
  options: BuildOptions = {},
): BoundToolDefinition[] {
  const diagnostics = new McpDiagnostics();
  const byName = new Map<string, DeclaredTool>();
  const built: BoundToolDefinition[] = [];

  for (const declared of tools) {
    const where = whereOf(declared.name, declared.operation.name);

    const first = byName.get(declared.name);
    if (first === undefined) {
      byName.set(declared.name, declared);
    } else {
      reportCollision(first, declared, diagnostics);
    }

    if (!TOOL_NAME_PATTERN.test(declared.name)) {
      diagnostics.add(
        where,
        `its name does not match ${TOOL_NAME_PATTERN.source}, which the ` +
          `protocol requires. Declare a name the protocol accepts with ` +
          `'name' in the tool dictionary.`,
      );
    }

    if (declared.description === undefined || declared.description === '') {
      diagnostics.add(
        where,
        `it has no description. An agent picks a tool by its description, ` +
          `so declare one in 'description' of the tool dictionary, in ` +
          `'doc.description' of the operation, or in 'doc.summary' of the ` +
          `operation.`,
      );
    }

    const input = convertSlot(
      declared.operation.input,
      'input',
      where,
      options,
      diagnostics,
    );

    if (input.outcome === 'not-object') {
      diagnostics.add(
        where,
        `its 'input' is not an object form, and the protocol requires an ` +
          `object schema for tool arguments. A stream, a multipart form and ` +
          `a primitive body cannot be passed as tool arguments.`,
      );
    }

    const output = convertSlot(
      declared.operation.output,
      'output',
      where,
      options,
      diagnostics,
    );

    const inputSchema =
      input.outcome === 'object' ? input.schema : emptyObjectSchema();

    built.push({
      operation: declared.operation,
      structured: output.outcome === 'object',
      definition: {
        name: declared.name,
        inputSchema,
        ...(declared.description === undefined
          ? {}
          : { description: declared.description }),
        ...(output.outcome === 'object'
          ? { outputSchema: output.schema }
          : {}),
        ...(declared.annotations === undefined
          ? {}
          : { annotations: { ...declared.annotations } }),
      },
    });
  }

  diagnostics.throwIfAny();

  return built;
}

export type { McpViolation };
